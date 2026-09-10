# Klever Assets Implementation Plan v4.1

Updated 9 September 2026. Execute the authoritative `Klever_Assets_Build_Spec_v4_1.md` with `AGENTS.md`. This plan replaces the longer v4 architecture proposal. Routine implementation details are delegated to the builder; the old audit is not a prerequisite checklist to reopen.

## 1. Practical architecture

One TypeScript monorepo contains Expo mobile, Next.js web, shared domain contracts/calculation helpers, Supabase migrations/functions, and focused tests. PostgreSQL is the source of truth. Expo SecureStore holds native credentials; durable local app storage holds the small read cache/queue and private temporary photo files. Next.js provides the full admin portal and owner-only website billing.

Supabase Auth authenticates identities. Membership/session checks establish who can access which tenant. RLS and validated database commands protect tenant rows, technician assignments, immutable evidence, and write entitlement. A small set of trusted functions handles account administration, notification delivery, billing webhooks, exports, and retention. Keep user authorization context on user-driven operations; privileged credentials must never become a general RLS bypass for clients.

Private Storage holds asset and staff profile photos, immutable service/task evidence, and exports. Normal authenticated downloads recheck access. Avoid public buckets or reusable download links that undermine next-request revocation. Previously downloaded data is outside remote-wipe guarantees. Upload binary media to server-authorized paths, then finalize the evidence record. Retry finalization with the same submission ID; clean up abandoned unreferenced uploads separately.

Use one database outbox for notifications, claimed by a scheduled/server worker. Use a consistent export query to create CSV and paginated maintenance PDFs with embedded evidence images. Do not introduce separate queue infrastructure or a generic report builder. If actual report sizes exceed the selected host's request limits, run report generation as a background job and reuse that result.

Paddle owns payment collection/retries, and Resend sends transactional emails. Persist signed webhook events, deduplicate, and reconcile subscription state. The application independently enforces its documented seven-day grace, paid/trial end, and read-only access. Do not check paid access only in the client.

## 2. Small schema refinements

Start with the entities in the build brief and add these supporting structures only as needed:

- A single staff/membership source for role, active flag, tenant, and Auth linkage; a many-to-many asset assignment table; exactly one active owner invariant.
- Tenant settings for timezone and reporting currency; separate protected entitlement/plan/provider fields.
- Per-asset service schedule/baseline records so machines sharing a type do not share last-service hours/date. Asset overrides precede type defaults.
- Stable task occurrence IDs and checklist item IDs. Business tasks support shared completion or separate occurrences for each active technician, selected by the admin; preserve history when changing mode. Save the completed instructions/checklist labels with the sign-off; a full config-versioning platform is unnecessary.
- Immutable evidence records with submission ID, both timestamps, correction target/reason, and necessary display snapshots. Separate protected cost/mechanic-note data from technician-readable records.
- Attachment upload/finalization metadata; append-only issue resolution events; notification attempts; provider event/mapping records; export jobs only where asynchronous export requires them.
- Migration source identifiers, archive flags for referenced config, and operator backup/deletion records.

Use tenant-consistent foreign keys and indexes on real lookup paths. Derive tenant, actor, server time, accepted delta, current reading, and access state on trusted paths. Validate positive intervals and the Hours/Calendar/Both combinations. Use database transactions for staff activation/seat limits, owner transfer, accepted readings, and effective completions.

## 3. Core command behaviour

### Access

Implement an explicit access-status check so a deactivated user returning zero RLS rows is not mistaken for an empty asset list. Check current membership and session validity for rows, media, exports, and trusted endpoints. Confirmed revocation clears account-local data on reconnection; network loss does not. Test remote sign-out and deactivation separately because an active signed-out user may log in again.

### Readings and due calculations

Owner update (9 September 2026): assets select Hours or Kilometres at creation. The same meter arithmetic and conflict rules apply in that unit; retain the unit on readings and future service/export snapshots. Existing hour readings remain hours. Admins can correct a mistaken unit with a confirmed current reading and reason; audit the change, advance the meter revision, and preserve all previous unit snapshots. Future service baselines require explicit re-entry after such a change. Do not apply hours-based truckmount templates as distance intervals.

Enter current hours and last-service hours/date; calculate the next service by addition. Put authoritative calculation in one tested implementation, shared with client previews where practical. Serialize updates per asset. Deduplicate using submission IDs. A stale/lower reading produces a clear correction-needed result and never silently replaces the current value. Use existing admin correction, not a new conflict management module.

A late service upload must not displace an already-recorded later service baseline just because it arrived last. Compare the submitted service with current service state; if ambiguous, preserve it as pending for admin correction. Corrections preserve originals and explicitly recompute effective state. Do not overwrite old deltas or snapshots to make the past look consistent with a correction.

### Offline submission

Persist a command and its photos before reporting it pending. On reconnect, recheck permission and entitlement; upload dependencies; submit once logically even if physically retried; remove local work only after durable acknowledgement. Duplicate task occurrences return already completed. Keep rejected/conflicting items visible, while unrelated work continues. Preserve the definition shown at capture for an offline sign-off. Apply the 24-hour offline-entry window and the distinct revocation versus read-only handling in the brief.

### Subscription

Store effective access end, first failure/grace deadline per payment cycle, read-only-since, and purge deadline. A duplicate event cannot restart grace or overwrite newer provider state. Scheduled cancellation retains access until its effective end. Successful verified renewal clears failure/grace; resubscription restores the same tenant without repeating a free trial by default. At seven unpaid days, writes stop while exports remain.

Read-only policy permits explicit account-control exceptions: login, export, billing recovery, session revocation, and staff deactivation. It does not grant operational edits. Retention/purge rechecks current entitlement under a transaction/lock and remains safe to retry. Do not reactivate partially purged data. Align backup expiry and restore-time deletion handling with the final privacy commitments.

