# Klever Assets Build Specification v4.1

Prepared for Che Boielle and the GPT-6 Astra builder on 9 September 2026.

This is the authoritative brief for the first sellable release. It incorporates the owner's reality check: keep the product simple, let the builder handle normal engineering, and use practical reliability appropriate to small field-service businesses. It supersedes v4.0 and the earlier audit's proposed defaults. This revision authorizes documentation preparation only; application development begins when the user asks to start building.

## 0. How to use this brief

Read this file with `AGENTS.md` and `Klever_Assets_Implementation_Plan_v4_1.md`. These documents provide enough direction to proceed without another broad specification audit. Later explicit user instructions take precedence. If implementation exposes a real blocker, explain it briefly, choose a routine solution where possible, and continue independent work.

The owner's confirmed direction is simple remote access control, assigned-asset technician access, entered service baselines, brief offline operation normally resolved within 24 hours, ordinary immutable sign-offs with phone/server timestamps, and familiar SaaS subscription behaviour. Concrete details below, such as reminder times, seat-count handling, and seven-day billing grace, are builder defaults chosen under the owner's delegation. They are operative defaults, not questions waiting for individual approval; record any necessary implementation adjustment without expanding the product.

Keep the working title Klever Assets until branding is supplied. Do not treat a missing final name, domain, price, or provider credential as a blocker to local implementation. Do not invent live account access, pricing, legal terms, or manufacturer approval.

## 1. Product and release scope

Build a simple affordable multi-tenant maintenance tool for field-service businesses of roughly 2–15 staff with a small fleet of vehicles/machines. Track assets, assigned staff, machine hours, service intervals, recurring tasks, issues, compliance dates, and notifications. Provide a useful per-asset maintenance PDF with photo evidence. Klever Carpet Cleaning is tenant one; carpet-cleaning truckmounts are the first onboarding library.

The first sellable release includes a native iOS/Android app and a full owner/admin web portal. Technicians use the native app. Owners/admins have all operational functions on both platforms; billing controls are web-only. Manual setup is sufficient; bulk CSV import is deferred.

Keep these out of v1: free-forever tier, Supervisor role, OCR, SMS, Google Drive auto-export, bulk CSV import, other-trade curated libraries, manufacturer partnerships, white labelling, and any new enterprise/AI features. Owner update (9 September 2026): each asset uses either Hours or Kilometres, chosen at creation. Vans can use odometer readings and distance-based servicing, alongside calendar service, tasks, issues, and compliance. One counter per asset. Admins may correct a mistaken unit after setup by entering and confirming the correct current reading and a reason. Preserve earlier records in their original units; increment the meter revision so queued old-unit readings conflict. Future meter-based service baselines must be re-entered in the corrected unit, never converted automatically. Preserve legacy odometer data as legacy data with units, never as hours.

## 2. Selected technology

| Layer | Choice |
|---|---|
| Native mobile | Expo React Native with TypeScript, managed workflow, EAS Build and compatible EAS Update releases |
| Backend | Managed Supabase PostgreSQL, Auth, private Storage, Row-Level Security |
| Web | Next.js with TypeScript; shared domain types/calculation helpers with mobile |
| Billing | Paddle Merchant of Record; website checkout; no raw Stripe or native in-app purchase |
| Notifications | Server-triggered Expo Push plus Resend transactional email |
| Deployment | Git-based builds, Supabase migrations, EAS, and Vercel for the web unless the authorized environment requires an equivalent host |

One small monorepo and one shared operational database are sufficient. Use conventional maintained libraries. No microservices, general-purpose event platform, full bidirectional synchronization, or custom identity system. Verify provider integrations against current official documentation when implementing them; do not rely on the old cost estimates.

## 3. Tenancy and access control

Each tenant-owned table has a server-derived `tenant_id`, appropriate indexes, and RLS. Tenant identity comes from the authenticated user's server-controlled membership, never client-supplied authority. A user belongs to one tenant in v1. The platform-owned maintenance catalog is read-only global data; applied copies belong to each tenant.

Enforce active membership, live session validity, role/assignment permissions, and write entitlement in the database and trusted endpoints. Cross-tenant references are forbidden. Use private photo paths and access rules matching the parent record. Costs and mechanic notes must be protected from API reads by technicians, not merely hidden on screen. Do not expose privileged service credentials to either client.

