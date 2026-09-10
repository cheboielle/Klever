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

The worker is disabled by default. Before activation, configure NOTIFICATION_WORKER_SECRET, RESEND_API_KEY and a verified NOTIFICATION_FROM through Supabase's secure function settings; never put their values in source or chat. NOTIFICATIONS_ENABLED must explicitly equal true. POST calls require the matching x-worker-secret header. EXPO_ACCESS_TOKEN is optional for Expo enhanced push security. Migration 013 adds recurring rules/settings and the server scan. Apply supabase/operations/notification-schedule.sql to create its inactive cron job; activate only with delivery setup. The inactive Vault-backed delivery schedule is provided in supabase/operations/notification-worker-schedule.sql; see supabase/operations/NOTIFICATIONS.md for secure setup and activation checks. Do not enable actual delivery until the development outbox has been inspected and live communications are authorized.

Phone registration requires a native build and the user's notification permission. Browser preview does not register a phone. Signing and real-device delivery checks remain release gates.


## Service evidence downloads

Apply all current migrations and deploy `service-photo` using Supabase CLI with `--use-api`. Its config intentionally delegates JWT verification to the authenticated PostgREST authorization request. Service/task evidence and current asset/profile pictures share this endpoint. Every photo POST checks live membership/session and assignment before streaming bytes with no-store response headers. Direct client Storage reads are disabled because an actual hosted test found cached private GET responses surviving session revocation. Do not substitute signed URLs or cached Storage downloads. Uploads remain authorized by their per-submission reservation and do not allow replacement.

`scripts/hosted-smoke.mjs` uses synthetic tenants/accounts and a generated `tmp/service-test.jpg`. It writes exact cleanup manifests under ignored `tmp/`. Remove test photo objects through the Storage API before executing the cleanup SQL transaction, then delete only the listed Auth test IDs. Never run destructive database resets to clean fixtures.


## Exports

Apply all current migrations and deploy export-report with Supabase CLI --use-api. Its deno.json pins pdf-lib and fontkit; the bundled Noto Sans module avoids runtime font downloads. The font license and original bytes are in its fonts directory. Admins can download business/per-asset CSV and PDFs from the app, including when read-only. Export requests use the caller's Auth session, never client-supplied tenant authority; evidence is downloaded through the protected photo endpoint.

Run node scripts/pdf-proof.mts after generating the synthetic JPEG fixture used by hosted-smoke.mjs to create the long local PDF under ignored tmp/pdfs. Render it for visual inspection with Poppler. Hosted smoke checks also save a synthetic hosted PDF there. These are test artifacts, not customer records. Large report generation and native sharing still require real-data/device proof; synchronous reports currently stop above 64 MiB of downloaded photo bytes.


## Native background and phone registration

Expo BackgroundTask registers one sync job after login, requesting a 15-minute minimum interval. The OS chooses when it actually runs; this is not a promise of delivery timing or execution after force-quit. Each background batch handles up to three queued commands through the same authenticated sync coordinator. Foreground/reconnect retries continue normally. Expo Go/web cannot substitute for real native background acceptance.

Migration 015 allows users to withdraw their own phone registration, including while read-only. Existing notification permission is checked on foreground, and changed native tokens are re-registered. Explicit Enable phone alerts remains the only permission prompt.

For the temporary Expo build CLI on this Windows runtime, use pnpm --config.node-linker=hoisted --package=eas-cli@23.2.0 --package=ejs@3.1.10 dlx eas whoami. The development account is linked and internal Android builds use the managed signing key; never put an Expo password/token in source or chat.


## Current acceptance and recovery status

BUILD_STATUS.md is the current milestone and validation record. Database and photo backup tools and a verified local restore rehearsal are documented in scripts/RECOVERY.md. Daily offsite backups and a separate hosted restore remain unverified; local copies are not that coverage. Native device acceptance, notification sender setup and the legacy export/media are still needed before Stage A proof. Keep notifications inactive until the documented setup and authorized delivery checks are complete.


## Staff invitations (scoped Stage A onboarding)

