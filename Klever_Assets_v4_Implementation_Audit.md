# Klever Assets v4 — Implementation audit

> **Historical audit — superseded for implementation on 9 September 2026.** The owner's simplicity decisions and delegated builder defaults are incorporated into `Klever_Assets_Build_Spec_v4_1.md`. Most items below are ordinary implementation responsibilities, not unresolved product blockers. In particular, immediate read-only on first payment failure and forensic timestamp-anomaly handling are not the current requirements. Do not reopen this audit as a prerequisite to building. Use v4.1 and its matching implementation plan.

Audit date: 8 September 2026. No application code or source specifications changed.

## Assessment

The intended product is implementable with the selected stack. The document is not yet safe to build from as a fully resolved brief: several rules produce different permissions, due dates, evidence records, or subscription behaviour depending on interpretation. Some provider guarantees are also overstated.

The findings below are limited to contradictions, meaningful missing behaviour, unsafe assumptions, and unavailable inputs. Proposed resolutions are recommendations, not decisions already made by the product owner. Routine schema details and provider selection belong in the accompanying architecture, not in a list of specification defects.

## Sources reviewed

- `Klever_Assets_Build_Spec_v4.md`: primary specification; section references below refer to this file.
- `Klever_Assets_Build_Spec_v4.docx`: extracted paragraphs matched the Markdown after removing formatting and punctuation. No substantive Word-only requirements found.
- `klever_assets_template_seed.json`: inspected structure, instructions, family/model mapping, and intervals.
- `Truckmount_Maintenance_Schedule.pdf`: all five pages read and visually inspected. This is a supplied summary, not a set of manufacturer manuals.

Provider findings use linked primary documentation checked during this audit. Manufacturer checking was a targeted spot-check, not certification of all 29 models. Prices, seller eligibility, tax treatment, and legal retention obligations were not comprehensively audited; the plan does not rely on the stated cost estimates or incorporation assumption.

## Genuine findings

### A01 — Immediate revocation and cache clearing need an explicit access check

**Security blocker. References: §§3–4, 7.9.**

Checking `is_active` in RLS can stop a deactivated account accessing rows on its next request. Revoking refresh tokens alone does not invalidate an already-issued access token. Remote sign-out without deactivation therefore needs an additional live session check. Also, an RLS-denied read may return an empty result rather than an authentication error; waiting for “auth fails” will not reliably trigger the promised cache wipe. Supabase documents checking the JWT's `session_id` against the current session record. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

**Proposed resolution:** enforce current active membership and current session validity for database, storage, exports, and server operations. Return an explicit access-status response on launch, foreground, and reconnect. Clear account-local data after confirmed revocation/deactivation; distinguish this from network failure. Immediately deny new online requests after revocation is committed. Already-downloaded data cannot be remotely erased while a device remains offline; state that boundary explicitly.

### A02 — Tenant RLS and hidden fields do not implement the technician permissions

**Security blocker. References: §§3–6, 7.3.**

The written baseline policy permits every active user in the same tenant to see the same rows. Technicians instead need assigned-asset restrictions and protection from other staff's records. Keeping cost and mechanic notes on an otherwise readable service row and merely hiding their controls does not protect those values from API reads. Storage must also enforce asset/record access, not just the tenant prefix.

