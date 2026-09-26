# Better Auth — End-to-End Tutorial (Managed Neon Auth + NestJS + React Native)

Managed auth for this API via **Neon Auth (hosted Better Auth)**:
**Google + email/password**, identity in the same Neon Postgres
(`neon_auth` schema), consumed by a React Native app shipping real **APK +
IPA**. The NestJS API is a JWT resource server — no auth tables, no Google
secrets, no auth server code in this repo.

```text
RN app (APK/IPA) ──sign-in/up──▶ Neon Auth URL ──writes──▶ Neon Postgres (neon_auth.*)
                 ──Bearer JWT──▶ NestJS API ──Drizzle──▶ Neon Postgres (app tables)
```

How it fits together:

- Neon Auth owns identity (`neon_auth.user`, `.session`, …) in the **same
  database** this API connects to. Google's `name` maps 1:1 onto `fullName` —
  no first/last splitting.
- The `personal_information` row is created on the user's **first
  authenticated touch** (any endpoint checks for it, reads `neon_auth.user`,
  inserts if missing) — no webhook, no console config.
- Mobile authenticates against the Neon Auth URL, then calls this API with
  the JWT (`Authorization: Bearer`); Google login goes through the
  **native Google SDK → ID token** flow (same code path on Android and iOS,
  no in-app browser redirect).

## 0. Prerequisites

- Node ≥ 20, this repo with migrations applied (`drizzle/0000_init_core_tables.sql`).
- A Google Cloud project (Part B).
- RN toolchain: Android Studio (APK) + Xcode on macOS (IPA). Physical devices
  or emulators — the native Google SDK does not work in Expo Go.
- The API reachable from the device (`https://<your-api>`, not `localhost`).

## Part A — Backend (this repo, implemented)

The API verifies Neon Auth JWTs (EdDSA, 15-min expiry) against the instance
JWKS. One dependency, no auth server code:

### A1. Install

```bash
npm install jose
```

`jose` verifies Bearer JWTs (`src/auth/`). No `better-auth` server packages,
no `@thallesp/nestjs-better-auth`.

### A2. Environment

`src/config/env.validation.ts` (Joi) requires:

```text
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/neondb/auth
NEON_AUTH_JWKS_URL=<base>/.well-known/jwks.json   # optional, derived from BASE_URL
NEON_AUTH_ISSUER=<origin of base>                 # optional, derived from BASE_URL
```

No secrets — verification uses public keys, so rotation needs no redeploy.

### A3. Auth module — `src/auth/`

- `auth.service.ts` — `verifyBearer()` via `jose.createRemoteJWKSet`
  (cached, honors rotation) + issuer check; returns `{ id: sub, email }`.
- `auth.guard.ts` — `JwtAuthGuard` (scoped per-controller, **not** global):
  requires `Authorization: Bearer`, attaches identity to `req.authUser`,
  401s otherwise. Banned users (`banned` claim) are refused with 403 —
  claims go stale up to the 15-min token lifetime. `v1/personal-information` uses it; `/health`,
  `/health/db`, `/api-docs` stay open with no extra decorators.
- `current-user.decorator.ts` — `@CurrentUser()` reads the attached identity.
- `GET /v1/personal-information/me` — post-login who-am-I: returns the
  caller's profile, auto-provisioning on first call (never 404s).

### A4. Profile link — `personal_information.user_id`

`text('user_id')`, `NOT NULL`, `UNIQUE` (one profile per Neon Auth user id =
JWT `sub`) + `idx_pi_user_id`. Migrated with the usual flow:

```bash
npm run db:generate   # must report no unexpected diffs
npm run db:migrate
```

`userId` is server-set from the JWT and omitted from the zod schemas, so
clients cannot spoof it (strict bodies 400 it).

### A5. Provisioning — first-touch creation

- `ProfileProvisioningService.ensureProvisioned()` runs before every
  personal-information operation: if the caller's row is missing it reads
  `neon_auth.user` (same database — no extra HTTP call) and inserts it,
  falling back to the JWT email or the account id when that lookup fails.
- The insert uses `ON CONFLICT DO NOTHING` on `user_id`, so simultaneous
  first requests can't create duplicates.
- No webhook: signup alone changes nothing in this API; the row appears on
  first touch. Zero console config, works locally with no public URL.

Two consequences handled:

1. **Idempotency keys are global, not per-user.** Only 2xx responses are
   cached (401s release the key — verified in
   `idempotency.middleware.ts`), so auth failures never poison replays.
2. **POST create 409s when your row exists** (the first touch normally
   created it already); a 400 on the first attempt stays retryable with the
   same key.

## Part B — Neon Console (one project, three clients)

Google OAuth is configured on the managed service, not in this repo
(no `GOOGLE_CLIENT_SECRET` here):

