# Client owns login. Backend owns verification. Identity lives in the same Postgres (`neon_auth` schema).

## 1. Overview

```text
Client ──sign-in──▶ Auth provider (Managed Neon Auth) ──writes──▶ Postgres (neon_auth.*)
Client ──Bearer token──▶ Backend (this API) ──reads──▶ Postgres (app tables)
```

The backend holds no passwords, no Google secrets, and no session state. It verifies the access token on each request and derives the user id from it.

## 2. Client: Google login via auth provider

The client signs in against the auth provider URL, not this API. Google login uses the native SDK → ID token flow:

```ts
await GoogleSignin.hasPlayServices();
const res = await GoogleSignin.signIn();
if (isSuccessResponse(res) && res.data.idToken) {
  await authClient.signIn.social({ provider: 'google', idToken: { token: res.data.idToken } });
}
```

It then calls the backend with the access token (`authClient.token()` or the `set-auth-jwt` response header, 15-min lifetime):

```ts
fetch('https://<your-api>/v1/personal-information/me', {
  headers: { Authorization: `Bearer ${token}` },
});
```

Email sign-in (`signUp.email` / `signIn.email`) follows the same contract: same token, same header.

## 3. Backend: token verification

Every guarded route requires `Authorization: Bearer <token>` (`src/auth/auth.guard.ts`, `auth.service.ts`):

- Signature checked against the instance JWKS (public keys, rotation needs no redeploy).
- Issuer must match the auth provider origin (`NEON_AUTH_BASE_URL`).
- Identity is `{ id: JWT sub, email }`. The `sub` equals `neon_auth.user.id` and `personal_information.user_id`.
- Missing/invalid/expired → `401`. `banned` claim true → `403` (stale up to token lifetime).

## 4. Backend: profile auto-creation on `GET /me`

Signup alone creates no app data. The first `GET /v1/personal-information/me` creates the profile (`ProfileProvisioningService.ensureProvisioned`, before every read/update):

1. If a row with `user_id = sub` exists, return it untouched.
2. Else read `neon_auth.user` (same database, no HTTP) and insert `{ userId, fullName: name ?? email ?? id, blobUrl: image }` with `ON CONFLICT DO NOTHING`, so concurrent first calls are safe.

`GET /me` therefore never 404s in normal use. This is the call the client makes right after login.

## 5. Why the client skips `POST`

`POST /v1/personal-information` is the manual create / re-create-after-`DELETE` path only. It does not auto-provision and returns `409` when the row already exists — which is the normal state after the first `GET /me`.

| Symptom                 | Cause / fix                                        |
| ----------------------- | -------------------------------------------------- |
| `401` with fresh token  | Wrong issuer or JWKS URL; token expired (refresh). |
| `POST` returns `409`    | By design — row already provisioned; use `PUT`.    |
| `redirect_uri_mismatch` | Callback must be `<AUTH_URL>/callback/google`.     |

## 6. Pointers

- Verification: `src/auth/auth.guard.ts`, `auth.service.ts`, `auth.jwt.ts`, `auth.types.ts`
- Provisioning: `src/personal-information/provisioning/profile-provisioning.service.ts`
- Profile contract: `docs/004-personal-information.md`
- Ownership rule: `docs/rule.md`