## 4. Work sequence

### A1 Foundation and access

Inspect the workspace and establish repeatable local/staging setup, pinned dependencies, migrations, two synthetic tenants, protected schema/storage, authentication, memberships/assignments, role rules, and access-status/session handling. Privately provision Stage A accounts and controlled internal entitlement.

**Pass:** tenant A cannot read/write/reference tenant B rows/media; technicians cannot read unassigned/admin-only data; owner protection holds; deactivation and session revocation block the next online request through every exposed path. Test using user credentials, not only service-role access.

### A2 Native everyday workflows

Build complete usable native flows for assets/types including editable asset photos, staff profiles including editable profile pictures/name/phone/contact email/job title, staff deactivation/reassignment, current/last-service setup, hours/countdowns/corrections, service sign-off, recurring tasks/checklists, issues/resolution, compliance. Apply the supplied starter templates per asset without duplicating or overwriting edits. Keep technical concepts out of the UI.

**Pass:** the worked 1,240/1,200/100-hour example produces 60 hours remaining; service resets correctly; Calendar/Both and monthly/custom-day tasks behave as specified; technicians see only permitted work; all config remains editable; required evidence is enforced server-side.

### A3 Short offline use and outputs

Complete persistent queue/cache and media finalization; server notifications with the urgent minimum, retries, and recurring scheduling; admin CSV/PDF exports including the realistic per-asset maintenance report. Use the same server exports from native now and web later.

**Pass:** airplane-mode capture survives app restart and syncs once; old readings cannot lower the current meter; duplicate completion is handled plainly; failed uploads cannot masquerade as complete. Verify iOS/Android camera and push on actual devices when available. Inspect a long PDF for photo inclusion, dates, performer, corrections, and clean pagination.

### A4 Klever data and proof in use

Obtain/rehearse legacy import with media and source IDs; reconcile source totals, latest hours, services/tasks/issues, assignments, and missing legacy evidence. Test reruns. Verify model/revision guidance for Klever's actual machines. Configure daily database AND photo backup and rehearse a combined restore.

Dogfood with Klever through actual daily startup/end-of-day, service logging, poor signal, and admin correction. Ask for real-use feedback when ready, not speculative UX decisions at build start. Final cutover freezes PWA writes, imports/reconciles the final source, and makes the old app read-only. Preserve new native writes if rollback becomes necessary.

**Pass:** Klever confirms core workflows work in practice; migration and recovery are verified; relevant maintenance guidance is checked or explicitly identified as starter guidance. Missing exports/devices delay their own verification, not A1–A3 construction. Do not claim this gate passed without the real evidence.

### B1 Full web portal and invitations

After core proof, implement the complete admin web portal against the same backend, plus owner signup and staff invite/password-setup journeys. Owner billing controls remain web-only. Invitations expire and cannot be reused; seat counting occurs on acceptance/reactivation. Technician portal access is denied server-side. Exercise the documented desktop-camera exception.

**Pass:** native and web change the same records under the same permissions; exports/config/notification settings work; concurrent activations do not exceed limits; no cross-session web cache leaks.

### B2 Normal SaaS billing and retention

Configure sandbox Paddle products/trial first. Implement website checkout, verified entitlement, seven-day failed-payment grace, cancellation at period end, reactivation, 12-month retention, warning emails, and deletion. Get live prices/provider IDs from the owner when needed for launch. Use controlled clocks for billing/retention tests, not phone-clock attack tests.

**Pass:** test trial start/cancel/convert, payment failure/recovery/grace expiry, paid cancellation, duplicate/out-of-order events, resubscription, over-limit downgrade, read-only exports, and purge/reactivation race. Verify direct API writes fail when read-only. Never bill real cards during unapproved testing.

### B3 Deploy and release

Prepare production migrations, protected secrets, domain/sender setup, production web deployment, EAS native builds, compatible OTA channels, synthetic review accounts, store assets/disclosures, and the operator runbook. Verify live provider setup within authorized scope. Maintain the review-time allowance without promising approval.

Deploy to the authorized target, run smoke checks, fix issues, and record actual URLs/build versions. Rehearse rollback and recovery before real cutover. Where user authorization for target, spending, customer communication, or submission is absent, complete the concrete deployable result and request only the missing authorization. Do not insert repeated approvals after authorization exists.

**Pass:** protected production services work; billing state is verified; backups include media; web is reachable; native distribution is verified at its actual stage. Distinguish internal testing/TestFlight/Play testing from public store approval. No mock billing, placeholder PDF, permissive RLS, or nonfunctional button may remain in a claimed-complete v1 workflow.

## 5. Verification and handover

Run the specified tenant-isolation suite on each code/database change. Add focused tests for meaningful behaviour, not exhaustive hypothetical scenarios. Keep acceptance evidence for same-tenant permissions, session revocation, service/task boundaries, offline deduplication, immutable evidence, required uploads, notification recipients, grace/read-only, seats, migration, and combined restore.

At build time document actual setup/test/deploy commands in the repository; do not invent commands before tools are selected. Keep `BUILD_STATUS.md` current with stage, implemented work, exact validation result, deployment state, external blockers, next action, and only meaningful deviations from defaults. No secret values. Resume from that state and actual files instead of reopening the historical audit.

Final handover is a working product and operational instructions, not another architecture essay. Clearly identify any external action that prevents release and continue any remaining independent authorized work.

10 September usability implementation: remove extra device authentication while retaining saved secure sessions and all server access checks. Preserve legacy API compatibility with app_lock always false. Use shared calendar controls and half-hour time selections; tuck secondary actions into the top-right menu. Full visual redesign follows functional acceptance.
