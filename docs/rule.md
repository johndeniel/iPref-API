# Rule: user_id is server-set, never client-supplied

Applies API-wide (every authenticated resource), demonstrated by
`personal-information`.

## The rule

- Identity comes from the verified JWT only: `JwtAuthGuard` → `@CurrentUser()` → `user.id`.
- `user_id` MUST NOT appear in request bodies, query/search filters, sort fields,
  or URL params — for any endpoint.
- Every data query is pre-scoped server-side: `eq(<table>.userId, <JWT sub>)`,
  ANDed with all other filters. Client input never determines the owner.

## Why

1. **The server already knows who you are.** Accepting a client-supplied owner id
   restates authoritative information as untrusted input.
2. **A `user_id` filter is redundant or dangerous.** Under server-side scoping it
   is either a no-op (`== own id`) or an IDOR vector (`== someone else's id`) on a
   PII endpoint. This codebase has no RBAC/role concept to gate it.
3. **No legitimate use case exists.** One profile per user (`user_id` unique) —
   there is no "browse other users" surface.

## Consequences

- Unknown `userId` fields in bodies → 400 (strict schemas, not stripped).
- `sortBy` accepts only a whitelist derived from a single column map —
  user input can never reach `ORDER BY` unvalidated.
- Rows returned by any list/detail endpoint are always the caller's own.

## If admin/support access is ever needed

It requires RBAC + an admin guard + audit logging **first** — never just adding
the `user_id` filter. Without those, the filter is all risk and zero benefit.

## Pointers

- Contract (schemas, sort whitelist): `src/personal-information/model/personal-information.model.ts`
- Enforcement (`buildWhere` ownership predicate): `src/personal-information/service/personal-information.service.ts`
- Identity (JWT claims, `sub`): `docs/0002_neon_auth.md`
