# KLEVER ASSETS — Build Specification v4.0

> **Historical version — superseded 9 September 2026.** Build from `Klever_Assets_Build_Spec_v4_1.md`, `Klever_Assets_Implementation_Plan_v4_1.md`, and `AGENTS.md`. This file and its original Word copy are retained for reference; their old assumptions do not override v4.1.

*Standalone, Multi-Tenant Native Rebuild — Agent Build Brief*
Prepared for Che Boielle — Klever Carpet Cleaning
Supersedes: Product Scope Document v3.0

---

## 0. How to use this document

This is an implementation brief intended to be built from directly, including by an agentic coding tool attempting a large or one-shot build. It states **decisions, not options** — every open question from earlier scoping has been resolved. Where a requirement is security- or data-integrity-critical it is marked **[CRITICAL]**; those must not be simplified away for speed. Section 13 lists the guardrails the builder must follow regardless of how fast the build goes.

"Klever Assets" is a working title only; final brand, product name and domain are placeholders throughout.

---

## 1. Product overview & positioning

Klever Assets is a simple, affordable asset/fleet maintenance tool for small field-service businesses (roughly 2–15 staff, a handful of vehicles/machines): carpet cleaning, plumbing, landscaping, couriers, trades. It tracks machines and vehicles, who's responsible for them, service intervals, recurring tasks, issues, and compliance dates — and tells the right person when something needs attention. It began as an internal single-tenant PWA for Klever Carpet Cleaning and is being rebuilt from the ground up as a sellable, multi-tenant native product.

**Beachhead:** carpet-cleaning truckmount operators. The build ships with a seeded library of common truckmount maintenance schedules (Section 8) so those users get near-zero-effort onboarding. Klever Carpet Cleaning becomes tenant #1.

**Standing design principle:** stay simple and cheap to run. It is deliberately *not* a competitor to enterprise CMMS/fleet platforms (Fleetio, MaintainX, Fiix), which are criticised for complexity and pricing that climbs with team size. Every future feature — from Che or from a paying customer — is weighed against whether it keeps the tool simple, or drags it toward enterprise complexity. When in doubt, leave it out.

---

## 2. Technology stack

All choices favour managed services that offload backup, security and scaling from a solo builder.

| Layer | Choice | Notes for the builder |
|---|---|---|
| Mobile app | **Expo (React Native)**, single codebase → iOS + Android | Use Expo managed workflow. Use EAS Build for store binaries and EAS Update for over-the-air JS updates. Use Expo modules for camera, notifications, secure storage, local auth. |
| Backend / DB / Auth / Storage | **Supabase** (managed PostgreSQL) | Postgres + Supabase Auth (JWT, refresh, revocation) + Supabase Storage + **Row-Level Security** for tenant isolation. This is the keystone: isolation is enforced *in the database*, not in app code. |
| Admin web portal | **React (Next.js)** web app | Full-featured portal for desktop admin use, calling the same Supabase backend. Shares data types/models with the mobile app. |
| Billing | **Merchant of Record** — Paddle or Lemon Squeezy (choose one) | The MoR is the legal seller and remits worldwide sales tax / VAT / GST. Do **not** use raw Stripe. Do **not** use App Store / Play in-app purchase. |
| Push notifications | **Expo Push** (wraps APNs + FCM) | Single integration for both platforms. All scheduled/cross-user notifications are server-triggered. |
| Transactional email | **Resend or Postmark** | For staff invites, password resets, urgent-issue email fallback, and retention-purge warnings. |
| Hosting/deploy | Supabase (managed) + a host for the web portal (e.g. Vercel) + EAS for app builds | Git-based deploys and Supabase migration tooling. No manual file-manager/db-console editing of production. |

**Framework note:** Flutter is a valid alternative to React Native; Expo/RN is chosen to keep the mental model close to the existing JS app and because it is the best-supported path for AI-assisted building. If switching to Flutter, keep every other decision in this document unchanged.

---

## 3. Architecture & multi-tenancy

