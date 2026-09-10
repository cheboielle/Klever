# Klever testing record

Updated 10 September 2026. This is a coverage record, not a claim that the app is release-ready. Keep it current as screen and phone testing proceeds.

## Latest results

- 187 automated checks passed across 14 files, including 134 database/permission checks.
- The 126 database checks passed again after extending the hosted test script.
- 32 checks against the actual development Auth, database, photo storage and export endpoints passed with disposable businesses/users/photos. No customer notifications sent. Cleanup independently verified zero remaining test businesses, users or photos.
- Android version 0.1.0 (4), build `59ce0345-3a46-4b8c-b59d-b83290dfccdc`, verified FINISHED. This confirms packaging, not phone acceptance.
- Owner signed in and the browser walkthrough below passed on the build-4 export at http://127.0.0.1:8083/. The sync-feedback fix is separately unit-tested and bundled; it has not yet been retested in a signed-in UI. Browser sessions are intentionally memory-only.

## Workflow coverage

| Workflow | Verified so far | Remaining acceptance |
| --- | --- | --- |
| Sign-in and staff access | Real sign-in, remote sign-out, token invalidation, fresh sign-in after revocation, deactivation, tenant/assignment restrictions | Browser navigation in each role; phone restart and foreground without extra unlock |
| Assets and meters | Create/edit, hours/km correction with retained history, assignments, stale readings, retry, archive/restore, types | Walk through asset forms, dashboard filters and archive controls |
| Staff details and pictures | Name/phone/contact email/title saves; sign-in email preserved; private photo upload/replacement/removal rules | Edit form, keyboard visibility, photo selection/save on phone |
| Service schedules | Baseline arithmetic, calendar/both modes, starter templates, service completion, missing-photo denial, corrections, retained history | Calendar selection, camera sign-off, history discovery on screen |
| Tasks | Shared completion and individual technician progress, checklist/photo/notes requirements, void/reopen, retry and history | Task setup choices and completion flows on screen |
| Issues and compliance | Issue/resolution records, reminder queue creation, compliance renewal and access protection | Form controls, due-date calendar, discoverability |
| Settings and dates/times | Protected settings, stale-save handling, retired lock, valid date-only arithmetic, half-hour choices | Hamburger menu, calendar month/year/day choices and saved reminder time |
| Exports | Real hosted PDF/photo response, CSV/API permissions, read-only access; automated formatting/data tests | Download/share controls on phone; review generated output when format changes |
| Offline work | Queue persistence, cache isolation, retry/dependency/conflict rules in automated tests | Actual airplane mode, app restart, reconnect and exactly-once sync on phone |
| Notifications | Scheduling, deduplication, recipient/access rules and worker tests; Firebase/Expo credentials configured | Phone token registration and authorized test delivery; sender/dispatcher configuration remains incomplete |

## Short phone checklist after browser walkthrough

1. Pick and save an asset/staff photo; cancel once and retry. Confirm the saved photo remains after reopening.
2. Edit a field near the bottom of a form and select a date/time. Confirm the keyboard does not hide the edit and the selected value saves.
3. Pull to refresh, switch apps and return, then close/reopen Klever. Confirm there is no extra app-unlock prompt.
4. Record a reading and a photo-backed task/service offline, close/reopen, reconnect, and confirm one saved record with its photo. Use designated test data.
5. After test delivery is configured, receive and tap an authorized test notification; verify the right permitted record opens.

Record actual outcomes per device. Browser results do not substitute for camera, operating-system lifecycle, notification delivery or offline phone proof.

## Known incomplete work

Team invitation/onboarding is not built. Live notification delivery, legacy migration, offsite backup/hosted recovery proof and release gates remain recorded in BUILD_STATUS.md. The full visual redesign follows functional acceptance. Do not mark these as passed because related database tests pass.

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
