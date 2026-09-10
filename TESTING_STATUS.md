# Klever testing record

Updated 10 September 2026. This is a coverage record, not a claim that the app is release-ready. Keep it current as screen and phone testing proceeds.

## Latest results

- 177 automated checks passed across 13 files, including 126 database/permission checks.
- The 126 database checks passed again after extending the hosted test script.
- 32 checks against the actual development Auth, database, photo storage and export endpoints passed with disposable businesses/users/photos. No customer notifications sent. Cleanup independently verified zero remaining test businesses, users or photos.
- Android version 0.1.0 (4), build `59ce0345-3a46-4b8c-b59d-b83290dfccdc`, verified FINISHED. This confirms packaging, not phone acceptance.
- Browser preview loads the sign-in form. Authenticated screen walkthrough awaits owner sign-in at http://127.0.0.1:8083/ . Preview uses the current exported build; browser sessions are intentionally memory-only.

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
