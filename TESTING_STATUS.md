# Klever testing record

Updated 12 September 2026. This records proven coverage; Stage A and release acceptance remain incomplete. Historical checkpoints below preserve earlier results.

## Latest results

- Expanded UX/custom colour pass, 12 September: TypeScript and 228/228 automated checks across 18 files passed, including 150 database/permission checks. Final web/Android/iOS exports passed. Migrations 025–027 deployed; actual overview results now feed the UI helper in a database test, covering the corrected task-items envelope. Browser-detected logo refresh corrected. Summary refresh on tile/detail close verified through current exports and focused care checks.
- 31 distinct disposable browser scenarios passed at preview 8088: care 9 (colour wheel/HEX validation, shared branding/logo, asset/staff photos/edits, direct reading, issue resolution and calendar lifecycle), tasks 5 (including direct Needs attention navigation), queue/access 4, services/evidence/export 4, invitation 5 and evidence/read-only 4. Phone-width colour wheel and asset screen screenshots visually inspected. Exact photo/user/tenant cleanup completed after every run; final manifest verification returned zero test tenants and users. Owner data untouched; no real email or push sent.
- Expo Doctor: 16/21 passed. Four checks could not inspect missing host npm; online version validation recommends newer SDK 57 patch versions. Existing pinned SDK baseline retained, with haptics matching its bundled module manifest. Do not report Doctor as fully passed. Device gestures, haptics, keyboard/sheets and physical offline persistence remain phone acceptance checks.
- Android build 12 submitted from e5a470f159ddc3b7ab1d390c837b176247f0e822; provider status IN_PROGRESS at latest lookup. ID e178575a-41d2-4510-ae77-4cdad68fc477, version 0.1.0 (12), https://expo.dev/accounts/klever-nz/projects/klever-nz/builds/e178575a-41d2-4510-ae77-4cdad68fc477 . Not yet verified installable. Focused build-completion follow-up is active and will pause after handover; build 11 remains the latest verified APK until build 12 finishes.

- Android branding build 11 verified FINISHED on 12 September at 10:51 NZ. Provider completion 22:44:31 UTC 11 September; APK present, version 0.1.0 (11), source fe3e0096d4191a107f6fb1385a6bc6f1b5ace65b. Install as an update from https://expo.dev/accounts/klever-nz/projects/klever-nz/builds/5f3fc26f-5aa3-4b04-804c-d1f95b44ba25 . Verify on phone: tile icons; Business settings → Colours & logo; logo replace/remove and foreground refresh on another account; optional photo while adding a team member. This is a completed internal build, not physical-device testing or store release. No tests rerun for this documentation-only checkpoint.

- Android branding build 11 submitted successfully at 22:32:54 UTC 11 September, source fe3e0096d4191a107f6fb1385a6bc6f1b5ace65b, ID 5f3fc26f-5aa3-4b04-804c-d1f95b44ba25. Initial status NEW; not yet verified installable. Page: https://expo.dev/accounts/klever-nz/projects/klever-nz/builds/5f3fc26f-5aa3-4b04-804c-d1f95b44ba25 . Includes icons, shared themes/logo and invitation-photo setup. Physical-device acceptance is pending.

- Branding slice: 217/217 automated checks across 17 files, including 146 database/permission checks and five palette readability checks; final TypeScript and web/Android/iOS export passed. Migration 024 applied to the authorized development project. No new APK verified yet; build 10 remains the earlier installable version.
- 28 distinct browser scenarios passed against branding preview 8087: invitations/photo acceptance (5), care including shared branding and logo lifecycle (7), tasks/reconnect (4), queued reading/access (4), services/photos/exports (4), evidence/read-only (4). The two branding cases were rerun after the final logo revision fix; simulated browser foreground refreshed a technician's logo without sign-out. This is not native-device proof. Early test failures were corrected by waiting for initial equipment loading, modal dismissal and the new refresh request. All exact fixtures cleaned; six-manifest verification returned zero remaining test tenants/users. Original owner records preserved.

Previous UX baseline (11 September):

- 205 automated checks across 16 files passed, including 139 database/permission checks; mobile TypeScript and web/Android/iOS bundles passed. Expo Doctor passes 21/21 with the new pinned native slider.
- Latest hosted foundation smoke: 33 checks. Focused invitation delivery/Auth smoke: 10 checks, with all email transport intercepted.
- All 26 isolated browser acceptance scenarios were rerun during the approved UX rollout against the updated 8086 preview, with explicit grouped navigation: onboarding (5), service/photo/export (4), company tasks/reconnect (4), asset/staff/issues/compliance (5), queued reading/access changes using quick entry (4), required evidence/read-only (4). These are regression runs, not 26 additional scenarios. Native task/service notification opening is covered by route/provider tests but still needs actual phone taps.
- Disposable Auth users, businesses and uploaded photos were cleaned after testing and verified absent. Real owner records, archived QA evidence and the signed-in 8083 browser were preserved.
- Android UX review build 10 (3750c600-056f-47fd-9795-da16b240d4c0), version 0.1.0 (10), source 33c8e13, verified FINISHED at 14:04 NZ. Install from https://expo.dev/accounts/klever-nz/projects/klever-nz/builds/3750c600-056f-47fd-9795-da16b240d4c0 as an update, preserving app data. Build 9 is the earlier fallback without UX changes. Physical-device acceptance remains outstanding.
- Browser credentials are memory-only. Browser gallery/simulated-camera and network-disconnection tests do not prove physical-phone behaviour.

