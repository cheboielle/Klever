# Notification operations

Current state: reminders and delivery are deployed but disabled. No real email or push delivery has been verified. The operator must complete sender/phone setup and the applicable live-send authorization before activation.

## Configuration

Apply `notification-schedule.sql` and `notification-worker-schedule.sql` after the application migrations. They create missing jobs in the inactive state and preserve any existing job's activation state. The worker dispatcher is private and executable only by its database owner. This follows Supabase's [Cron, pg_net and Vault pattern](https://supabase.com/docs/guides/functions/schedule-functions).

Use provider secure configuration, not source files or chat, for:

- Edge Function `RESEND_API_KEY` and `NOTIFICATION_FROM`: an authorized key and verified sender.
- Edge Function `NOTIFICATION_WORKER_SECRET`: a generated secret of at least 32 characters.
- Vault `klever_notification_worker_secret`: the same worker secret.
- Vault `klever_project_url`: this environment's exact `https://<project-ref>.supabase.co` URL.
- Optional Edge Function `EXPO_ACCESS_TOKEN` if Expo push access-token protection is enabled.

Keep `NOTIFICATIONS_ENABLED` unset or false until ready. The worker requires it to equal `true`, as well as the sender settings and valid request secret. Never store a service-role key in the cron command. The dispatcher reads its secret from Vault; HTTP invocation uses the private `x-worker-secret` header. Missing configuration fails rather than pretending to send.

## Activation checks

First use synthetic accounts and an explicitly authorized test email/phone destination. Obtain an actual Expo development/preview build with platform push credentials; browser bundles and Expo Go are not native push acceptance. Check a phone's alert permission and registration, an urgent issue's push plus email, a scheduled reminder, a tapped alert, and one revoked/reassigned recipient. Verify Expo receipts as well as send tickets. Remove synthetic jobs and fixtures afterward.

Before enabling real delivery, inspect outstanding pending jobs. Do not accidentally deliver old synthetic messages or a backlog of development reminders. Update the app's temporary “awaiting setup” notices when actual activation is complete.

After configuration and the applicable send authorization, enable `NOTIFICATIONS_ENABLED=true`, then activate the two existing cron jobs by their exact names: `klever-reminder-scan` and `klever-notification-delivery`. Do not create duplicates. Recheck the selected project's URL and Vault entries after any restore. Both schedules run once per minute; actual provider delivery time is additional.

The worker claims one current eligible recipient at a time, prioritizes urgent issues and processes at most 20 jobs within a 45-second delivery budget. It skips cancelled candidates without wasting the requested delivery slot. Each claim still enforces current membership, assignment and entitlement. Provider requests use the remaining budget; acknowledgement has its own bounded database timeout. An interrupted invocation leaves its expiring lease for safe retry. Email idempotency and Expo receipt tracking remain in effect.

## Verification and pause

Inspect `cron.job_run_details` and `net._http_response` for invocation failures; an accepted HTTP request alone is not successful delivery. Inspect `notification_outbox` statuses, sanitized errors and receipt state. `sent` means provider-confirmed acceptance/receipt, not proof a person read the message. Failed or uncertain outcomes require review; do not blindly clear delivery state and resend.

To pause, deactivate both named cron jobs and set `NOTIFICATIONS_ENABLED=false`. Already accepted provider messages cannot be recalled. No production notification guarantee is claimed until the actual sender/phone checks pass.
