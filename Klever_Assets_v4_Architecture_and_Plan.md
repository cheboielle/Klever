# Klever Assets v4 — Proposed technical architecture and implementation plan

> **Historical proposal — replaced 9 September 2026.** Use `Klever_Assets_Implementation_Plan_v4_1.md` and `Klever_Assets_Build_Spec_v4_1.md`. This earlier proposal's pending-decision gates and first-failure read-only default no longer apply.

Prepared 8 September 2026. Planning only: no application code written.

This plan preserves the specified product and Stage A → Stage B order. It uses the proposed resolutions in `Klever_Assets_v4_Implementation_Audit.md`; those are explicit assumptions pending incorporation into the specification. Phase 2 features remain deferred. The maintenance seed is not assumed manufacturer-validated.

## 1. Architecture

Use a small TypeScript monorepo with an Expo mobile application, a Next.js website/admin portal, shared domain contracts, and Supabase migrations/server functions. One managed PostgreSQL database is the authoritative store. Do not introduce microservices, a second operational database, or a general sync platform.

| Component | Responsibility |
|---|---|
| Expo React Native app | Owner/admin/technician workflows; camera; local device lock; secure token storage; cached permitted reads; durable offline evidence queue; push registration. |
| Next.js website and portal | Public owner signup/checkout in Stage B; admin operational workflows; owner-only billing management; admin exports. Technician accounts receive no portal access. |
| Shared TypeScript packages | Domain types, validation contracts, due-state calculation helpers, terminology, and API client contracts. Share behaviour, not every screen component. |
| Supabase Auth | Passwords, authentication, token refresh, password recovery, single-use expiring invitation flow, session identity. |
| PostgreSQL | Tenant data, RLS, role/assignment enforcement, transaction constraints, evidence acceptance/corrections, authoritative meter and due state, entitlement enforcement. |
| Supabase Storage | Private tenant/record-scoped photos and generated reports; immutable finalized evidence objects. |
| Supabase server functions and scheduled jobs | Trusted account operations, media finalization, notification processing, billing webhooks, retention jobs; user-driven data operations retain user authorization context. |
| Expo Push + Resend | Server-triggered push and transactional email. Resend is the proposed choice within the specification's permitted options. |
| Paddle | Proposed MoR; card-required 30-day trial and website subscription lifecycle. Choose one provider, not a dual-provider abstraction. Its documented trial flow supports payment at trial end. [Paddle trials](https://developer.paddle.com/build/trials/extend-activate-change-date-trials/) |
| Web-hosted server report renderer | Generate authorized CSV and paginated PDFs; save completed artifacts privately. Use an asynchronous job when a photo-heavy report exceeds a request's practical runtime. |

User flows are mobile/web → authenticated Supabase reads or scoped transaction functions → PostgreSQL/private storage. Accepted mutations also create notification work in the same database transaction. Workers deliver that work through Expo/Resend. Paddle sends verified billing events to a trusted endpoint, which updates entitlement data used by both clients and database policies.

The architecture is proposed rather than a claim about a pre-existing repository: the folder contains documents, not an application.

## 2. Identity, tenancy, and authorization

### Authentication boundary

Use one tenant per application user in v1, matching the specification. Keep a tenant staff/membership record linked to the Supabase Auth user; the staff identity persists when deactivated. Do not add tenant switching or multi-business membership.

Resolve the authenticated subject to a server-controlled membership and session. Never take a tenant, role, subscription state, or actor ID from user-editable metadata. Client commands omit tenant identity as an authority; the database derives it. Media allocation returns a server-chosen object path, whose tenant prefix is validated again on access.

All application access checks combine:

1. Valid authenticated session, including live session revocation check.
2. Existing active tenant membership.
3. Role and, for technicians, current asset assignment or the explicit business-wide task exception.
4. Record-specific author restrictions where required.
5. Write entitlement for mutations; read-only tenants keep authorized reads and exports.

Implement the session/membership helper so it does not recursively invoke its own RLS policy. If a narrowly privileged database helper is required, give it a fixed search path, minimal grants, and no arbitrary user-supplied query/object access. RLS also covers storage, views, and functions exposed through the API. Do not rely on hiding screens.

Native tokens use SecureStore. Web authentication uses a supported server-session/cookie flow with explicit authorization on every portal route and server operation. Never place a service credential in a client bundle. No shared cache may serve tenant pages to another session.

### Permission contract

| Operation | Owner | Admin | Technician |
|---|---|---|---|
| Manage operational config and view tenant operational history | Yes | Yes | No |
| Log hours, complete service/tasks, report issues | Yes | Yes | Assigned assets; business-wide task exception only |
| View individual evidence | All tenant evidence | All tenant evidence | Own permitted evidence within current assignment |
| Read shared current asset reading/due state | Yes | Yes | Assigned assets |
| Costs/mechanic notes and full exports | Yes | Yes | No |
| Correct evidence/resolve issues | Yes | Yes | No |
| Manage ordinary staff and assignments | Yes | Yes | No |
| Promote/demote admins or transfer ownership | Yes | No | No |
| Billing/subscription controls | Web only | No | No |

A tenant has exactly one active owner. Transfer validates the target and changes both memberships atomically; the old owner becomes an admin. Server-owned tenant subscription and role fields are not general configuration writes. Invitations and seat checks are transactional at activation.

## 3. Data model refinements needed to implement existing requirements

Retain the specification's entities, adding only supporting records/fields needed for authorization, independent schedules, immutability, and reliable delivery.

| Area | Proposed representation |
|---|---|
| Tenant/config | `tenants` plus settings for timezone and native app-lock requirement; one owner invariant. Separate editable business settings from protected entitlement fields. |
| Staff and assignments | Persistent staff/membership rows and an `asset_assignments` join table; do not maintain independently editable assignment arrays in both users and assets. Multiple assignees are supported. |
| Global seed | Read-only versioned catalog from the reviewed JSON, outside tenant ownership; stable model/family/service/task keys. Tenant-applied records have seed provenance and become editable copies. |
| Services | `service_types` for asset/type definitions and `asset_service_schedules` for each asset's baseline, effective interval, and override relationship. Due-state projection can be rebuilt from accepted evidence. |
| Tasks | Calendar recurrence definition, initial anchor, photo/notes requirements, stable checklist item IDs, and occurrence identity. No hours-based task engine in v1. |
| Evidence | Immutable readings, service sign-offs, task completions; actor, capture/receipt times, submission ID, definition snapshot/version, superseded-entry link and correction reason where applicable. |
| Restricted service data | Separate admin-only cost/mechanic-note record linked to the sign-off. Use a tenant reporting currency and fixed-precision cost values; no FX feature. |
| Issues | Original report plus append-only issue resolution events; current status is a projection. Initial proposed statuses: open/resolved, matching the specified flow. |
| Media | Tenant-owned attachment metadata, authorized parent/actor, upload/finalization state, object path and integrity hash; originals become unchangeable after evidence acceptance. |
| Delivery | Notification outbox and per-recipient/channel attempts, occurrence key, retry status, and device tokens tied to the actual signed-in user/device. |
| Commercial | Provider customer/subscription mappings, plan limits, provider events, entitlement/access-end, read-only-since, retention deadline and warning/purge state. |
| Export/operations | Scoped export jobs and file metadata; import source IDs/batch provenance; operational backup manifests. |

All tenant children have tenant-consistent references. Index actual access paths, including tenant/asset/event order, tenant/user assignments, tenant/due date, and pending outbox work. Apply positive interval constraints matching the trigger mode, nonnegative accepted hours, a unique submission ID per tenant, and constrained role/urgency/status values.

Evidence accepts append-only inserts through validated commands; general clients cannot update or delete it. Corrections preserve both original and replacement. Historical PDF content uses snapshots, not current editable names/instructions. Routine removal archives referenced records. Finalized evidence objects cannot be overwritten, moved, or deleted by ordinary users.

## 4. Authoritative scheduling and transactional writes

Server transactions own current hours, deltas, service baselines, and completion acceptance. The mobile app can preview countdowns offline, but labels them based on locally known state.

For services, use per-asset baselines as described in audit A05. Due means current accepted hours is at or above its threshold, or the local calendar date has reached the calendar threshold. For Both, either condition is sufficient. Calendar checks run even if no reading is submitted. Config edits recalculate future state without rewriting evidence. A late historical sign-off or correction must not overwrite a later effective service baseline merely because it arrived last; preserve the linked event order and validate the affected baseline in the transaction.

For tasks, generate or deterministically identify occurrences from the stored anchor/recurrence. Enforce one effective completion per shared occurrence, while retaining rejected/conflicting offline submissions locally for review. Do not count every retry or every assignee as another completed occurrence. Required notes, uploaded photos, and checked checklist items are validated server-side against the captured definition version.

For readings, compare the expected revision and current accepted value under a per-asset transaction lock. Return one of accepted, already accepted, needs confirmation, conflict, or denied. An admin correction explicitly references its target and creates a new chain entry; do not silently recompute and overwrite old recorded deltas.

## 5. Offline and media acceptance

Use durable local storage for a tenant/user-namespaced queue and read cache; tokens remain in SecureStore. Queue photo bytes in the app's private files rather than base64 payloads. Prevent device/cloud backup of token material and temporary evidence where platform configuration allows. Never allow a subsequent account to inherit the previous account's queue.

Each queued command carries a stable submission ID, captured data and time, expected relevant revision, captured definition version, and media dependencies. Persist these before displaying “pending sync.”

Sync sequence:

1. Revalidate session, active user, current role/assignment, and entitlement.
2. Allocate a server-authorized upload path and upload binary media, with size/type validation.
3. Submit the immutable command referencing uploaded attachments.
4. In one database transaction, verify authorization, dependencies, revisions, and deduplication; accept evidence and update derived state/outbox.
5. Mark the local command synced only after durable server acknowledgement. A retry after lost acknowledgement returns the original accepted result.

Uploads and database commits are not one distributed transaction: use staged attachments, idempotent finalization, and cleanup of abandoned unreferenced uploads. Do not remove committed evidence objects during cleanup.

Rejected/conflicting writes remain visible and cannot hold all unrelated queue work indefinitely; preserve dependent order while allowing unrelated work to proceed. Confirmed revoked/deactivated access triggers the explicitly adopted wipe policy. Ordinary network failure preserves cache and queue. Read-only entitlement preserves readable cache and blocks new writes; queued evidence is not accepted by trusting its device timestamp.

Avoid public or bearer-link access for sensitive photos/reports where immediate revocation is required. Serve authenticated private downloads with current authorization on each request and private cache controls. Already downloaded/exported copies are outside remote-wipe guarantees.

## 6. Notifications and export

Use a PostgreSQL outbox, not a separate messaging system. Evidence/config transactions create immediate events; a managed scheduled job evaluates due/overdue/compliance/calendar rules and creates scheduled events. Worker instances claim work so parallel runs do not routinely send duplicates. Retry transient errors with backoff, record terminal failures, and invalidate rejected device tokens. Re-evaluate recipient eligibility before sending.

Use tenant timezone and a persisted occurrence identity to handle daylight-saving changes and repeated scheduler runs. Urgent issues always enqueue both admin push and email. Keep push content minimal to avoid exposing mechanic notes, costs, or sensitive evidence on a lock screen. Delivery is best effort with observable failure, not proof the recipient read it. [Expo receipts and retries](https://docs.expo.dev/push-notifications/sending-notifications/)

Exports use a consistent authorized data snapshot. Deliver CSV tables for the stated business-data export and printable PDF equivalents for requested views; the per-asset maintenance report is the required polished report. It includes asset identity, all recorded services, hours/date/performer, photo evidence, and clearly linked corrections. Preserve originals in the report so corrections cannot conceal history. Display missing legacy evidence honestly. Escape spreadsheet formula-like values in CSV, paginate long histories, and embed authorized photo bytes rather than expiring image URLs. Admin export remains available when read-only.

## 7. Commercial lifecycle

Build this after Stage A is proven, while creating the protected entitlement boundary in Stage A. Stage A uses explicit server-provisioned Klever/test entitlement, not a public bypass or client-side flag.

Website signup establishes a verified owner identity and server-linked pending tenant, then opens Paddle checkout for a configured trial price. A successful browser redirect is not proof of subscription entitlement. Validate the checkout/subscription using signed provider events or a trusted provider query before granting trial writes. Account setup is by expiring link/password setup; do not email reusable plaintext passwords.

Persist provider events before processing; verify signature, deduplicate event IDs, reconcile current provider state when events are stale/out of order, and map subscriptions through server-controlled IDs. Never accept arbitrary checkout metadata as proof of tenant ownership. Owner billing changes are authorized against the current tenant owner, including after ownership transfer. Use the same tenant for reactivation even if the provider subscription is new.

Proposed access transitions:

| Verified condition | Application access |
|---|---|
| Trialing before its end | Read/write within seat limits |
| Active within entitled period | Read/write |
| Cancellation scheduled for future period end | Retain current rights until effective end |
| Effective cancellation, exhausted trial without active entitlement, or past due | Read/export only; start retention clock according to adopted policy |
| Verified renewed entitlement before purge | Restore writes on existing data; cancel purge deadline |
| Retention deadline reached | Recheck entitlement and deletion eligibility under lock, then purge through a resumable privileged job |

Enforce these permissions in database commands/RLS and server workers, not just client launch checks. Tenant read-only does not prevent login, export generation, billing recovery, session revocation, or necessary staff deactivation; these are narrow control-plane exceptions, not general operational write access. Notifications and recurring schedule state must not generate uncontrolled work forever for expired tenants; proposed policy is to stop operational reminders in read-only and retain only retention/account messages.

Purge coordination must prevent reactivation from racing destructive deletion. Define a final purge-start cutoff, recheck provider state, and do not grant entitlement onto partially deleted data. Maintain deletion markers in the restore process so recovery does not resurrect deleted tenants. Finalize exact retention and backup treatment before launch, rather than treating approximate wording as executable policy.

## 8. Implementation sequence and acceptance gates

### Before Stage A: resolve the contract and start external prerequisites

Incorporate the audit resolutions governing permissions, meter ordering, schedule baselines/recurrence, immutable evidence, offline limits, camera/lock behaviour, and notification precedence. Write a concise decision log for any deviations from this proposal. Obtain the legacy export/media inventory and identify the exact Klever models/revisions needed for initial seed validation.

Begin developer-account and MoR onboarding, sender-domain setup, and distribution eligibility review early. These are calendar prerequisites, not a reason to build the commercial shell before core dogfooding. Select a deployment region and confirm backup/storage requirements before real tenant data is loaded.

**Exit:** no unresolved rule that would change the core permission or evidence schema; content uncertainties explicitly tracked; known migration source and account prerequisites.

### Stage A1: secure data foundation

Set up repository, separate test/staging and production environments, repeatable migrations, two isolated test tenants, schema, constraints, RLS, session checks, and private storage. Implement transactional staff/owner/assignment changes and explicit access status. Create tests before exposing tenant reads.

**Exit:** tenant A cannot read/write/reference tenant B data or media; technicians cannot access unassigned assets, restricted columns, or prohibited staff records; deactivated/revoked sessions fail on the next online request across every access path. Test with real user tokens, not only privileged database connections.

### Stage A2: native operational workflows

Implement login/recovery and secure session persistence; optional business-configured app lock; asset/type/staff management and audited online config edits; assignment/deactivation; hours logging, plausibility confirmation/correction, service setup and three trigger modes; tasks/checklists; issue reporting/resolution; compliance dates. Apply reviewed seed copies per asset. Keep owner/admin management in the native app for Stage A.

**Exit:** Klever's staff and asset setup can be represented; due dates/readings match worked examples; lower readings and conflicts do not corrupt hours; role protections hold in the API as well as the UI. Config stays editable and history remains immutable.

### Stage A3: evidence, offline operation, notifications, and export

Complete live-camera service capture, watermarks, private media staging/finalization, definition snapshots, correction chains, durable queue/read cache, foreground retry, server scheduler/outbox, Expo/Resend delivery, and CSV/PDF exports. Provide Stage A admin report access through the native app; reuse the server export path in the Stage B portal.

**Exit:** airplane-mode capture survives restart; retries and lost acknowledgements do not duplicate sign-offs; two devices cannot silently corrupt an asset reading/task occurrence; required-photo sign-offs cannot finalize without media. Push/email are tested on real iOS/Android devices. Long PDF reports contain real evidence and explicit corrections. No local notification scheduling is introduced.

### Stage A4: migration rehearsal, recovery test, and Klever dogfooding

Import a read-only legacy snapshot into staging with source IDs, unresolved-value reporting, and preserved provenance. Reconcile the stated 3 staff, 3 machines, and 5 vans against the actual source, not just the document. Validate hours, histories, tasks, issues, assignments, and attachment counts/content. Rehearse rerunning the import without duplication.

Restore database plus object backup into an isolated environment and open representative evidence PDFs. Then use the native app in Klever's actual workflow across multiple ordinary work cycles, including poor signal, reassignment, corrections, urgent issues, and end-of-day tasks. Keep the second test tenant and reviewer data synthetic; never share Klever credentials with reviewers.

For final cutover, freeze PWA writes, export/import the final delta or complete snapshot, reconcile, then make the old PWA read-only. If rollback is needed after native writes begin, preserve/reconcile those new writes before returning to the PWA.

**Exit:** Klever confirms real daily usability; no unresolved security/evidence failures; content applicable to Klever is verified or explicitly treated as starter guidance; cutover and recovery are rehearsed. Stage B begins only after this gate.

### Stage B1: full web portal and staff invitation journey

Build the full admin portal against the existing commands/read models, preserving permissions and terminology. Add public owner setup, accepted-invite/password-setup flows, admin-config editing, notification settings, reports, and staff seat-usage display. Exercise desktop camera limitation explicitly. Block technician portal routes on the server.

**Exit:** authorized operational results match native; invite reuse/expiry and seat races are tested; no business data appears across web sessions; desktop report export works for large histories.

### Stage B2: billing, lapse, retention, and recovery

Configure final Paddle prices/seat limits and 30-day card-required trial; implement owner-only website billing, webhook verification/reconciliation, server entitlement, read-only behaviour, offline window, reactivation, retention warnings, and deletion. Map ownership transfer to current application billing authorization without assuming a subscription ID must belong permanently to the original user.

**Exit:** test trial conversion/cancellation, failed payment, cancellation scheduling, duplicated/reordered/missed events, concurrent seats, downgrade overage, and reactivation before purge. Direct API writes are denied in read-only while export works. Test purge/reactivation races and deletion recovery using test tenants and a controlled test clock; no waiting a year and no altering real customer clocks.

### Stage B3: first sellable release

Complete release builds, privacy/store disclosures, account-deletion handling appropriate to the final signup flow, reviewer tenant credentials, live provider verification, production migrations, operational alerts, and store submissions. Review the actual required disclosures against current platform requirements at submission; do not assume payment silence resolves all review rules.

Keep the specified 2–3 week review buffer as planning allowance, not an approval guarantee. Use a maintained synthetic reviewer tenant with normal isolation rules and a controlled entitlement exception, not a global backdoor. Restore/rollback instructions and support access procedures must be usable by the operator.

**Exit:** both mobile releases and web portal are deployable/approved as required, billing is verified, exports and recovery work, tenant isolation suite passes, and the documented v1 scope is complete.

## 9. Verification matrix

| Risk | Required evidence |
|---|---|
| Cross-tenant or same-tenant overreach | Every tenant table and media/export path tested for read/insert/update/delete, forged references, role escalation, inactive users, revoked sessions, and assigned/unassigned technician access. Run the specification's isolation suite on every change. |
| Meter/scheduling errors | Both-trigger boundaries, unknown baseline, early/late service, corrections, config changes, duplicate/stale readings, true monthly/day recurrence, timezone/DST, and simultaneous completions. |
| Evidence loss or falsification | API cannot overwrite sign-offs/photos; snapshots survive config edits; two timestamps and legacy provenance retained; upload/finalization crash recovery; correction chain visible in PDF. |
| Offline failures | Two devices; process termination; lost upload/commit acknowledgement; expired entitlement; reassignment/deactivation; account switch; disk/upload failure; blocked queue visibility. |
| Notification errors | Due-event deduplication, immutable urgent minimum, inactive/unassigned recipient handling, timezone scheduling, retries, invalid push tokens, and actual-device delivery observations. |
| Billing bypass/data loss | Verified provider identity/signatures, event replay/out-of-order reconciliation, database write denial, seat races, read-only exports, retention warnings, purge/reactivation locking, and restored deletion markers. |
| Operational failure | Repeated migration reconciliation, combined database/media restore, long export rendering, production deployment rollback with evidence preservation. |

Choose maintained Expo/Supabase/Next.js-compatible versions at implementation start and verify integrations against their then-current official documentation. Pin the tested set, use development builds for native capabilities, and release OTA JavaScript changes only to compatible native runtimes. No build-duration or operating-cost guarantee is implied by this architecture; measure actual storage, image export, notification, and backup usage before promising a budget.