## Workflow coverage

| Workflow | Verified so far | Remaining acceptance |
| --- | --- | --- |
| Sign-in/invitations/access | Real Auth code/password join, admin invitation create/cancel, contact profile, deactivation/sign-out; tenant and assignment checks; queued access denial | Real invitation delivery and native onboarding; phone restart/foreground |
| Assets/meters | Actual create/edit, hours/km correction, serial changes, filters, archive/restore; blocked stale readings, safe review and unrelated queue progress | Phone forms and everyday use |
| Staff and profile photos | Actual gallery upload/replacement/removal where tested, name/phone/email/title edits, private storage checks | Physical gallery/camera selection, keyboard and reopening |
| Services | Meter/calendar/both baselines, starter and correction rules; actual simulated-camera sign-off, private costs, photo viewing, void and PDF/CSV output | Physical camera capture and native sharing |
| Tasks | Actual shared/individual progress, checklist/notes/photo validation and completed evidence; monthly date and void; short browser reconnect | Phone photo entry and persistence through app restart |
| Issues/compliance | Automatic synced issue display, admin resolution, technician limits, calendar creation/renewal/archive/restore | Phone usability and actual reminders |
| Settings/dates/times | Menu, calendar year/month/day selection, half-hour choice and protected saves | Phone keyboard/calendar/time controls |
| Exports/read-only | Actual downloaded CSV/PDF with embedded service images and corrections; admin export during read-only; queued work retained and synced once after restoration | Native download/share; production billing still gated |
| Offline | Actual browser stale/lower reading block, review, assignment denial, deactivation wipe, unrelated queue progress, task reconnect; underlying persistence tests | Airplane mode plus app restart/media recovery on actual phones |
| Notifications | Server scheduling/deduplication/recipient/worker tests, Firebase/Expo credential setup | Verified sender/worker activation and authorized phone delivery/tap |

## Short phone checklist

Install the latest FINISHED internal APK as an update; keep existing app data and pending work. Use designated test records.

1. Sign in, switch apps, pull to refresh and close/reopen Klever. Confirm there is no extra unlock screen.
2. Upload/replace an asset and staff picture, cancel once, and reopen to confirm persistence.
3. Edit a field low in a form; select a date and reminder time. Confirm keyboard visibility and saved values.
4. Record a reading and photo-backed task/service in airplane mode, close/reopen, reconnect and confirm one retained record/photo with clear sync status.
5. Try invitation-code/password setup on the phone once a verified sender and intended recipient are authorized.
6. After notification delivery is configured, receive/tap an authorized alert and confirm the permitted record opens.

Record results separately for Android and iOS. No real customer messages or charges are authorized by this checklist.

## Known incomplete work

Native invitation onboarding is implemented and browser/hosted tested; real delivery remains disabled. Physical-device acceptance, verified sender/authorized test delivery, legacy export with original media and offsite database/photo backup plus hosted restore proof remain release gates. Full portal/public signup/Paddle/retention and the broad visual redesign are still gated. Do not treat a successful APK as release or store approval.

## Signed-in browser pass — 10 September, evening

Passed through actual UI controls on the owner account:

- Top-right menu opens and navigates to Settings; primary tabs switch pages.
- Reminder half-hour selection works; unsaved change discarded without changing business settings.
- Team photo and persisted name/phone/contact email/title load; edit form opens. No real staff details changed.
- Created a labelled QA vehicle at 1,240 km, reopened it, renamed it, and retained the reading/unit.
- Saved an asset-only Both service at 100 km / 30 days with a 1,200 km baseline and calendar date 10 September 2026. Displayed 60 km remaining and due 10 October. Logged 1,250 km; reopened to verify +10 km history and 50 km remaining.
- Calendar month/year controls changed to February 2027, correctly offered 28 days, selected 28 February and saved compliance with that exact date.
- Created a monthly asset task with checklist/required notes. Submission rejected each missing requirement, then saved a complete entry; reopening showed next due 10 October 2026.
- Company task form exposes shared/per-technician modes and custom-day interval. Inspected and cancelled without adding company-wide test work.
- Changed only the QA asset to Workshop; counts and workshop tile filter matched. Archived it and verified it appears in the archive while active counts returned to the three existing assets.
- Settings asset-register CSV export returned “Export prepared.” File contents/download location were not separately inspected in this UI pass; actual export endpoints were covered by the earlier hosted checks.