Admin deactivation preserves history and blocks the next online data request, even when the phone still has a previously issued token. It also revokes sessions. Remote sign-out revokes existing sessions without deactivating the staff record; an active user may subsequently log in again. Deactivation is the control for removing their continuing access. No password change is required for either action.

On launch, foreground, and reconnect, check access explicitly. Confirmed deactivation/revocation clears credentials, cached tenant data, pending queue, and temporary photos on that device. A temporary network error does not clear anything. Remote sign-out cannot erase data on an offline phone until it reconnects; this is accepted. Tell the admin when deactivation may discard unsynced phone records, without introducing a remote-device management system.

Store native tokens in Expo SecureStore. Optional business-wide native app lock defaults OFF and uses biometrics/device passcode, not a separate custom application PIN. When enabled, require device credential setup and lock on launch/foreground. Use normal secure session handling on the web. Auth handles password hashing, refresh, expiring single-use invitation links, and password recovery.

## 4. Roles and assignments

Exactly one active owner holds the subscription and has full operational access plus web billing. Only the owner promotes/demotes admins and transfers ownership. Transfer is atomic; the previous owner becomes an admin. Other admins cannot deactivate, demote, or delete the owner. Owner deactivation requires ownership transfer first.

Admins manage ordinary staff, assets, templates, tasks, compliance, notification settings, issues, corrections, and exports. Staff are deactivated, never routinely deleted. Prompt for reassignment when deactivating someone with assigned assets; deactivation must not be delayed indefinitely if reassignment is postponed. Unassigned assets remain visible to admins.

Technicians see assigned assets only, including their current hours, due state, applicable instructions/tasks, and their own submitted evidence. They may log hours, complete service/tasks, and report issues on those assets. They cannot access other staff profiles/evidence, unassigned assets, costs, mechanic notes, billing, or settings. Current assignment is required for asset access, including old own history. Admins retain all operational history.

One asset may have several assigned technicians, and one technician may have several assets. Business-wide tasks are the explicit exception to asset assignment: all active technicians can see them. Admins choose whether one completion satisfies the business occurrence or every active technician must complete their own occurrence. Individual completion advances only that technician’s schedule; admins can see who is still due. New technicians join individual business tasks automatically; inactive staff are excluded from outstanding work, with history retained.

## 5. Data and evidence

Use the original entities: tenants, users/staff, asset types, assets, asset history, hour logs, service types, service history, tasks, task completions, issues, notification rules, compliance items, and device tokens. Finalize exact columns and supporting join/state tables as normal implementation work.

Configuration remains editable after creation, including every creation-time config field. System-owned identity, access, billing, derived values, and audit fields are not ordinary editable config. Log asset status, assignment, and configuration changes with actor and server time. Routine removal archives any record referenced by evidence so it disappears from active work without deleting history. Deactivated staff do not consume seats.

Readings and submitted service/task sign-offs are append-only. Technicians cannot edit accepted readings. Admin corrections append a linked replacement/void entry with reason and confirmation; keep the original visible in history. An admin can correct hours up or down. Correcting a sign-off is distinct from recording another actual service. Issue reports remain intact; append admin resolution notes, actor, and time, with open/resolved as the initial status choices.

Store the completed instructions/checklist and relevant asset/performer display details with the sign-off so later config edits do not change its meaning. Protect finalized evidence photos from ordinary replacement or deletion. Only finalize a required-photo sign-off after its upload succeeds. Use binary uploads, never base64-in-JSON.

Record device capture time and server receipt time for every reading/sign-off. Display capture time as the reported event time and retain server time for reference. Put the phone capture timestamp on the service photo and show server receipt time in the associated record/report. This is sufficient practical maintenance evidence. Do not add deliberate-clock-manipulation detection, attestation, digital signatures, blockchain, or a forensic evidence system. Validate ordinary malformed values; server time controls subscription/retention, not the phone clock. Do not promise that an external manufacturer must accept a warranty claim.

## 6. User experience

Use clean minimal layouts, clear hierarchy, generous spacing, and consistent terminology/navigation across app and web. Every visible element representing a record opens its detail. Use pickers for constrained values: asset type, assignment, status, urgency, interval, and trigger mode.

Every relevant workflow must include usable loading, empty, permission, error, offline, and pending-sync states. Errors must say what happened and how to continue. Do not surface database/version/provider jargon to carpet cleaners. Technical details belong in logs, not everyday flows.