- One shared PostgreSQL database serves all businesses (tenants). Every tenant-owned table carries a `tenant_id` column with a composite index on `(tenant_id, <natural lookup key>)`.
- **[CRITICAL]** Tenant isolation is enforced by PostgreSQL **Row-Level Security** policies, not by application code remembering to filter. Every tenant-scoped table has RLS enabled and a policy restricting rows to the authenticated user's `tenant_id`.
- `tenant_id` is derived server-side from the authenticated session/JWT. It is **never** accepted as a value from the client.
- File uploads (photos) are stored in **tenant-scoped storage paths** with storage access rules that mirror the RLS boundary. Never a shared bucket keyed only by filename. Uploads are binary (multipart / direct-to-storage), **not** base64-in-JSON.
- This is the standard, cost-efficient architecture at this scale. Properly indexed, one modest Postgres instance serves a large number of small tenants; monitor and scale compute as real usage dictates rather than pre-provisioning.

---

## 4. Security & tenant isolation — non-negotiables

**[CRITICAL] All of the following are required, not optional:**

1. **RLS on every tenant-scoped table.** A row is visible only to users whose session `tenant_id` matches the row's `tenant_id`.
2. **Deactivation cuts access immediately.** Every user row has an `is_active` flag. The flag is checked *inside the RLS policies*, so the moment an admin deactivates a user the database stops returning any tenant data to that account on the next request — regardless of any token still on their device. In addition, revoke the user's refresh token so no new session can be minted.
3. **Tokens encrypted at rest on device** using Expo SecureStore (iOS Keychain / Android Keystore). Never plain-text token storage.
4. **App lock (biometric/PIN)** via Expo local-auth. **Default OFF**, admin-configurable per business (business-wide setting).
5. **Remote sign-out.** Admin can revoke a user's sessions from the portal (same mechanism as deactivation, without the permanent flag).
6. **Cache clears on failed auth.** When a revoked/deactivated device next launches and auth fails, the app wipes its local read-cache. This is the practical "remote wipe"; full MDM-style wiping is out of scope.
7. **Passwords** hashed by Supabase Auth (bcrypt/argon2). **Staff invites** single-use and expiring. **Tokens** short-lived with refresh.
8. **Isolation tests are part of the build** (see Section 13): automated tests that log in as tenant A, attempt to read/write tenant B's rows, and assert zero rows / denied.

---

## 5. Data model

High-level schema. Column lists are indicative; the builder finalises types and constraints. Every tenant-owned table has `tenant_id` (indexed, RLS-scoped), `created_at`, `updated_at`.

| Entity | Purpose & key fields | Mutability |
|---|---|---|
| `tenants` | One row per business: name, subscription_status, plan_tier, created_at. | Config |
| `users` | Staff + admins: tenant_id, role (owner/admin/technician), name, email, phone, **is_active**, assigned_assets. | Config (but see is_active in §4) |
| `asset_types` | Per-tenant asset categories (not hard-coded to machine/van): tenant_id, name. | Config |
| `assets` | Machines/vehicles: tenant_id, asset_type_id, name/serial, status (Active/Out of Service/Workshop/Other), current_hours, current_odometer (nullable), assigned staff, photo path. | Config; status changes logged to history |
| `asset_history` | Audit trail: status changes, assignment changes, edits — who/when/what. | **Append-only** |
| `hour_logs` | Every hours (or odometer) reading: tenant_id, asset_id, logged_by, value, delta_since_last, capture_time (device), server_time. | **Append-only** (see §6.3) |
| `service_types` | Service templates: tenant_id, name, applies-to (asset or asset_type), **trigger_mode** (hours/calendar/both), interval_hours (nullable), interval_days (nullable), instructions text, recommended_note. | Config |
| `service_history` | Completed services: tenant_id, service_type_id, asset_id, performed_by, hours_at, cost (admin-only), mechanic notes (admin-only), photo, capture_time, server_time. | **Immutable sign-off** (corrections = new rows) |
| `tasks` | Recurring task definitions: tenant_id, name, asset_id (nullable = business-wide), **trigger_mode**, interval_days (named presets + custom), next_due, requires_photo, requires_notes, checklist_items (nullable). | Config |
| `task_completions` | Sign-offs: tenant_id, task_id, completed_by, capture_time, server_time, photo, notes, checklist_state. | **Immutable sign-off** |
| `issues` | Reported problems: tenant_id, asset_id, reported_by, urgency (Minor/Attention/Urgent), status, resolution notes, resolved_by. | Report immutable; resolution appended |
| `notification_rules` | Per-tenant config: type, recipients (admin/assigned/both), channel (push/email/both), timing (day-of-week + time, or immediate). | Config |
| `compliance_items` | Dated compliance per asset (WOF, Rego, insurance, cert): tenant_id, asset_id, type, due_date, reminder_lead_days (array, e.g. [30,7]). | Config |
| `device_tokens` | Expo push tokens per user/device: tenant_id, user_id, token, platform, last_seen. | System |

