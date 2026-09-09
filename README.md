# Klever Assets

Native maintenance app for small field-service teams. Follow `AGENTS.md` and the v4.1 specification. This repository is under active Stage A development; it is not a released product.

## Current implementation

- Editable private asset and team profile photos with camera/gallery, preview, safe replacement and removal.
- Expo SDK 57 native app with encrypted native session storage, login, foreground access check/device lock, assets/types, assignments, staff deactivation/remote sign-out, and online meter readings.
- PostgreSQL migrations with tenant/assignment RLS, current Auth session checks, protected transaction functions, owner/seat invariants, append-only readings and corrections, audit records, and a private default-deny evidence bucket.
- Per-asset/type service schedules and overrides with independent baselines; server-authoritative due calculations; online required-photo service completion, private history, and append-only admin corrections/voids. Recurring asset/business tasks support shared or per-technician completion, checklists, required notes/photos, calendar scheduling, private history and admin void corrections.

Offline queue, notification delivery, exports, migration, and the Stage B portal/billing remain outstanding. See `BUILD_STATUS.md` for actual test/deployment status.

Starter-library application, issue reporting/admin resolution and editable compliance dates are implemented. Urgent issues populate the durable push/email outbox, but no notification sender or compliance scheduler runs yet. The supplied maintenance library is editable starter guidance, not manufacturer-verified documentation.

## Local development

Use Node 22.13+ and pnpm 11.19.0. The tested builder machine uses Node 24.19.0. Install pnpm through its official distribution if absent; no global Expo installation is required.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm mobile
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, then supply the project's publishable key. The URL is already provided. Never place secret/service-role keys in an Expo public variable. Local environment files, build output, and credentials are ignored by Git.

To compile without building store binaries:

```sh
pnpm --filter @klever/mobile exec expo export --platform all
```

For the local browser preview:

```sh
pnpm --filter @klever/mobile exec expo start --web --port 8081
```

The browser preview is an aid for native screen development, not the Stage B web portal. Browser credentials remain in memory. Real native camera, push, biometric, and background behaviour must be checked on actual iOS/Android devices. The existing EAS project ID is configured; account ownership and bundle/package identifiers must be verified before creating signed builds.

## Database development and rollout

`pnpm test:isolation` executes the actual migration and RLS inside PGlite's PostgreSQL engine, with synthetic Auth/Storage schemas and two businesses. It does not require Docker or any production key. Hosted Supabase Auth token/session behaviour and Storage HTTP access still require a separate integration test against a confirmed test environment.

When Docker is available, Supabase CLI can run the full local stack:

```sh
pnpm dlx supabase@latest start
```

Before deploying the migration to a hosted project:

1. Authenticate securely with Supabase CLI, verify the project ID and existing schema, and confirm this is the intended development database. Never reset a hosted project or use live data as disposable fixtures.
2. Verify the managed Auth schema has `auth.sessions(id,user_id)` and that `auth.refresh_tokens.session_id` references sessions with `ON DELETE CASCADE`. The sign-out function relies on that documented/managed relationship and needs hosted validation.
3. Review the migration; run the test suite; apply through Supabase migration tooling. Keep default-deny Storage rules until evidence upload authorization is implemented.
4. Disable public email signup for the private Stage A rollout and configure the intended app redirect URL. `supabase/config.toml` is local configuration; it does not automatically change hosted Auth settings.
5. Create the intended owner/staff Auth accounts through a trusted admin flow. Only trusted setup may call `provision_business` or `provision_staff`. Choose an explicit temporary internal access deadline, not unlimited public free access.
6. Exercise real user login, cross-tenant requests, reassignment, deactivation, sign-out, refresh-token rejection, private storage denial, and read-only write denial through HTTP. Record the result separately from local tests.

The public publishable key cannot apply migrations or provision accounts. Do not work around missing administration access by making RLS permissive. No database/media deletion is part of initial setup.

## Operational limits at this stage

Readings, issue reports, service completions and task completions use a durable account-scoped queue. Native photo copies survive process termination; the browser preview uses IndexedDB for pending photo blobs. Offline entry lasts up to 24 hours after verified writable access, capped by its known expiry. Permission denial never falls back to cached reads. Sign-out or confirmed revocation clears cached data and pending work; read-only preserves pending work for later recovery. Real-device restart, camera and background behaviour, backups, reports and real-data cutover remain unverified.

## Notification delivery setup

Migration 012 adds session-bound phone registrations and service-only queue claims with expiring leases. The notification-worker function uses Expo tickets/receipts and Resend idempotency keys. Provider acceptance is not proof that a person saw a message. Tests use simulated providers only.

The worker is disabled by default. Before activation, configure NOTIFICATION_WORKER_SECRET, RESEND_API_KEY and a verified NOTIFICATION_FROM through Supabase's secure function settings; never put their values in source or chat. NOTIFICATIONS_ENABLED must explicitly equal true. POST calls require the matching x-worker-secret header. EXPO_ACCESS_TOKEN is optional for Expo enhanced push security. Migration 013 adds recurring rules/settings and the server scan. Apply supabase/operations/notification-schedule.sql to create its inactive cron job; activate only with delivery setup. Automatic sender invocation is still pending. Do not enable actual delivery until the development outbox has been inspected and live communications are authorized.

Phone registration requires a native build and the user's notification permission. Browser preview does not register a phone. Signing and real-device delivery checks remain release gates.


## Service evidence downloads

Apply migrations through 202609090011 and deploy `service-photo` using Supabase CLI with `--use-api`. Its config intentionally delegates JWT verification to the authenticated PostgREST authorization request. Service/task evidence and current asset/profile pictures share this endpoint. Every photo POST checks live membership/session and assignment before streaming bytes with no-store response headers. Direct client Storage reads are disabled because an actual hosted test found cached private GET responses surviving session revocation. Do not substitute signed URLs or cached Storage downloads. Uploads remain authorized by their per-submission reservation and do not allow replacement.

`scripts/hosted-smoke.mjs` uses synthetic tenants/accounts and a generated `tmp/service-test.jpg`. It writes exact cleanup manifests under ignored `tmp/`. Remove test photo objects through the Storage API before executing the cleanup SQL transaction, then delete only the listed Auth test IDs. Never run destructive database resets to clean fixtures.


## Exports

Apply migrations through 014 and deploy export-report with Supabase CLI --use-api. Its deno.json pins pdf-lib and fontkit; the bundled Noto Sans module avoids runtime font downloads. The font license and original bytes are in its fonts directory. Admins can download business/per-asset CSV and PDFs from the app, including when read-only. Export requests use the caller's Auth session, never client-supplied tenant authority; evidence is downloaded through the protected photo endpoint.

Run node scripts/pdf-proof.mts after generating the synthetic JPEG fixture used by hosted-smoke.mjs to create the long local PDF under ignored tmp/pdfs. Render it for visual inspection with Poppler. Hosted smoke checks also save a synthetic hosted PDF there. These are test artifacts, not customer records. Large report generation and native sharing still require real-data/device proof; synchronous reports currently stop above 64 MiB of downloaded photo bytes.