Observed issue: successful task sync left the submission screen showing only “saved on this device” and stale completion history. Fixed task history refresh after sync and exact-submission receipt messaging for tasks/services. A service pending correction explicitly still requires admin review. Added tests preventing unrelated/missing history from being presented as successful sync. No schema changes.

QA data retained in archive: asset “QA ONLY — browser workflow edited”, serial “QA-20260910-BROWSER”, with one service schedule, one compliance date, one reading and one completed task. Preserved its test history; no real asset or staff record was edited. Do not delete real history or change tenant entitlement to remove this test evidence.

Remaining UI coverage includes technician-role walkthrough, camera/file selection, all correction/restore screens, actual downloaded output inspection, and post-fix sync-message confirmation. Team invitation flow is still not built. This pass is substantial coverage, not an assertion that every option has been device-tested.

## Overnight restore/correction pass — 10 September, 22:32–22:36

Android build 5 (`5321b229-5f94-4bae-9599-b8e53dad0b63`) verified FINISHED. Browser remains signed in on build-4 export; post-fix sync messaging is still not UI/device verified.

- Archived QA asset shows retained schedules/history, and operational save/add/correction controls are disabled.
- Restore returned it to the current list at the original 1,250 km, with service/task/compliance history intact.
- Downward reading correction to 1,245 km required explicit confirmation. Reopening showed the -5 km correction and reason, linked to the retained 1,250 km original.
- Task correction calendar selected 11 September 2026. Confirm void stayed disabled until checked. Saving retained the completed checklist/notes, marked it voided with the reason, and reopening showed next due 11 September.
- QA asset rearchived after checks. No real assets/staff/settings changed. No photos/notifications sent.

These paths passed without code changes; no repeat automated suite was needed. Next independent construction: scoped secure staff invitation/onboarding. Remaining browser gaps include service/photo corrections and technician-role flows; actual phone capabilities remain unverified.

Invitation backend acceptance: 8 new database tests passed for pending-seat accounting, retry identity, tenant/admin access, verified email/session, single-use acceptance, capacity, cancellation/expiry/read-only handling, deactivated membership protection and inviter demotion. Latest hosted run passed 33 checks including the new invitation path. Admin/join screens and secure email/password delivery are still pending; database support does not mean staff onboarding is available in the installed app.


Invitation UI/Auth implementation checkpoint — 10 September ~23:16: admin prepare/list/cancel and recipient details/password/accept screens are implemented locally. New-user routing and offline sync preserve an unprovisioned Auth session while clearing business cache; inactive/revoked sessions still sign out. Native invitation listener protects an already signed-in account and requires Supabase email proof. Latest automated run: 192 passed, including 134 database isolation checks; TypeScript and all-platform exports passed. New link tests cover route/proof validation, existing/uncertain sessions and failed verification; sync regressions cover invitation routing versus revocation. New screen interaction, cold/warm links and password setup are not yet browser/device accepted. Auth invitation generation/Resend delivery is the next unfinished slice; UI correctly says no email has been sent. No new hosted data or communications in this checkpoint, and installed build 5 does not contain these screens.


Invitation delivery acceptance — 10 September ~23:35: 201 local checks passed (139 database isolation); mobile/handler TypeScript and three platform exports passed. Migration 023 and disabled staff-invitation endpoint deployed. Ten actual development Auth/database checks passed for new and existing unconfirmed account generation, one-use code verification, password setup, technician acceptance, retry cooldown and endpoint authorization. Resend transport was intercepted for every test; real email delivery remains OFF and unverified. Exact synthetic cleanup verified zero test tenants/users/invitations after including default reminder-rule rows in the cleanup transaction. Separate browser preview at 8084 verified invitation form navigation, empty/incomplete-input validation and clearing inputs on Back. The signed-in owner preview was preserved. Full authenticated invitation UI and real Android onboarding remain unverified; the upcoming APK will contain the flow.


Authenticated browser onboarding — overnight 10/11 September: five complete UI checks passed in isolated synthetic Chrome contexts (412×915): visible menu with long company name; admin create/cancel invitation and disabled-email feedback; recipient email-code verification, details, six-character password and technician join; owner sees accepted phone/title with pending invite removed; deactivation blocks fresh login. Fixed the observed header overflow. All 201 automated checks, mobile TypeScript and all-platform exports passed after the fix; final isolation rerun passed 139. Synthetic cleanup verified zero browser-test businesses/accounts across the runs. No real account/profile or email used. Native device onboarding is still outstanding.