**Mutability rules — [CRITICAL]:**
- **Configuration data** (assets, asset_types, service_types, tasks, staff, notification_rules, compliance_items) is fully editable at any time. Editing a field editable at creation must remain possible afterwards.
- **Evidence data is append-only or immutable:**
  - `hour_logs`: a technician can create but not edit a reading. Only an admin can correct one (up or down); a correction is a **new appended entry** carrying a reason, never an overwrite. The current value is the latest entry in the chain. A confirmation warning is shown on any admin correction.
  - `service_history` / `task_completions` sign-offs: **immutable once submitted.** Corrections are added as new entries; the original is never edited. This is what makes the record credible for warranty use.
  - `asset_history`, `issue` reports: append-only.

**Timestamps — [CRITICAL]:** every reading and sign-off records **both** `capture_time` (device clock, "when it happened") and `server_time` (when it synced/was received). Present capture_time as the event time; keep server_time as a cross-check.

---

## 6. User roles & permissions

| Role | Access |
|---|---|
| **Owner** | Exactly one per tenant (the account that signed up, holds the subscription). Full access **plus** billing/subscription control. Can promote/demote admins and transfer ownership. Cannot be deleted or demoted by another admin. |
| **Admin** | Zero or more. Full operational access: manage staff, assets, tasks, service templates, notification rules, view all history, resolve issues, edit config. Everything the Owner can do **except** billing/subscription control. |
| **Technician** | Scoped to their assigned assets only: log hours, view/complete tasks, report issues, view their own service history. No access to costs, mechanic notes, other staff's data, or settings. |

A "Supervisor" middle tier (all assets, no billing/settings) is a Phase 2 candidate, not built now.

---

## 7. Functional modules

### 7.0 UI/UX principles (apply to app and web portal)
- **Everything visual is clickable:** any element representing a record (asset card/photo, task row, staff row, history entry) opens that record's detail. No dead-end visual elements.
- **Everything (config) stays editable:** any config field editable at creation remains editable afterwards. (Evidence records follow §5 mutability rules instead.)
- **Constrained fields are dropdowns/pickers, not free text:** asset type, staff assignment, task interval, urgency, status, trigger mode — always pickers.
- **Clean, minimal layout:** generous spacing, clear hierarchy, no crowded screens.
- **Consistent between devices:** web portal and app share navigation logic and terminology.

### 7.1 Asset management
- Add/edit/remove machines and vehicles; each tenant maintains its own register.
- User-definable asset types (not hard-coded to machine/van).
- Status toggle: Active / Out of Service / Workshop / Other — admin-only, requires a reason logged to `asset_history`.
- Photo per asset via native camera/gallery picker, uploaded as binary to tenant-scoped storage.
- Full audit trail of status/assignment/edit changes per asset.

### 7.2 Staff management
- Add/edit/deactivate staff; assign one or more default assets per staff member.
- **Deactivating (never deleting) preserves history** and, per §4, immediately cuts access and revokes the refresh token.
- On deactivation, if the user had assets assigned, **prompt the admin to reassign them** rather than silently orphaning.
- Only **active** staff count toward the subscription tier's seat limit (see §9). Deactivated staff retain history without consuming a seat.

### 7.3 Hour logging & service-interval engine
- Admin defines `service_types` per asset or asset_type, each with a **trigger_mode**: **Hours** (every N hours), **Calendar** (every N days), or **Both** (whichever comes first). Seeded templates arrive pre-set to the correct mode (Section 8); the admin can override per service.
- Technician logs an hours (or odometer) reading; the app computes the delta and a live countdown to next service under the active trigger mode(s).
- **Plausibility check:** on any reading whose delta is implausibly large (e.g. a magnitude jump vs history), show a confirmation ("that's N hours since the last reading — is that right?") before saving. Prevents typo-driven false "overdue" states.
- Crossing a threshold fires a notification (§7.7) to admin and the assigned technician.
- **Sign-off flow:** live camera capture (no gallery, to discourage backdating), timestamp watermark, instructions shown, admin-only mechanic/cost fields hidden from technicians. Captured photo may queue offline; capture_time is authoritative.
- `hour_logs` are append-only; admin corrections are new entries with a reason (§5).

