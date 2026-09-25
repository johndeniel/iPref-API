# Better Auth — End-to-End Tutorial (NestJS + Neon + React Native)

Self-hosted auth for this API: **Google + email/password**, sessions in the
existing Neon Postgres, consumed by a React Native app shipping real **APK +
IPA**. No third-party auth vendor.

```text
RN app (APK/IPA) ──Bearer──▶ NestJS /api/auth/* ──Drizzle──▶ Neon Postgres
                    ──Bearer──▶ v1/personal-information (guarded)
```

How it fits together:

- `better-auth` owns identity (`user`, `session`, `account`,
  `verification` tables). Google's `name` maps 1:1 onto `fullName` — no
  first/last splitting.
- A `databaseHooks.user.create.after` hook auto-creates the
  `personal_information` row on signup.
- Mobile authenticates with bearer tokens (`bearer()` plugin); Google login
  goes through the **native Google SDK → ID token** flow (same code path on
  Android and iOS, no in-app browser redirect).

## 0. Prerequisites

- Node ≥ 20, this repo with migrations applied (`drizzle/0000_init_core_tables.sql`).
- A Google Cloud project (Part B).
- RN toolchain: Android Studio (APK) + Xcode on macOS (IPA). Physical devices
  or emulators — the native Google SDK does not work in Expo Go.
- The API reachable from the device (`https://<your-api>`, not `localhost`).

## Part A — Backend (this repo)

### A1. Install

```bash
npm install better-auth @better-auth/drizzle-adapter @thallesp/nestjs-better-auth
```

`@thallesp/nestjs-better-auth` is the community NestJS bridge: it mounts
`/api/auth/*` and registers a global guard with a `@Session()` decorator.
Pin the version — community-maintained.

### A2. Environment

Extend `src/config/env.validation.ts` (Joi) with:

```text
BETTER_AUTH_SECRET=<openssl rand -base64 32>   # min 32 chars
BETTER_AUTH_URL=https://<your-api>             # Google builds its callback from this
GOOGLE_CLIENT_ID=...                            # Web client (OAuth code flow)
GOOGLE_CLIENT_SECRET=...
GOOGLE_IOS_CLIENT_ID=...                        # Native ID-token flow
GOOGLE_ANDROID_CLIENT_ID=...
TRUSTED_ORIGINS=myapp://                        # App deep-link scheme
```

### A3. Auth instance — `src/auth/auth.ts`

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { expo } from '@better-auth/expo';
import { bearer } from 'better-auth/plugins';
import type { DrizzleDb } from '../database/drizzle.types.js';
import { db } from './db.js'; // drizzle instance over the existing PG_POOL
import * as authSchema from './model/auth-schema.js';

export const createAuth = (database: DrizzleDb) =>
  betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean),
    database: drizzleAdapter(database, { provider: 'pg', schema: authSchema }),
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        // First entry serves the web code flow; all entries verify native ID tokens.
        clientId: [
          process.env.GOOGLE_CLIENT_ID as string,
          process.env.GOOGLE_IOS_CLIENT_ID as string,
          process.env.GOOGLE_ANDROID_CLIENT_ID as string,
        ],
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        accessType: 'offline',
        prompt: 'select_account consent',
      },
    },
    plugins: [expo(), bearer()],
    databaseHooks: {
      user: {
        create: {
          after: async user => {
            await database.insert(personalInformation).values({
              userId: user.id,
              fullName: user.name,
              blobUrl: user.image ?? null,
            });
          },
        },
      },
    },
  });