Asset statuses are Active, Out of Service, Workshop, and Other. Status change is admin-only and requires an audit reason. Assets have name/serial, tenant-defined type, optional photo, an Hours/Kilometres meter choice and current reading, and assignments. Asset photos may come from camera/gallery. Assets of any status remain in history; changing status does not silently reset or pause maintenance schedules.

## 7. Functional behaviour

### 7.1 Setup and service baseline

For a machine, enter current hours and the hours at the last service for each applicable hours-based service. For calendar servicing, enter the last-service date. One setup screen may fill several baseline fields together; do not force a separate complex configuration workflow. If last service is unknown, let the admin set an explicit starting baseline without claiming a service happened. Until supplied, display baseline required instead of inventing a due value.

Example: current reading 1,240 h, last service 1,200 h, interval 100 h means next due 1,300 h and 60 h remaining. At 1,300 h the service is due. If completed at 1,310 h, the next threshold is 1,410 h. Calendar service follows the same last-service-plus-interval arithmetic. Both is due when either threshold is reached; completing it resets both baselines.

Service definitions apply to an asset or asset type. Track independent baselines for each asset/service pair. Asset-specific overrides take precedence over type defaults. Editing an interval recalculates future due state; it does not rewrite history or create a completion. Meter, Calendar, and Both are the three service trigger modes. Meter means Hours for an hours asset and Kilometres for a km asset; intervals, baselines, countdowns, sign-offs, and exports retain that unit. References to hours-based service elsewhere apply to the selected meter unit. Truckmount starter intervals stay hours and must not be applied as kilometres.

### 7.2 Hour logging and service sign off

Technicians enter the current meter reading; the server calculates the accepted delta and next-service countdown. Confirm a large jump before saving. Builder default: ask for confirmation when an increase exceeds the greater of 24 hours or twice elapsed real hours since the last accepted reading. For kilometre assets, use the greater of 1,000 km or 120 km per elapsed real hour as the equivalent typo-confirmation threshold. A confirmed positive jump may be accepted; this is a typo check, not fraud detection.

Serialize updates per asset and give every submission a stable retry ID. An older/lower reading must not silently replace the current value. Show a plain-language conflict for admin correction through the existing correction flow. Equal readings are allowed. Corrections refer to their original record; the server preserves a consistent current reading and does not overwrite historical entries. Do not build automatic multi-device conflict merging.

Service sign-off shows instructions, captures a live camera photo with timestamp, records hours/date/performer, and permits admin-only cost/mechanic notes. No gallery for service evidence. Desktop sign-off may use a live browser camera; without a camera, complete that sign-off in the native app. This is the practical exception to portal parity, not a gallery bypass. Use fixed-precision cost values and one reporting currency per business; no foreign-exchange feature.

### 7.3 Recurring tasks

Tasks may belong to an asset or the business. They use calendar recurrence only: daily, weekly, fortnightly, monthly, or custom days. Daily/weekly/fortnightly mean 1/7/14 local calendar days. Monthly means calendar month, preserving the intended day with end-of-month clamping. Initial due date defaults to today and is editable. A late completion closes the current overdue occurrence and advances to the next future scheduled date; do not fabricate missed completions or require clearing a backlog of every missed day.

Photo and notes requirements are configurable. All checklist items must be checked before a completed sign-off. Task photos may use camera/gallery; only service photos have the explicit live-camera restriction. Store checklist labels and checked state as submitted. One effective completion per shared occurrence, or per technician occurrence for individual business tasks, prevents duplicate completions; clearly show already completed when applicable. Business task completion mode defaults to one completion for everyone and remains editable. A mode change affects future work and keeps prior evidence; pending submissions from the previous mode require reopening the task. Asset tasks continue to use one completion per asset occurrence.

### 7.4 Issues and compliance

Technicians report Minor, Attention, or Urgent issues on assigned assets. Admins resolve with notes and retain the report/history. Urgent issues always enqueue admin/owner push AND email immediately; settings cannot disable this minimum.

Assets may have any number of dated compliance items such as WOF, Rego, insurance, or certification. Type labels and due dates are tenant configuration. Each item has editable reminder lead days, defaulting to 30 and 7. Admins receive reminders by default; assigned technicians may also receive them. Compliance renewal edits the due date and starts reminders for that new date. Calendar maintenance and compliance remain separate records.