**Proposed resolution:** combine tenant, active-user, live-session, role, assignment, and record-author rules. Put restricted service details in a separately protected table. Use tenant-consistent foreign keys so a tenant A row cannot reference a tenant B asset or completion. Restrict writes to roles, subscription state, actor identity, tenant identity, server timestamps, and derived readings. Apply equivalent rules to photos, export files, joins, and functions. Keep privileged service credentials exclusively on trusted servers. [Supabase Storage access controls](https://supabase.com/docs/guides/storage/security/access-control)

### A03 — Business-wide tasks and role exceptions are unresolved

**Behaviour blocker before permission implementation. References: §§6, 7.2–7.4, 7.8.**

Technicians are scoped to assigned assets, but business-wide tasks have no asset. It is not stated whether one completion satisfies the business or each staff member must complete it. The role list does not explicitly grant service sign-off despite §7.3 describing technician service sign-off. “No other staff's data” is also unclear for shared asset logs and issues. Owner protection says an admin cannot demote/delete the owner, but does not address deactivation or who may promote other admins.

**Proposed resolution:** active technicians may see business-wide tasks and complete a shared occurrence once for the business; permit assigned-asset service sign-off; expose shared current asset readings/due state, but only the technician's own evidence records. Current assignment remains required to see their own asset history. Admins/owner see operational evidence tenant-wide. Only the owner manages admin roles and ownership; admins cannot deactivate the owner. An active owner must always exist, including during transfer. If per-person business tasks or shared staff history are intended, that must be stated instead.

### A04 — Odometer support is both included and deferred

**Scope contradiction. References: §§5, 7.3, 8.1, 8.4, 11.**

The schema and logging flow explicitly allow odometer readings. Phase 2 defers odometer as a first-class metric. There is no metric discriminator or distance-trigger mode, so implementing “hours or odometer” literally could mix incompatible measurements and service thresholds.

**Proposed resolution:** v1 logs hours only. Vans remain assets with tasks, issues, compliance, and calendar servicing. Preserve any migrated odometer information with its original unit as legacy data; do not reinterpret it as hours. Defer distance entry and distance-triggered servicing together. A nullable reserved odometer field is not a v1 feature.

### A05 — The service engine lacks a starting point and reset rules

**Data correctness blocker. References: §§5, 7.3, 7.11.**

An interval alone cannot determine the first due reading/date for a used machine. The specification does not define initial baseline, unknown prior service, early/late service, or how a corrected sign-off resets a schedule. `service_types` can apply to an asset type, but each asset needs independent service state and a way to apply the stated per-service override.

**Proposed resolution:** each asset/service pairing has its own effective schedule and starting date/hours, supplied from known last service or explicitly entered baseline. Unknown baseline means “baseline required,” not “just serviced.” The next hours threshold is last effective service hours plus interval; the next calendar threshold is last effective service date plus interval. Both means either threshold is due. A valid completion resets both baselines. Type defaults are inherited unless overridden; changing a default changes future calculations for inheriting assets, never past evidence. Record the initial baseline as an administrative fact, not a fabricated service sign-off.

### A06 — Calendar recurrence, checklist completion, and escalation are underspecified

**Behaviour blocker. References: §§5, 7.4, 7.6–7.7, 8.**

“Monthly” could mean a calendar month or 30 days. There is no business timezone, first task due date rule, late-completion rule, or daylight-saving rule. Escalating overdue reminders are required but no escalation cadence is supplied. A checklist records partial state, without saying whether that counts as completion. `tasks.trigger_mode` suggests the three-mode service engine, although tasks have only calendar intervals and no hours interval.

**Proposed resolution:** v1 tasks are calendar-only. Use tenant timezone and explicit initial due date; daily/weekly/fortnightly are 1/7/14 local calendar days. Use true calendar-month recurrence for the monthly preset, with end-of-month clamping and the original anchor retained; custom days remain day intervals. The CDS service is explicitly 30 days as written in its trigger column. One late task completion closes the current overdue occurrence and advances to the next future scheduled occurrence, without inventing missed completions. All checklist items must be checked for sign-off. Choose a concrete overdue cadence before acceptance testing; a minimal proposal is due-day notification, then one daily overdue reminder, adding admins after seven days. No new configurable escalation designer is needed.

### A07 — Offline ordering does not define a valid meter history

**Data correctness blocker. References: §§5, 7.3, 7.9.**

Queue order is only local to one phone. Two phones can upload readings in a different order from capture. Making the latest received row the current reading can move hours backwards; sorting by an untrusted device clock can also corrupt the result. Client-computed delta is therefore only a preview. The document also does not say whether technicians may submit a lower reading, or which reading an admin correction replaces.

**Proposed resolution:** give every queued operation a persistent unique ID and expected meter revision. Validate and serialize acceptance per asset on the server. A technician reading may equal or increase the current value; a lower or stale-base reading becomes a visible conflict and does not silently change current hours. An admin correction appends an explicitly linked correction with reason and new accepted value. Recalculate due state from the accepted chain. Retrying an operation returns the existing result. Pick and document a deterministic plausibility threshold before testing; it remains a confirmation, not a substitute for these integrity rules.

### A08 — Evidence immutability is incomplete without snapshots and protected photos

**Evidence integrity blocker. References: §§5, 7.1, 7.3–7.5, 7.10.**

Editable template names, instructions, and checklist items can change the apparent meaning of old completions if reports join only current config. An immutable database row still has mutable evidence if its photo can be overwritten or deleted. Correction rows have no defined supersession relationship or authority. The issue entity combines an immutable report and editable resolution. Removing an asset or task can also destroy its retained history if implemented as cascading deletion.

**Proposed resolution:** snapshot the completed definition, checklist labels, and relevant asset/performer display identity at sign-off. Use unique immutable photo objects and finalize sign-off only after required uploads exist. Model corrections as linked replacement/void entries, admin-only with reasons, preserving originals and distinguishing a correction from another service. Separate issue reports from appended resolution events. Treat routine “remove” as archive/hide when referenced by evidence; tenant purge is a separate privileged retention operation. Configuration remains editable, while historical snapshots remain fixed.

### A09 — Device capture time cannot prove when maintenance happened

**Unsafe evidence assumption. References: §§5, 7.3, 7.10.**

An offline device clock can be changed. Live-camera-only capture and a watermark discourage misuse but do not authenticate time or prove that the photographed service occurred. Calling capture time authoritative for warranty evidence overstates the guarantee.

**Proposed resolution:** retain it as the displayed user/device-reported event time, alongside server receipt time and provenance. Use server time for entitlement, retention, and notification processing. Flag material timestamp anomalies and require correction of unusable future/invalid dates before they reset schedules. Preserve imported timestamp uncertainty. Describe the PDF as a maintenance evidence record, with warranty acceptance determined externally; no additional signature or attestation product is proposed.

### A10 — Offline writes need a policy for changed authorization and expired access

**Security/data-loss blocker. References: §§4, 7.3, 7.9, 9.2–9.3.**

Service photo queuing is required, but service sign-offs are omitted from the offline write list. The bounded entitlement cache has no duration. Nothing defines queued writes after reassignment, deactivation, subscription lapse, template edits, or an auth-triggered wipe. “Sync automatically when connectivity returns” also cannot guarantee execution when the mobile OS has suspended or terminated the app. Expo explicitly notes OS delivery/execution limitations. [Expo notification behaviour](https://docs.expo.dev/push-notifications/what-you-need-to-know/)

**Proposed resolution:** include service sign-offs in the queue. Proposed offline entitlement window: 24 hours after successful online validation, bounded by any known entitlement end. After that, cached reads remain available but new writes require reconnecting. Validate current authorization at sync; do not use capture time to bypass access controls. Keep rejected submissions visibly pending/blocked rather than reporting success. Retain their captured definition version when config changed. Confirmed deactivation/revocation clears credentials, cache, queue, and photos under the remote-wipe rule; disclose that unsynced evidence is lost. Retry on foreground/reconnect and use background opportunities only as best effort.

### A11 — Urgent notification guarantees conflict with editable notification rules

**Behaviour contradiction. References: §§7.3–7.7.**

Urgent issues must notify admin by push and email, but generic per-type settings permit assigned-only, push-only, or scheduled delivery. Service threshold notifications likewise mandate both admin and assigned technician, while the general rule permits either. Business-wide and unassigned assets have no “assigned” recipient. Timezone, deduplication, and recurring versus immediate service alerts need one consistent interpretation.

**Proposed resolution:** urgent admin push plus email is an immutable minimum; settings may add recipients, not remove those deliveries. Treat service admin-plus-assigned as the default, overridable under §7.7. Include owner in operational “admin” recipients, exclude inactive staff, and fall back to admins if no assignee exists. Crossing due state emits one event; subsequent reminders use the explicit cadence from A06. Deduplicate by occurrence, recipient, and channel and retry transient failures. An accepted push receipt is not proof of device delivery; email is an additional channel, not a guaranteed human acknowledgement. [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/)

### A12 — Subscription state transitions do not fully define access or reactivation

**Commercial-stage blocker. References: §§9.2–9.4.**

“On cancel” implies immediate read-only, while trial cancellation and ordinary subscription cancellation may stop renewal at period end. `past_due` has no grace rule. A client-only launch check does not stop direct API writes. Retention is approximately 12 months without an exact start or warning dates. “Cancel and reactivate are the same status switch” works for retained tenant data, but not necessarily the billing provider: Paddle cannot reinstate a fully canceled subscription; returning customers need a new one. [Paddle cancellation](https://developer.paddle.com/build/subscriptions/cancel-subscriptions/)

**Proposed resolution:** distinguish provider state, access state, scheduled cancellation, and access end. Proposed policy: honor trial/paid access until the effective cancellation time; immediate cancellation ends writes immediately; `past_due` becomes read-only with no additional grace. Enforce write entitlement in the database and every privileged mutation. Reactivation preserves tenant/data IDs and restores write access after verified entitlement, allowing a new provider subscription ID. Retain for exactly 12 calendar months from effective loss of write entitlement, warning 30 and 7 days before purge. Reactivation cancels pending purge atomically. Deletion must cover photos/exports/auth mappings as applicable and define backup expiry and restore-time deletion handling. These timings need product confirmation before Stage B implementation.

### A13 — Active-seat enforcement lacks boundary rules

**Commercial-stage blocker. References: §§6, 7.2, 9.1.**

The actual tier limits are examples. Owner/admin counting, unaccepted invitations, concurrent activations, and downgrades below current usage are not specified. Merely displaying usage will not enforce the commercial model.

**Proposed resolution:** count every active accepted member, including owner/admin; unaccepted invites consume no seat and acceptance rechecks capacity. Enforce activation and reactivation atomically. Never deactivate staff automatically on downgrade; preserve current users and block additional activations while over limit. Final tier limits must be supplied before live prices are configured. Keep monetary amounts and billing controls on the website.

### A14 — App-store approval is not guaranteed by payment silence

**Distribution assumption to correct. References: §§6, 7.8, 9.1, 9.5.**

Apple's enterprise-services allowance depends on sales to organizations/groups for their employees or students; the guideline separately addresses consumer and single-user sales. Hiding payment references alone does not establish eligibility. Google explicitly permits consumption-only apps. The specified business product can follow this approach, but “worldwide-safe” is not a guarantee a builder can fulfill. [Apple §3.1.3(c)](https://developer.apple.com/app-store/review/guidelines/), [Google consumption-only policy](https://support.google.com/googleplay/android-developer/answer/10281818)

Full native admin functionality must also be reconciled with owner billing control and seat-tier display.

**Proposed resolution:** retain the login-only native app and website checkout; owner billing controls are web-only. Native screens show operational limits/read-only state without purchase language or billing links. Treat eligibility and review as release gates, retaining the stated review buffer. Do not promise approval or silently add IAP. If review rejects this distribution model, a product decision is required.

### A15 — The supplied seed cannot yet be represented as complete manufacturer maintenance

**Maintenance-content blocker before real operational use. References: §§7.11, 8, 14; seed and supplied PDF.**

The JSON and §8 contain **4 brands, 8 families, and 29 individual model entries**; §14 says 9 families. More materially, the supplied PDF has no manufacturer citations or revision applicability. A spot-check of the 2015 Boxxer 318 manual found initial engine oil at 8 hours, initial pump oil at 50 hours, and initial blower oil at 100 hours, absent from the seed. The existing repeating-interval model cannot represent an initial one-off interval followed by a different recurring interval as written. The manual also contains checks beyond the supplied summary. [HydraMaster Boxxer 318 manual, maintenance §4](https://hydramaster.com/Manuals/Boxxer318-OwnersManual.pdf)

The JSON filters engine-only startup checks for engine-less models; §8.0 says the same universal checklist applies to every model. Model/revision applicability and repeated application of a seed are also not defined.

**Proposed resolution:** correct the count; explicitly accept the engine-less filter; apply seed copies per asset idempotently without overwriting tenant edits. Validate the library against applicable manuals before presenting it as manufacturer-complete. A product/content decision is required between a clearly identified editable recurring-maintenance starter library and support for verified first-service exceptions. Do not silently add a new first-service engine or claim the supplied defaults cover warranty obligations. The rest of the application can proceed while this content gate is resolved.

### A16 — Managed database backup does not cover the required photo evidence

**Operational integrity blocker before real-data cutover. References: §§2, 7.10, 9.4, 13.**

Supabase database backups contain storage metadata, not the uploaded files. Database recovery alone may leave service history without its warranty photos. User CSV/PDF export is also not a full system recovery mechanism. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

**Proposed resolution:** provide operator-managed backup of object bytes and an object manifest alongside database backup; perform a combined restore drill before retiring the PWA. Set an explicit acceptable recovery point and recovery time. Proposed starting targets are 24 hours of potential loss and one business day to restore, subject to an actual restore test. This is operational protection for existing requirements, not the deferred customer Google Drive feature.

### A17 — Full desktop sign-off and “biometric/PIN” require narrow interpretations

**Platform behaviour ambiguity. References: §§2, 4.4, 7.3, 7.8.**

A full browser portal cannot always provide live-camera sign-off on a desktop without a camera. Expo LocalAuthentication supports biometrics and device-credential fallback; it does not establish a separate application PIN. [Expo LocalAuthentication](https://docs.expo.dev/versions/latest/sdk/local-authentication/)

**Proposed resolution:** interpret PIN as the device passcode, keep app lock native-only and default off, and require an enrolled device credential when the business enables it. Apply lock at launch and foreground. For service sign-off, browser live-camera capture is allowed where supported; otherwise complete it on the native app. No gallery bypass for service evidence. Confirm whether task photos share the live-camera restriction; the minimal reading applies it only to service sign-off, since task photo source is unspecified.

### A18 — Migration cannot be completed from the supplied files

**Migration dependency. References: §§5, 10–11.**

The folder contains the specification and seed sources, but no legacy database/export, photo archive, schema, or credentials. Existing records may not contain both timestamps, authenticating user IDs, or photo evidence. The migration must not fabricate those values to satisfy the new schema. The plan also needs one definitive stop-write point to avoid diverging histories.

**Proposed resolution:** obtain a read-only source export and media inventory before the migration rehearsal; map staff identities and source IDs; preserve unknown legacy values explicitly. Reconcile counts, last readings, sign-offs, and photo references. Freeze legacy writes for final import, verify, then make the PWA read-only. Provision Klever and test accounts privately in Stage A; public staff invitation UX remains Stage B as specified.

## Minor internal corrections

- §§0 and 4 point to §13 for guardrails/isolation tests; these are in §12.
- The entity table's hour-log reference to §6.3 should point to §7.3 (and the §5 mutability rules).
- §7.8's “bulk asset/staff setup” should mean ordinary desktop setup in v1, because §§7.11 and 11 explicitly defer bulk CSV import.
- The global seeded catalog is platform-owned, not tenant-owned. It can be read-only to authenticated users without a tenant ID; applied copies are tenant-scoped. This is compatible with the stated tenancy rule and is not a defect.

## What must be resolved when

Before core schema/behaviour is finalized: A01–A11 and A17. Many have straightforward engineering resolutions above; the actual choices affecting technician visibility, business-wide completion, due dates, conflicts, and offline loss should be written back into the spec.

Before real operational cutover: verify maintenance content (A15), prove combined backup/restore (A16), and supply/reconcile legacy data (A18).

Before commercial launch: finalize subscription/retention and seat rules (A12–A13), validate the distribution approach (A14), and complete provider onboarding. Core work need not wait for final prices or brand naming.

The proposed technical architecture and staged implementation plan are in `Klever_Assets_v4_Architecture_and_Plan.md`.