1. Neon Console → Auth → Configuration → OAuth, or
   `neon neon-auth config oauth ...`.
2. Create three clients in the **same** Google Cloud project
   (APIs & Services → Credentials → OAuth client ID):
   - **Web application** → authorized redirect URI:
     `https://<your-neon-auth-host>/neondb/auth/callback/google`.
   - **Android** → package name + SHA-1 of the signing cert (debug keystore
     for dev, release keystore for the APK you ship).
   - **iOS** → Bundle ID.
3. `redirect_uri_mismatch` always means the callback URL is wrong: it must match
   the Neon Auth URL + `/callback/google` exactly.
4. Add the app's deep-link scheme (`myapp://`) to trusted domains so
   post-OAuth redirects land back in the app.

## Part C — Mobile (React Native, APK + IPA)

The app talks to **two** backends: the Neon Auth URL for sign-in/up, this
API for data. The backend contract is one line: `Authorization: Bearer
<JWT>` (from `authClient.token()` or the `set-auth-jwt` response header;
tokens live 15 minutes — refresh before calling the API).

### C1. Install (app repo)

```bash
npm install better-auth @better-auth/expo expo-secure-store \
  expo-linking expo-web-browser expo-constants \
  @react-native-google-signin/google-signin
```

### C2. Client — `lib/auth-client.ts`

```ts
import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'ipref-bearer-token';

// Point at the Neon Auth URL, not this API.
export const authClient = createAuthClient({
  baseURL: 'https://<your-neon-auth-host>/neondb/auth',
  plugins: [expoClient({ scheme: 'myapp', storage: SecureStore })],
  fetchOptions: {
    onSuccess: ctx => {
      // JWT plugin: fresh token on session checks; persist for API calls.
      const token = ctx.response.headers.get('set-auth-jwt');
      if (token) SecureStore.setItemAsync(TOKEN_KEY, token);
    },
  },
});

// Or explicitly: const { data } = await authClient.token();

export const authFetch = async (path: string, init: RequestInit = {}) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return fetch(`https://<your-api>${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
};
```

Bare-RN note: without the Expo plugin, skip `expoClient` and set the
`Authorization` header manually as above — the bearer plugin accepts it.

### C3. Email screens

```tsx
await authClient.signUp.email({ name, email, password }); // sign-up
await authClient.signIn.email({ email, password }); // sign-in
await authClient.signOut();
const { data: session } = authClient.useSession();
```

### C4. Google — native SDK → ID token (primary flow, APK + IPA)

```tsx
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

const handleGoogle = async () => {
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (isSuccessResponse(res) && res.data.idToken) {
    const { error } = await authClient.signIn.social({
      provider: 'google',
      idToken: { token: res.data.idToken },
    });
    if (!error) router.replace('/dashboard');
  }
};
```

Fallback (browser redirect, needs the deep-link scheme in `app.json`):

```tsx
await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
```

### C5. Build notes

- `scheme: 'myapp'` must exist in `app.json` (`expo.scheme`) and in
  the Neon Auth trusted domains, or post-OAuth deep links land nowhere.
- Android APK: signing cert SHA-1 registered in Part B must be the one that
  signs the APK you test (`gradlew assembleRelease` / EAS build).
- iOS IPA: Bundle ID must match the iOS OAuth client; Google SDK needs the
  reversed-client-ID URL scheme in `Info.plist` (the google-signin plugin
  handles it — verify after prebuild).

## Part D — Verification checklist

- [ ] `npm run test`, `lint`, `format:check`, `build` green.
- [ ] `db:generate` clean; `personal_information` has `user_id` (unique + index).
- [ ] Email sign-up → first API call (`GET /me`) → `personal_information`
      row auto-created (`fullName` = name).
- [ ] Google login on Android APK **and** iOS build → same result.
- [ ] Bearer CRUD: 200 with token, 401 without; cross-user IDs 404;
      idempotency replay + strict-body 400s unchanged.
- [ ] Sign-out → bearer rejected (token expiry); reinstall → session restores
      from SecureStore, fresh JWT via `authClient.token()`.

## Troubleshooting

| Symptom                                            | Likely cause                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `redirect_uri_mismatch`                            | Callback ≠ `<NEON_AUTH_URL>/callback/google`                              |
| 401 with a fresh token                             | Issuer ≠ auth URL origin, or JWKS URL misconfigured                       |
| POST returns 409 after signup                      | By design — the first touch already created your row; use PUT             |
| Google login works Android, fails iOS (or reverse) | Wrong Bundle ID / SHA-1 on that platform's OAuth client                   |
| Session lost on app restart                        | SecureStore write missing (bare RN: use keychain/keystore-backed storage) |
| Concurrent same-key POSTs 409                      | By design — rival owns the key; retry with same key                       |