### 7.5 Notifications

Support hour-log reminders, task due/overdue, service due, compliance expiring, issue reported/urgent, and reassignment. Admin settings in app/web control recipients (admin, assigned, both), channel (push, email, both), and recurring timing or immediate delivery, subject to the urgent minimum.

All scheduling and cross-user delivery are server-triggered. No local notification scheduler. Use a tenant timezone, default Pacific/Auckland for Klever and detected with admin confirmation during other-tenant setup. Recurring timing supports selected weekdays and local time; default daily at 17:00 for hour logging and daily at 08:00 for due/overdue reminders. Event notifications send immediately. On daylight-saving change, send once per local occurrence, using the next valid time for a skipped clock time.

Service due defaults to admin plus assigned technician and is otherwise configurable. Notify once on crossing into due; use scheduled reminders thereafter. Overdue tasks get one reminder daily, adding admins after seven days if not already included. This fixed escalation requires no new settings designer. Urgent notifications retain both admin channels regardless of other settings. Owner counts as an admin recipient; exclude inactive users and fall back to admins where an assigned recipient does not exist.

Use a small durable delivery queue/outbox with retry and deduplication. Track failures and invalid device tokens. Push and email are best-effort delivery channels; no read acknowledgement or escalation-to-human system is required. Stop operational reminders while a tenant is read-only; continue account/retention messages.

### 7.6 Short offline operation

Online-first with a small persistent queue and read cache. Support cached assigned assets, tasks, current due state, and permitted recent history. Queue hour logs, issues, service sign-offs, and task completions, including their photos. Display pending sync and retry automatically while active after reconnecting, on foreground, and when the operating system permits background work. Do not promise execution while the app is terminated.

Design for seconds/minutes offline, with reconnection normally within 24 hours. Cached entitlement permits offline new entries for up to 24 hours after last successful validation, capped by any known access-end time. Thereafter allow cached reads and require reconnecting for new entries. Do not delete queued work simply because 24 hours elapsed. Admin configuration changes require connectivity.

Deduplicate retries, preserve dependency order, and stop stale readings reducing current hours. Recheck active user, current assignment, and entitlement at sync. Denied/conflicting submissions remain visibly blocked for existing admin correction/resubmission, with unrelated work continuing. If a task/service definition changed offline, retain the definition shown at capture; do not claim completion of newly added checklist steps. Accepted completion can advance the current schedule using current intervals. No general-purpose synchronization/merge system.

Confirmed revoked/deactivated access invokes the data wipe in §3, including unsynced entries. Subscription read-only does not wipe the queue. Loss of a phone before upload can lose its pending entries; accept and document that limitation. Do not build special recovery for lost unsynced phones.

### 7.7 Exports and backup

Admins can export assets, logs, service history, and tasks to CSV/PDF while active or read-only. CSV is a useful tabular data export; PDF gives printable views. The per-asset maintenance PDF is the required polished deliverable: asset name/serial, every service, hours-at, date, performer, and embedded photo evidence. Identify corrections and preserve original records. Show missing legacy evidence honestly. Include capture and server receipt times without implying that either proves the physical maintenance occurred.

Operator backups must cover both database records and actual photo files. Customer exports do not replace recovery backups. Start with daily database/media backup, a 24-hour recovery-point target, and a one-business-day recovery target; verify via a combined restore rehearsal before real cutover. Use simple scheduled managed tooling; the customer Google Drive feature remains deferred. Align backup expiry with deletion commitments and apply deletion records after restore so deleted tenants are not reintroduced.

### 7.8 Onboarding and template application

Create assets manually and choose model(s) from the supplied truckmount library to populate service definitions and daily hygiene tasks. Apply per asset without duplicate application or overwriting tenant edits. Seeded records become ordinary editable tenant configuration. Non-carpet trades set up their own service/task templates. No bulk importer is required for customer onboarding.

## 8. Truckmount starter library

The supplied `klever_assets_template_seed.json` is the machine-readable starter library: 4 brands, 8 families, 29 model entries, 22 family service definitions, and 2 universal daily tasks. The accompanying `Truckmount_Maintenance_Schedule.pdf` is reference material. The prior statement of nine families was incorrect.

