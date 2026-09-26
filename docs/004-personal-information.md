# 004 — Personal Information

One profile row per Neon Auth user. All routes live under
`v1/personal-information`, all require a Bearer JWT, all are scoped to the
caller. Identity itself is covered in `better-auth.md`; this doc covers the
domain module only.

## 1. Overview

`personal_information` is keyed to identity by `user_id` (unique) = JWT
`sub`. The module guarantees the invariant **every authenticated user owns
exactly one row** through two provisioning paths (section 4), so endpoints
never deal with "user has no profile" as an error case — except `POST`,
which is the manual path and 409s when the row exists.

## 2. Endpoint contract

Base: `https://<your-api>/v1/personal-information`. Every request carries
`Authorization: Bearer <JWT>` (15-min Neon Auth token).

### `GET /me` — own profile (post-login who-am-I)

```bash
curl https://<your-api>/v1/personal-information/me \
  -H "Authorization: Bearer $JWT"
# 200 { id, userId, fullName, blobUrl, blobId, phoneNumber, createdAt, updatedAt }
```

Auto-provisions on first call: the first request after signup always
succeeds, even if the signup webhook never fired. This is the call the app
makes right after login.

### `POST /` — manual create

```bash
curl -X POST https://<your-api>/v1/personal-information \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 11111111-1111-4111-8111-111111111111" \
  -d '{"fullName": "Ada Lovelace"}'
# 201 on success
```

- Body (strict — unknown fields 400): `fullName` required, non-blank;
  `blobUrl` optional valid URL; `blobId` optional UUID; `phoneNumber`
  optional. `userId` is server-set from the JWT and rejected if sent.
- `Idempotency-Key` header is required and must be UUID v4 (missing/invalid
  → 400 before anything else runs).
- 409 when your row already exists (webhook/lazy normally beat you to it).
  After `DELETE`, `POST` works again — it is also the re-creation path.

### `GET /` — list (paginated, own rows only)

```bash
curl "https://<your-api>/v1/personal-information?size=10&sortBy=createdAt" \
  -H "Authorization: Bearer $JWT"
# 200 { content: [...], totalElements, totalPages, page, size }
```

Query params (documented in this order in Swagger): `search`
(case-insensitive text search across profile ID (UUID) and full name),
`id` (exact profile ID filter), `fullName` (case-insensitive substring
filter on the full name), `sortBy` (`fullName|createdAt|updatedAt`,
default `createdAt`), `sortDirection` (`asc|desc`, default `desc`),
`size` (default 10, max 100), `page` (default 0).
In practice returns ≤1 row — the caller's own.

### `PUT /:id` — update own row

```bash
curl -X PUT https://<your-api>/v1/personal-information/<id> \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+15551234567"}'
# 200 updated row; 404 for foreign or missing ids
```

Partial body; an empty patch `{}` is a no-op fetch (returns the row, never
touches the table).

### `DELETE /:id` — delete own row

```bash
curl -X DELETE https://<your-api>/v1/personal-information/<id> \
  -H "Authorization: Bearer $JWT"
# 204; 404 for foreign or missing ids
```

### Status codes

| Code | Meaning here                                                                            |
| ---- | --------------------------------------------------------------------------------------- |
| 200  | `GET /me`, `GET /`, `PUT` success                                                       |
| 201  | `POST` created (including idempotent replays)                                           |
| 204  | `DELETE` success                                                                        |
| 400  | Missing/invalid `Idempotency-Key`, strict-body validation failure, malformed UUID param |
| 401  | Missing, invalid, or expired bearer token                                               |
| 403  | `banned` JWT claim is true                                                              |
| 404  | Row not found — including another user's id (deliberately indistinguishable)            |
| 409  | Idempotency key already in progress, **or** profile already exists for this user        |

## 3. Auth & scoping

- `JwtAuthGuard` is scoped to this controller (`@UseGuards`), not global —
  health and docs stay open with no extra decorators.
- `@CurrentUser()` extracts `{ id, email }` from the verified token; every
  service query is ANDed with `userId = <caller>`, including the paginated
  count query.
- Foreign ids 404 rather than 403: no existence oracle for row enumeration.

## 4. Provisioning

Two paths, one shared service (`ProfileProvisioningService`), same
idempotent write (`user_id` unique + `ON CONFLICT DO NOTHING`):

| Situation                       | Path that fires                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Prod signup, webhook configured | `user.created` webhook inserts eagerly (see below)                                                                      |
| Webhook missed / unreachable    | First authenticated touch (`GET /me`, list, update, delete) reads `neon_auth.user` (same Postgres, no HTTP) and inserts |
| Local dev, no public URL        | Lazy path only — zero console config                                                                                    |
| Re-create after `DELETE`        | Manual `POST` (row is gone, insert succeeds)                                                                            |

**Webhook** (`POST /webhooks/neon-auth`, registered in this module):
verifies the EdDSA detached-JWS signature (`X-Neon-*` headers, 5-min
timestamp tolerance, JWKS by `kid`), inserts `{ userId, fullName: name ??
email, blobUrl: image }` from `user.created` payloads, returns 200 for all
other event types. Responses stay 2xx/4xx — Neon treats other 4xx as
non-retryable, and the upsert makes redeliveries safe. Requires `rawBody:
true` in bootstrap (signature binds exact bytes). Subscribe via Neon
Console → Auth → Webhooks (`user.created`); localhost is rejected by Neon,
use an HTTPS tunnel for local testing.

## 5. Idempotency interplay

- The middleware applies to `POST /v1/personal-information` only; every
  other route ignores it.
- Only 2xx responses are cached — 400/401/404/409 release the key, so auth
  failures and validation errors never poison replays. A 400 on the first
  attempt stays retryable with the same key (this is why `create` does not
  pre-provision: the row must not exist before a successful insert).
- Replay returns the first completed response byte-for-byte, regardless of
  retry body. Concurrent in-flight key → 409 `already processing`.
- Known limitation: keys are global, not per-user. UUID unguessability is
  the mitigation; per-user key scoping was deferred, not overlooked.

## 6. Failure modes

- **Banned user** → 403 on every guarded route. Claims go stale up to the
  15-min token lifetime: a ban lands on next login/refresh at the latest.
  Per-request DB checks were rejected as not worth a read on every call.
- **Webhook 4xx** → not retried by Neon; the lazy path covers the gap.
- **Neon unreachable** → pool fails loud after 10s (`connectionTimeoutMillis`),
  IPv4 preferred process-wide (egress blackholes IPv6). No infinite hangs.