export type Auth = ReturnType<typeof createAuth>;
```

Reuse the existing `PG_POOL`/`DRIZZLE` providers from `DatabaseModule` —
do not open a second pool.

### A4. Auth tables + profile link

Generate the Better Auth Drizzle schema into `src/auth/model/*.table.ts`
(covered by the `drizzle.config.ts` `./src/**/model/*.table.ts` glob):

```bash
npx @better-auth/cli@latest generate
```

This creates `user`, `session`, `account`, `verification`. (`user` is a
Postgres reserved word — Better Auth quotes it; non-issue.) Then add the
link column on `personal_information` (Better Auth pg ids are text):

```ts
userId: text('user_id'), // + index('idx_pi_user_id')
```

Then the usual flow:

```bash
npm run db:generate
npm run db:migrate
```

`db:generate` must report no unexpected diffs; `drizzle-kit check` must pass.

### A5. NestJS wiring

```ts
// app.module.ts
AuthModule.forRoot({ auth: createAuth(db) }),
```

```ts
// main.ts — required by the bridge so Better Auth sees the raw body
NestFactory.create(AppModule, { bodyParser: false });
```

Two consequences to handle:

1. **`bodyParser: false` can break `@Body()` parsing** on existing POST/PUT
   routes. After wiring, curl every personal-information endpoint; if bodies
   arrive empty, re-add `express.json()` for non-auth routes.
2. **The guard is global.** Mark open routes explicitly:
   `@AllowAnonymous()` on `/health` and `/health/db`; keep
   `v1/personal-information` protected and read identity via
   `@Session() session: UserSession`.

## Part B — Google Cloud Console (one project, three clients)

1. APIs & Services → Credentials → Create Credentials → OAuth client ID.
2. Create three clients in the **same** project:
   - **Web application** → authorized redirect URI:
     `https://<your-api>/api/auth/callback/google`. Its ID + secret go to
     `GOOGLE_CLIENT_ID/SECRET`.
   - **Android** → package name + SHA-1 of the signing cert (debug keystore
     for dev, release keystore for the APK you ship). ID →
     `GOOGLE_ANDROID_CLIENT_ID`.
   - **iOS** → Bundle ID. ID → `GOOGLE_IOS_CLIENT_ID`.
3. `redirect_uri_mismatch` always means the callback URL Giants: it must match
   `BETTER_AUTH_URL + /api/auth/callback/google` exactly.

## Part C — Mobile (React Native, APK + IPA)

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

export const authClient = createAuthClient({
  baseURL: 'https://<your-api>',
  plugins: [expoClient({ scheme: 'myapp', storage: SecureStore })],
  fetchOptions: {
    onSuccess: ctx => {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) SecureStore.setItemAsync(TOKEN_KEY, token);
    },
  },
});

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
  `TRUSTED_ORIGINS`, or post-OAuth deep links land nowhere.
- Android APK: signing cert SHA-1 registered in Part B must be the one that
  signs the APK you test (`gradlew assembleRelease` / EAS build).
- iOS IPA: Bundle ID must match the iOS OAuth client; Google SDK needs the
  reversed-client-ID URL scheme in `Info.plist` (the google-signin plugin
  handles it — verify after prebuild).

## Part D — Verification checklist

- [ ] `npm run test`, `lint`, `format:check`, `build` green.
- [ ] `db:generate` clean; Neon has `user/session/account/verification` + `user_id`.
- [ ] Email sign-up → `personal_information` row auto-created (`fullName` = name).
- [ ] Google login on Android APK **and** iOS build → same result.
- [ ] Bearer CRUD: 200 with token, 401 without, idempotency replay + strict-body 400s unchanged.
- [ ] Sign-out → bearer rejected; reinstall → session restores from SecureStore.

## Troubleshooting

| Symptom                                            | Likely cause                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `redirect_uri_mismatch`                            | Callback ≠ `BETTER_AUTH_URL/api/auth/callback/google`                     |
| POST/PUT bodies empty after wiring                 | `bodyParser: false` side effect — re-add `express.json()` off-auth-paths  |
| 401 on `/health`                                   | Missing `@AllowAnonymous()` under the global guard                        |
| Google login works Android, fails iOS (or reverse) | Wrong Bundle ID / SHA-1 on that platform's OAuth client                   |
| Session lost on app restart                        | SecureStore write missing (bare RN: use keychain/keystore-backed storage) |
| Concurrent same-key POSTs 409                      | By design — rival owns the key; retry with same key                       |