Preserve the supplied model mapping, names, intervals, notes, and trigger modes as starter content unless manufacturer verification establishes a correction. Ranges use their conservative lower end; carry the range as a recommendation note. CDS 100-hour-or-monthly service uses the supplied explicit 30-day interval, not the monthly task preset. Engine-less CDS/Cleanco families get no standalone engine-oil service or engine-only daily check; retain the van-engine-maintenance note with vehicle maintenance using the selected asset meter unit.

Pre-Flight checks engine oil where applicable, pump/blower levels, and inlet filter. Post-Run checks waste-tank flushing, lint-filter cleaning, and the supplied blower-lubrication routine. These are editable daily checklist tasks, not service history records. Do not force irrelevant engine checks on engine-less machines.

Treat the library as editable recurring-maintenance starter guidance, not certified complete manufacturer schedules. Before relying on a model in live operations, check relevant model/revision instructions, including the applicability of the blower routine. Before public release, verify published library content or clearly identify unverified entries as starter guidance. Do not invent maintenance procedures or claim warranty completeness.

The audit's manufacturer spot-check found initial-service intervals missing from the summary. Do not add a new first-service engine without a new scope instruction. Record verified exceptions in the template recommendation/instructions and make the limitation clear. If exact model applicability cannot be established from manuals or available source data, ask for that model/revision only; continue app development and other model checks.

## 9. Commercial model

Flat subscription tiers by active staff count; not per-seat charging. Build-time limits are Starter 3, Pro 10, Business 25 active accepted staff, including owner/admins. These remain centrally configurable. Unaccepted invites do not count; acceptance/reactivation checks capacity atomically. Deactivated staff keep history without using seats. On downgrade below current usage, retain existing active users and block further activations until capacity is available; no automatic deactivation. Final dollar prices and live product IDs must come from the owner before live checkout; sandbox fixtures are fine during development.

Registration, 30-day card-required trial, payment, and subscription management happen on the website via Paddle. Credentials are established through secure password setup, never emailed plaintext passwords. Native apps are free login-only downloads with no purchase UI, prices, subscribe language, or external checkout links. Show operational read-only/limit states plainly without payment calls to action. Web billing is owner-only; web admins can view seat usage.

### 9.1 Access transitions

| Event | Result |
|---|---|
| Card-required trial starts | Read/write for 30 days within the selected plan |
| Cancel during trial | No conversion charge; retain access to the trial end |
| Trial converts successfully | Normal paid read/write access |
| Cancel paid subscription | Stop renewal and retain access until the paid period ends |
| Renewal or trial-conversion charge fails | Provider handles retry; retain writes for a seven-day grace period from first failure of that payment cycle |
| Payment succeeds during grace | Continue normal access and clear that grace deadline |
| Grace ends unpaid, or cancellation takes effect | View/export only; preserve all data |
| Customer successfully resubscribes within retention | Restore write access to the same tenant/data after verified entitlement |

Seven days is the builder default, not a new customer-facing setting. Repeated failed-payment events for the same cycle must not restart grace. Effective cancellation ends access even if another grace deadline exists; emergency immediate cancellation, if used by the provider/operator, takes effect immediately. Choose/configure the provider retry policy to align with this access rule rather than building a second payment-retry engine. Returning customers use a non-trial subscription unless explicitly granted another trial; do not give recurring free trials by accident.

Provider state and application access are separate internal concepts. Use verified server-side provider data, signed webhooks, duplicate-event handling, and reconciliation. A checkout redirect alone does not grant access. Enforce write limits on API/database operations, not just login. Supabase token refresh or a device clock change must not extend paid access.

Read-only still permits login, authorized reads, exports, web billing recovery, remote sign-out, and staff deactivation. Other operational edits/sign-offs are blocked. Offline submissions captured before lapse but uploaded afterward remain pending until entitlement is restored; their phone timestamp does not bypass current access.

### 9.2 Retention and reactivation

Retain read-only tenant data for exactly 12 calendar months from effective loss of write access, then purge. Email the owner 30 and 7 days before deletion. Reactivation before the deadline keeps the same data without archive/restore work; the provider may require a new subscription. Cancel the purge deadline when entitlement is restored. Prevent purge/reactivation races and do not reactivate partially deleted data.

Honor verified deletion requests through a controlled process. Routine staff deactivation is not tenant deletion. Document applicable backup expiry and any provider-retained billing records accurately in the live privacy terms. The owner supplies/approves legal/business identity and final public terms; do not invent legal guarantees.

