# Klever Assets builder instructions

Intended builder: GPT-6 Astra in Codex. This file gives project instructions; it does not select or change the running model.

## Read first

1. `Klever_Assets_Build_Spec_v4_1.md` is the authoritative product brief.
2. `Klever_Assets_Implementation_Plan_v4_1.md` defines architecture, build order, acceptance checks, and release work.
3. Read `BUILD_STATUS.md` to resume from the actual state. Update it at meaningful milestones and before ending a build session.

The matching original v4 Markdown/Word documents and the v4 audit/architecture are historical. Their unresolved questions and proposed restrictions do not override v4.1. The JSON/PDF maintenance sources are input material; do not treat them as manufacturer-validated instructions. Do not build from the old Word file.

## Work style

Build a simple maintenance app for small field-service businesses. Treat ordinary engineering details as your responsibility. Choose the smallest reliable implementation consistent with the brief; document meaningful choices briefly and proceed. Do not turn implementation details into recurring permission questions, exhaustive audits, new configuration screens, or an enterprise product.

Use Expo React Native, Supabase, Next.js, Paddle, Expo Push, and Resend as directed. Select compatible maintained package versions at build start and pin them. Do not reopen the stack without an observed blocker. Do not add AI features to the application merely because the builder is an AI model.

Keep Stage A before Stage B. Implement complete working slices, verify them, then continue. Maintain a small status record rather than creating more planning documents. On a later session, inspect actual files/tests/deployment state before trusting a previous completion claim. Do not re-audit settled decisions unless implementation reveals a real contradiction or failure.

## Autonomy and real blockers

The documentation-preparation request does not start application development or live deployment. When the user instructs you to build, carry that work through the authorized development and deployment scope without asking them to pick libraries, file structures, test tools, ordinary defaults, or routine reversible fixes.

Ask only when necessary information cannot be obtained through available access, or a decision materially changes scope, live spending, legal commitments, data loss, or the authorized deployment destination. Explain the concrete blocker and the smallest action needed. Complete all independent authorized work while waiting. Do not ask again for permission already granted. Never bypass tool approvals or claim access you do not have.

No secrets in source, logs, status files, or chat. Use available secure provider configuration. Sandbox billing and synthetic notifications during development; real customer communications and charges require the applicable live authorization. Once a deployment target and scope are authorized, perform routine deployments, migrations, smoke checks, and fixes within that scope without another ceremonial approval. Preserve recoverable data and verify the result.

## Keep these guarantees

- Enforce tenant isolation, current-user access, role/assignment permissions, and write entitlement on the server/database; hiding UI is insufficient.
- Deactivation blocks the next online request. Remote sign-out invalidates existing sessions; an active user can sign in again. To remove ongoing access, deactivate them.
- Persist short offline queues; retries do not duplicate records; stale/lower readings cannot silently reduce accepted hours. Use a simple admin correction for exceptions.
- Preserve submitted readings/sign-offs/photos against ordinary modification. Keep phone and server timestamps. No forensic clock detection, device attestation, cryptographic evidence ledger, or sophisticated conflict-merging system.
- Back up photo bytes as well as database records. Keep migrations, source IDs, and exports honest about missing legacy evidence.
- No Phase 2 functionality without a new user request.

## Verification and delivery

Run the tenant-isolation suite on every code/database change, plus focused tests appropriate to the changed behaviour. Include deactivated/revoked users, restricted admin data, offline retry, meter arithmetic, and billing access transitions. Do not inflate the test suite with trivial implementation-mirroring tests or hypothetical adversaries unrelated to these guarantees.

Test actual native capabilities on real devices where required. Report separately what is implemented, locally tested, device-tested, deployed to staging, and live. A successful build or preview is not proof of production deployment or store approval. Do not leave production paths using mock billing, permissive RLS, placeholder exports, or silent upload failures.

At session end, record completed work, exact validation results, remaining real blockers, and the next action in `BUILD_STATUS.md`. Give the user a brief plain-language update. Do not claim the product is ready until the implementation plan's release criteria are met.