### 7.4 Recurring task engine
- Admin creates tasks against a specific asset or business-wide (no asset).
- Interval configurable: daily, weekly, fortnightly, monthly, or custom number of days (named presets + custom).
- A task may require photo sign-off, notes, or both.
- **Checklist tasks:** a task may carry multiple sub-items (e.g. the daily Post-Run routine has three actions). `task_completions.checklist_state` records which items were done. Used by the seeded daily-hygiene tasks.
- Overdue tasks are visually flagged and trigger escalating reminders (§7.7).

### 7.5 Issue reporting
- Any technician can report an issue against an assigned asset with urgency Minor / Attention / Urgent.
- **Urgent issues notify the admin via push AND email** (email is the reliable fallback and paper trail; push alone can silently fail).
- Admin resolves with resolution notes; resolved issues remain in history.

### 7.6 Compliance tracking (WOF / Rego / servicing)
- Each asset can carry any number of dated `compliance_items` (generalises WOF/Rego so any tenant can add their own dated types — insurance, certification, etc.).
- Reminder lead time configurable per item (e.g. remind 30 days before, then again at 7).
- Reminders go to admin by default; optionally also the assigned technician.

### 7.7 Notifications
- **Types:** hour-logging reminders, task due/overdue, service due, compliance expiring, issue reported, issue urgent, asset reassigned.
- **Per-type config (admin-controlled, per business):** recipients (admin / assigned / both), channel (push / email / both), and timing — a day-of-week + time-of-day for recurring reminders, or immediate for event-triggered ones.
- **Delivery — [DECISION]:** all scheduled and cross-user notifications are **server-triggered** (a scheduled backend job reads each tenant's `notification_rules` and sends via Expo Push and/or email). There is **no** on-device local-notification scheduling — one mechanism, schedules live server-side only.
- Dedicated **admin notification-settings screen** (app + web) to configure the above per type.

### 7.8 Admin dashboard: native app + web portal
- Admin gets a full dashboard in the native app **and** a full browser-based web portal for PC/desktop, both calling the same backend so data is identical.
- The web portal is the natural place for setup-heavy work (reviewing history, service templates, notification rules, bulk asset/staff setup) and for producing the warranty PDF export.
- Technicians are **native-app only** — no web login.

### 7.9 Offline behaviour
- **Online-first with a local offline queue and read cache** — not full bidirectional sync.
- Reads (asset list, task list, recent history) are cached locally so the app stays usable on a signal drop.
- Writes made offline (hour log, issue, task sign-off with photo) queue on-device in order and sync automatically when connectivity returns, with a visible "pending sync" indicator.
- Admin actions that could genuinely conflict (status change, reassignment, deletes) require an active connection.
- **Known limitation (documented, not engineered around):** an unsynced queue on a phone that is lost or dies before syncing loses that sliver of readings. Given typical multiple-daily connectivity this window is minutes. Revisit only if targeting genuinely off-grid trades.

### 7.10 Data export / backup
- Admin can export their business's data (assets, logs, service history, tasks) to CSV/PDF at any time.
- **[REQUIRED] Per-asset maintenance report (PDF)** — the warranty deliverable: asset name/serial, every service performed with hours-at, date, who performed it, and photo evidence, in a clean handover document. This is the artifact the whole service-history feature exists to produce.
- Optional connection to the business's own Google Drive for periodic auto-export (Phase 2, peace-of-mind extra — not the primary store).

### 7.11 Onboarding
- New tenant, during setup, picks their machine model(s) from the seeded library (Section 8); the matching service templates and daily-hygiene tasks auto-populate. This is the frictionless-signup path for the carpet-cleaning beachhead.
- Non-carpet trades use the admin-defined template path (§7.3/§7.4) until their vertical's library exists (Phase 2).
- Bulk CSV import of assets/staff is **Phase 2**; manual entry is acceptable for v1.0 because the template library removes the worst friction.

---

## 8. Seeded template library (truckmounts)

Load these as ready-to-apply `service_types` and daily `tasks`, keyed to machine models so onboarding auto-populates. Interval ranges default to the **conservative (lower) end**, with the range carried in `recommended_note` and admin-adjustable. Trigger modes are pre-set as shown.

### 8.0 Universal daily hygiene (applies to every model — seed as daily checklist tasks)
**Pre-Flight (Daily Startup)** — Calendar/daily checklist:
1. Check engine oil dipstick, high-pressure pump sight glass, and vacuum blower sight-level windows.
2. Clean the garden-hose inlet filter screen.

**Post-Run (End of Day)** — Calendar/daily checklist:
1. Empty and flush the waste recovery tank completely.
2. Clean the internal lint filter basket.
3. Spray a 5-second burst of rust-inhibiting lubricant into the vacuum blower lubrication port while running under mild load.

### 8.1 Brand 1 — HydraMaster (Boxxer / Titan / CDS)

**Group 1 — Air-Cooled Slide-In Family**
Models: Boxxer 318, Boxxer 423s, Boxxer XL, Titan 325, Titan 425, TMTG 4000.
Characteristic: air-cooled engine (Briggs & Stratton / Kohler); oil shears down fast.

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 25 h (default) | Hours | Range 25–50 h; use 25 h in hot climates |
| Check/clean spark plugs + air filters; inspect direct-drive coupler element (coupler-driven units e.g. Boxxer XL) | Every 100 h | Hours | Range 100–250 h |
| Change high-pressure pump oil + vacuum blower gear oil | Every 500 h | Hours | |

**Group 2 — Liquid-Cooled Slide-In Family**
Models: Titan 575 (Kubota), Titan 625.
Characteristic: liquid-cooled engine; roughly double the oil life of Group 1.

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 100 h | Hours | |
| Check radiator coolant + inspect engine belts | Every 250 h | Hours | |
| Change HP pump oil + vacuum blower gear oil + replace spark plugs/fuel filters | Every 500 h | Hours | |

**Group 3 — Direct-Drive (CDS) Family — engine-less**
Models: CDS 4.6, CDS 4.8, CDS 4.8SV, CDS xDrive.
Characteristic: no standalone engine; clutch to the van's engine via drive shaft. **Do not create an engine-oil service** — flag "engine maintenance = normal van vehicle servicing" (ties to odometer tracking, Phase 2).

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Check drive-shaft alignment, greasable bearings, front-end vehicle fasteners | Every 100 h **or** monthly | Both (100 h / 30 days, whichever first) | |
| Change HP pump oil + vacuum blower gear oil | Every 400 h (default) | Hours | Range 400–500 h |

### 8.2 Brand 2 — Sapphire Scientific

**Family A — Air-Cooled / Standard EFI Slide-Ins**
Models: Sapphire 370, Sapphire 370 EFI, Sapphire 460SS.

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 50 h | Hours | |
| Check air filter, inspect spark plugs, check water-pump drive-belt tension | Every 100 h | Hours | Range 100–250 h |
| Change HP pump oil + vacuum blower gear-end oil + replace spark plugs | Every 500 h | Hours | |

**Family B — Liquid-Cooled Heavy-Duty Slide-Ins**
Models: Sapphire Apex 570, Sapphire Everest 870HP.

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 100 h | Hours | |
| Flush/clean heat-exchanger manifold, inspect radiator coolant, check spark plugs | Every 250 h | Hours | |
| Full vacuum blower oil change (dual splash-bath points) + HP pump oil + replace fuel filters | Every 500 h | Hours | |

### 8.3 Brand 3 — Prochem

**Family A — Air-Cooled Legacy Workhorses**
Models: Prochem Blazer, Blazer GT, Legend, Legend GT.

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 25 h (default) | Hours | Range 25–50 h; 25 h in hot climates |
| Pull/clean/re-gap spark plugs; inspect carburetor linkages + air filter | Every 100 h | Hours | |
| Mechanical oil drain+refill: water-pump crankcase + vacuum blower gear chambers | Every 500 h | Hours | |

**Family B — Liquid-Cooled Premium Lines**
Models: Prochem Peak, Peak 500, Performer (405/Signature).

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Change engine oil + oil filter | Every 100 h | Hours | |
| Inspect drive belts; check radiator reserve tank | Every 250 h | Hours | |
| Flush/change HP pump oil + vacuum blower gear oil + replace spark plugs/fuel filters | Every 500 h | Hours | |

### 8.4 Brand 4 — Cleanco

**Family A — Direct-Drive / PTO Systems — engine-less**
Models: Cleanco Compact 45, Compact 47, Compact 56, E-Zee.
Characteristic: no standalone engine; under-van drive shaft to a PTO/clutch. **Do not create an engine-oil service** — flag "engine maintenance = van chassis servicing" (Phase 2 odometer).

| Service | Interval | Trigger | Note |
|---|---|---|---|
| Grease under-van drive-shaft U-joints; inspect centre support bearings, alignment fasteners, safety-clutch brackets | Every 100 h | Hours | Critical integration check |
| Drain+replace HP pump oil + vacuum blower gear-bath lubricant | Every 400 h (default) | Hours | Range 400–500 h |

---

## 9. Commercial model

### 9.1 Pricing shape
- **Flat tiers by size** (e.g. Starter / Pro / Business). No per-seat pricing (it would penalise adding staff to a staff-tracking tool).
- **Tier boundary = active staff count** (e.g. up to 3 / up to 10 / up to 25). Only **active** staff count (§7.2).
- The app displays current seat usage vs the tier limit to the admin. Final dollar amounts set on the website, not in the app.
- **Price with ~7–8% baked in** to cover the Merchant-of-Record effective rate (headline 5% + $0.50 plus FX/international-card add-ons).

### 9.2 Trial & billing
- **30-day trial, credit card required upfront** (captured by the MoR). Tenant sits in `trialing` state, auto-converts to paid at day 30 unless cancelled.
- Registration and payment happen on the **website via the Merchant of Record**, never in the app.
- The app authenticates the user and calls a backend **entitlement check** on login/launch to confirm the tenant's subscription is active. Offline launch falls back to the last cached entitlement for a bounded window.

### 9.3 Entitlement states & lapse
- States: `trialing` → `active` → `past_due`/`cancelled` → `read_only`.
- An expired/cancelled subscription moves the tenant to **read-only** (view + export only, cannot add new logs) — **never a hard lock and never immediate deletion.** No data-loss cliff.
- **Free-forever tier: Phase 2** — deliberately deferred until there is revenue to support a free population and a reason to want it (word-of-mouth, install base for a manufacturer pitch).

### 9.4 Data retention on cancellation — [DECISION]
- On cancel: tenant → read-only, **all data retained intact and exportable**.
- **Reactivation any time within the retention window instantly restores everything** — cancel and reactivate are the same status switch thrown opposite ways; no archive/restore step. (This is a property of *not* deleting on cancel — build it that way.)
- **Retention window: ~12 months read-only, then permanent deletion**, with email warnings before the purge. After the purge, reload is intentionally gone.
- **Delete-on-request honoured at any time** (privacy compliance — confirm specifics with an advisor; not legal advice).

### 9.5 App Store / Play Store distribution — [CRITICAL constraints]
- App is a **free download**; it contains **no purchase UI and no references to payment whatsoever** — no "subscribe", no pricing, no "sign up on our website" link. It is a login screen plus the product. (This is the standard B2B pattern: an organisation buys seats; the app just logs in. Referencing payment inside the app is what triggers IAP-rejection.)
- New-owner journey: **website → sign up (mobile-friendly) → receive credentials → open app → log in.** The app never mentions how to get an account. Marketing that a subscription is required belongs in the app-store *listing*, not in the running app.
- **Provide App Review a permanent seeded reviewer tenant** (assets/logs) with credentials on every submission — a login-walled app with no way in is auto-rejected.
- **Schedule for at least one rejection round.** New-guideline enforcement is strict and uneven; keep a 2–3 week App Review buffer and have the "B2B tool, org pays for seats" positioning ready to cite. This silent-login model is worldwide-safe and sidesteps the US-only external-payment rules entirely.

---

## 10. Migration plan
- Klever Carpet Cleaning becomes **tenant #1**. Migrate existing data (3 staff, 3 machines, 5 vans, all hour logs, service history, issues, tasks) into the multi-tenant schema, every row tagged to Klever's `tenant_id`.
- Seed a **second test tenant** with its own data. **[CRITICAL]** This pairing is what lets you actually test tenant isolation — you cannot prove isolation with one tenant.
- Run the current PWA in parallel (read-only or retired) once the native app is verified against Klever's real daily use.

---

## 11. Phasing

This is **v1.0 / First Sellable Release** — not an "MVP". A multi-tenant SaaS has a large irreducible first release. Build it in two internal stages:

**Stage A — Core (single-tenant-proven)**
Supabase backend + RLS, auth, asset/staff management, hour-logging + service-interval engine (3 trigger modes), seeded truckmount library, recurring tasks (incl. checklists), issue reporting, compliance tracking, notifications, per-asset PDF export, native app. Migrate Klever + a second test tenant. Dogfood on Klever's real operations.

**Stage B — Commercial shell**
Public mobile-friendly web signup, Merchant-of-Record billing, 30-day card-required trial, entitlement + read-only lapse + retention/reactivation, staff invites, full admin web portal. The pieces only needed to sell to strangers — layered on after the core is proven.

**Stage A + Stage B = v1.0.**

**Phase 2 (deferred, do not build now):**
Free-forever tier; curated model libraries for other trades + white-label branding + manufacturer partnership (HydraMaster etc.); OCR gauge-to-hours reading; odometer as a first-class metric (ties to the engine-less families); Supervisor role; SMS notifications; Google-Drive auto-backup; bulk CSV import.

---

## 12. Build guardrails — for the one-shot attempt

Agentic tooling collapses build time, but the risk in a multi-tenant SaaS is correctness of a few dangerous parts and the calendar-gated last mile, not typing speed. Therefore:

1. **[CRITICAL] Slow down and review three things regardless of build speed:** tenant isolation (RLS policies), auth/session revocation, and billing entitlement. A subtly wrong RLS policy is a silent cross-tenant leak that looks fine.
2. **[CRITICAL] Build isolation tests and run them on every change:** authenticate as tenant A, attempt to read and write tenant B's rows across every tenant-scoped table, assert denied/zero. Include a deactivated-user test (deactivate → assert next request returns no data).
3. **Keep the Stage A → Stage B order** even if the build is fast. Dogfood Klever on the core before bolting on the commercial shell and exposing it to strangers.
4. **Resist scope creep.** A fast build tempts more features into v1.0. Every feature is permanent support/maintenance surface; apply the "keep it simple" principle.
5. **The calendar-gated items don't speed up:** App Review, MoR approval, real-device push testing, live-data migration. Plan around them.

---

## 13. Costs & providers (as of Sept 2026 — reverify before relying; USD)

- **Setup ~US$140 one-time:** Apple Developer $99/yr, Google Play $25 once, domain ~$10–15/yr.
- **~$0/month to build:** Supabase, Expo/EAS, the Merchant of Record, and web hosting all have free tiers covering the build phase.
- **~$25–45/month once live** (Klever's real data in it): mainly Supabase Pro ($25/mo) for backups + always-on; possibly Expo Starter ($19/mo) during heavy build sprints.
- **No payment fees until there is revenue.** MoR effective rate ~7–8% for a founder selling internationally.
- **Onboarding gate:** the Merchant of Record requires a legal entity + bank account to onboard (gates going live, not building). Ties to Che's separate business-structure decision — take cross-border tax structuring to a qualified advisor; it does not affect the build.

---

## 14. Decisions log (what's settled)

- Stack: Expo + Supabase (Postgres/Auth/Storage/RLS) + Merchant of Record + Next.js web portal + Expo Push + transactional email.
- Tenant isolation via Postgres RLS, enforced in-database; `is_active` checked in policies; isolation tests required.
- Config editable; evidence append-only/immutable; hour corrections admin-only with reason into history; sign-offs immutable; capture + server timestamps.
- App lock default OFF, admin-configurable. Multiple admins; single owner holds billing.
- Pricing: flat tiers by active-staff count. Trial: 30-day, card required. Lapse to read-only; 12-month retention with instant reactivation; delete-on-request. Free-forever tier deferred to Phase 2.
- App is silent about payment (B2B login-only model); reviewer demo tenant; App Review buffer.
- Service engine supports Hours / Calendar / Both trigger modes; seeded templates pre-set.
- Truckmount library seeded in v1.0 (all 4 brands / 9 families / ~30 models).
- Notifications all server-triggered. Urgent issues via push + email.
- v1.0 = Stage A (core, Klever-proven) + Stage B (commercial shell); full web portal in v1.0.
- Brand/product name and domain: placeholders, decided later.