Migrations 022–023 and the `staff-invitation` function support admin invitations and native email-code/password setup without enabling public signup. The function checks current admin/tenant access, generates Supabase Auth email proofs privately and sends through Resend. Recipients choose “I have an invitation” and enter their email and latest code; Auth verifies ownership before the database grants a technician membership. Pending invitations do not consume seats. Codes/login links/passwords are never stored in invitation rows or returned to an admin.

Deploy `staff-invitation` with the existing CLI. Delivery stays disabled unless `INVITATIONS_ENABLED=true`, `RESEND_API_KEY` and verified `NOTIFICATION_FROM` are configured securely. This flag is separate from scheduled maintenance notifications. Before enabling, obtain sender verification and authorization for intended test recipients. Provider acceptance is shown as accepted for sending, not inbox delivery. An uncertain outcome prompts checking with the recipient before an explicit resend; attempts have a two-minute cooldown and unique Resend idempotency keys. Expired invitations must be recreated. No automatic retry regenerates a code after an uncertain email response.

Run `node scripts/hosted-invitation-smoke.mjs` against the explicit development project with credentials supplied only in process memory. It intercepts every Resend call while using actual Auth/database requests and verifies that the deployed endpoint is disabled. It writes exact non-secret cleanup IDs under `tmp/invitation-smoke-*`. Execute cleanup SQL with `supabase db query --linked --file` (including default notification rules), then delete the listed disposable Auth IDs and verify zero remaining fixtures. Never run this synthetic transport as a deployed provider.

Provider references: [Supabase Auth link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [email-code verification](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). Phone onboarding and real email delivery still need acceptance; bundle and HTTP tests are separate evidence.


## Isolated browser acceptance

`scripts/browser-invitation-smoke.mjs` exercises the actual admin invitation/cancellation, recipient code/password setup, accepted profile, deactivation and fresh-login denial in isolated Chrome contexts. It creates only disposable development accounts/businesses, keeps passwords/codes in memory, sends no email and writes exact cleanup manifests. Failure screenshots mask inputs; action logs are suppressed because they can include entered credentials. Never reuse a real browser profile for this test.

The local test runtime is pinned to Playwright 1.63.0 in ignored `tmp/browser-qa`: create its private package.json, then run `pnpm --dir tmp/browser-qa --ignore-workspace add playwright@1.63.0`. The script uses installed Chrome and expects the preview at 127.0.0.1:8085. Supply development credentials only in process memory, as with hosted tests; after the run, execute its exact cleanup SQL file, delete listed Auth IDs and verify cleanup.

For browser visuals, export separately with `node node_modules/expo/bin/cli export --platform web --output-dir ../../tmp/acceptance-web-export` from apps/mobile. Then run `python scripts/serve-web-preview.py --directory tmp/acceptance-web-export --port 8085` from the repository root, using the configured Python executable on this Windows host. This loopback-only server normalizes extended Windows paths so nested pnpm font assets load. A combined `--platform all` export remains useful for bundle validation but can omit the web-specific font copy; do not use it for visual acceptance. Standard Python http.server also returned 404 for the 277-character font path on this host. The corrected server and web-only export were verified with HTTP 200, a loaded FontFace and rendered icons.


`scripts/browser-service-smoke.mjs` uses the same isolated browser runtime and 8085 preview to exercise service capture/upload/sync, admin costs, technician evidence limits, a confirmed service void and actual CSV/PDF downloads. Chrome's fake media device is explicitly enabled; this does not test a physical camera or native lifecycle. The helper waits for a video frame before capture, accepts empty successful RPC responses and redacts entered credentials from failure diagnostics. PDFs are checked for embedded photos; exported CSV/PDF and masked diagnostics stay under ignored tmp/browser-service. Clean listed Storage paths first, execute tmp/browser-service-cleanup.sql, then delete listed Auth IDs and verify exact fixture cleanup. Do not reuse real business records for this script.


`scripts/browser-task-smoke.mjs` uses the same isolated runtime/8085 preview with one disposable owner and two technicians. It creates shared and individual company tasks through the UI, checks per-person progress, then disconnects one browser context and verifies a queued completion syncs exactly once after reconnect. It waits for task-list refresh completion before opening cards. This is browser network simulation, not native persistence/restart proof. Execute its exact tmp/browser-task-cleanup.sql, delete listed Auth IDs and verify cleanup after each run; no task photos or emails are used.