### 9.3 Distribution

Use the B2B login-only distribution approach, synthetic reviewer tenant, and credentials with each store submission. Keep review accounts isolated from Klever and ordinary public signup. Verify current store requirements and eligibility before submission. Payment silence is not an approval guarantee; retain a 2–3 week review allowance. Do not add IAP or change the business model without a material-scope decision if the actual review outcome requires it.

## 10. Migration

Migrate Klever's expected 3 staff, 3 machines, 5 vans, and all available hours, service history, issues, tasks, and media. Verify against the actual source export rather than trusting the expected counts. The supplied folder currently has no legacy export/media archive; obtain these when needed, while building against synthetic fixtures independently.

Preserve source IDs and import provenance; rerunning import must not duplicate data. Preserve missing historical timestamps/photos/identity honestly instead of fabricating evidence. Load a second synthetic tenant and run isolation tests. Rehearse migration, reconcile, freeze PWA writes for final import, verify, then leave the PWA read-only or retire it. Preserve any new native writes before rollback.

## 11. Build stages

Stage A: secure Supabase foundation, native app, assets/staff, hours and three-mode service engine, starter library, recurring tasks/checklists, issues, compliance, server notifications, offline queue/cache, exports including maintenance PDF, migration, recovery test, and Klever dogfooding. Provision initial accounts privately; public signup/invite UI is not required yet. Server-granted internal entitlement keeps Stage A usable without a commercial bypass exposed to customers.

Stage B: full web portal, public owner onboarding, staff invitation UX, Paddle checkout/trial, subscription transitions and grace, entitlement/read-only, retention/reactivation/deletion, and store/public rollout. Stage A plus Stage B is the first sellable release. Do not jump to public sales before core use is proven.

Work in complete tested slices, not a giant unverified code dump. Follow the implementation plan's milestones. Human dogfooding, store approval, live provider accounts, and missing legacy exports are external dependencies, not failures to write more code; report them accurately and continue independent work.

## 12. Required engineering checks

Keep checks focused on meaningful failures: cross-tenant access, technician assignment/admin-field protection, deactivated/revoked sessions, meter/service arithmetic, duplicate offline submission, original evidence preservation, required-photo completion, notification delivery attempts, and subscription write permissions including grace/read-only.

Run tenant-isolation tests on every code/database change, using actual user contexts, and test affected behaviour as it changes. Test real-device camera/push/lock and short offline operation before claiming native readiness. Validate migration counts/media and restore both database and photos. Inspect a realistic long maintenance PDF. Do not add adversarial clock-testing, enterprise load targets, or elaborate formal verification to this release.

## 13. Deployment and remaining external inputs

Prepare local/staging setup, migrations, build scripts, environment-variable names, secrets guidance, and a concise operator runbook. Never put secrets in the repository. Use sandbox billing and synthetic recipients until live operation is authorized. Test builds use synthetic data; real-data cutover is controlled and recoverable.

Choose routine development tools autonomously. Ask only for inputs that actually require the owner: inaccessible provider accounts, final live prices/business identity/domain, unavailable legacy exports or machine revision information, real-device/dogfood confirmation, material new spending, or an unresolved live deployment target. Request these at the point they block their stage, not all at once before starting.

When the user authorizes a deployment target and scope, execute routine deployments, smoke checks, and repairs within it without repeating approval requests. Respect actual tool approval requirements. Prepare a concrete tested result before asking for any remaining necessary authorization. Never claim production/store deployment when only a build/preview exists.

Final delivery includes source, migrations, reproducible setup, protected provider configuration, verified deployment URLs/build IDs where available, completed test evidence, backup/restore and rollback instructions, and a short list of genuine outstanding external actions. Keep the working state in `BUILD_STATUS.md` so GPT-6 Astra can resume without repeating the audit.


Owner clarification (9 September 2026): admin editing includes existing asset name, serial and type, and staff name/phone number. Changing contact details must not change login credentials, roles, assignments or historical evidence. Meter unit setup mistakes use the explicit correction described above.

Owner addition (9 September 2026): staff profiles include an optional editable profile photo, alongside name and phone number. Asset photos were already scoped. Asset and staff profile photos may be taken with the camera or selected from the gallery, and are replaceable configuration photos rather than immutable service evidence. Keep profile media private under the same live tenant/role visibility as the parent profile.