Visual preview issue resolved separately: web-only export plus scripts/serve-web-preview.py successfully serves the long pnpm font path on Windows. HTTP root/font 200, ionicons FontFace loaded and screenshot visually shows menu/tile/tab icons. Earlier combined-export screenshots with boxes are not valid evidence of Android icon rendering. Correct preview is 8085; installed/build-6 header remains the preceding version until the next native update. Build 6 was last checked IN_QUEUE, not yet claimed finished. Remaining useful browser coverage: service evidence/cost/correction and downloaded output flows; do not repeat already-passing invitation checks merely to fill time.


Service evidence, privacy, correction and output UI — 11 September 00:18: four complete isolated-browser checks passed. Owner and technician captured simulated-camera images through the real UI, uploaded/stamped evidence and received confirmed sync; technician saw only own evidence and no private cost/notes/correction controls. Owner void required confirmation, retained the original photo/cost and recomputed an explicit baseline. Actual UI-triggered CSV/PDF downloads contained both service records, admin cost and void history. Two-page PDF text and both rendered pages were inspected; both timestamped photos, headings and page numbers were readable without clipping. Physical phones and offline/native media remain unverified. All 139 isolation checks passed after the new runner; full unchanged suite remains 201. No app code/migration change or new build in this slice. Build 6 verified FINISHED. All service-test accounts/businesses and final photo objects cleaned and verified; real records were untouched.


Company tasks and browser reconnect — 11 September ~00:31: four actual UI checks passed with isolated owner/two-technician sessions. Both completion choices can be created; shared completion advances everyone once; individual completion leaves the other technician due and admin progress reflects each person; a browser-offline completion stays queued until reconnect and creates one record, with both technicians then current. Fixed stale failed-history text remaining after exact confirmed task-sync success; browser verifies it clears. All 201 local checks (139 isolation), mobile TypeScript and web/Android/iOS exports passed. Final fixture verification: zero task-test tenants/users. No real phone/offline restart or photo capability was tested here. Fix is in local source/8085 preview, not finished Android build 6.


Asset/staff/care browser acceptance — 11 September ~00:44: five isolated actual UI checks passed for asset gallery upload/replace/remove, confirmed hours-to-km correction and serial edit, staff photo replacement/contact edits, technician issue/admin resolution, and calendar compliance create/renew/archive/restore. Fixed issue list failing to reload when its queued report finished syncing; automatic appearance is now asserted. All 201 tests (139 isolation), TypeScript and three platform exports passed; final harness adjustment reran 139 isolation checks. Real phone gallery/keyboard/lifecycle remains unverified. Gallery fixture is the previous synthetic-camera PNG. Exact cleanup verified zero care-test tenants/users and four final photo paths absent. No real records or communications used. Fix is local/8085 preview pending a combined Android update.


Queued reading/access browser acceptance — 11 September ~00:54: four isolated actual UI checks passed for stale reading block with unrelated queue progress; technician lower-value rejection and corrected-value resubmission exactly once; reassignment denying queued asset writing while retaining blocked feedback; deactivation clearing workspace/pending work and returning to login. Accepted values remained correct throughout. 139 isolation checks passed; no product change, so latest full suite remains 201. Final hosted cleanup verified zero test tenants/users. Physical-phone persistent queue/restart remains unverified. Android build 7 was checked once and remains IN_QUEUE.


Required evidence/read-only acceptance — 11 September ~01:05–01:13: four isolated owner-browser checks passed: checklist/notes/photo omissions create no task completion; gallery task photo plus notes/checklist upload/sync/view; read-only access retains a queued reading and blocks writes; admin CSV remains downloadable and restoring synthetic internal entitlement syncs once. Fixed stale workspace access display after queue validation: subscriber now applies current matching-user allowed access to the screen, immediately updating read-only notice/editing controls. Backend already blocked writes correctly. All 201 tests, TypeScript and platform exports passed. Four queue/access regression scenarios also passed after this change. Exact cleanup verified zero evidence/queue-test tenants/users and final task-photo path. No billing provider or live delivery used. Read-only display fix not in build 7.


Final packaging failure/repair — 11 September ~03:17: build 8 ERRORED in the Android Kotlin classpath snapshot tool with a Java map ClassCastException. Build 7 remains the finished fallback. Separate missing direct expo-font peer fixed by explicitly pinning the existing 57.0.3 version. Local dependencies restored to their original isolated layout after interrupted hoisted installs. All 201 tests, TypeScript and platform exports passed afterward; Expo Doctor 21/21 passed when npm was supplied to the diagnostic. Clean-cache replacement build still pending; do not label build 8 installable or the repaired source device-tested.


Morning verification — 11 September 08:02 NZ: build 9 FINISHED, source a7eece9. Overnight automation paused; no further code/tests needed for this handover. Next evidence is the short Android device checklist above. Successful packaging is not store approval, production cutover or native camera/offline/push acceptance.
