# Changelog

User-visible application releases are recorded here. Version identifiers follow
the policy in [VERSIONING.md](VERSIONING.md).

## 1.0.0-beta.4 — 2026-08-12

**Let's Go Green! 1.0 Beta 4** is a focused reliability and data-correctness
release following the registration-onboarding update.

- Prevented a temporary account-draft load failure from enabling background
  autosave and replacing newer server progress with an empty or older browser
  draft. Account-sync retry now reloads and compares the saved drafts before
  autosave resumes.
- Suppressed the expected signed-out draft warning during pre-verification Step
  2 while preserving account-scoped recovery after email verification.
- Added same-email verification recovery for a consumed code or lost response,
  plus an authenticated repair path for the rare case where email confirmation
  completed but the verified profile hook did not. Existing legal-acceptance
  history is preserved, while clients can no longer manufacture profile or
  consent rows directly.
- Kept one scoped completion-and-generation retry envelope across a network
  failure or reload. Exact onboarding completion replays return the original
  goal without rewriting data, while a changed replay is rejected instead of
  silently replacing an already completed profile, goal, baseline, or meals.
- Corrected Open Food Facts micronutrient normalization so values already
  standardized per 100 g are no longer converted using the contributor's raw
  entry unit.
- Made food-result previews identify a 100 g or 100 mL basis and reject liquid
  imports with a concrete explanation when the gram-based plan engine cannot
  calculate them safely; package labels with a gram serving remain available.
- Made external-catalog reads fail closed on malformed rows and made a repeated
  pending provider refresh replace stale source categories instead of silently
  accumulating them.
- Made private label-photo replacement crash recoverable with a preflight token,
  unique upload reservation, compare-and-swap finalization, and a private
  cleanup queue. Concurrent or interrupted uploads cannot make an older image
  current, and cleanup always rechecks that an object is unreferenced.
- Protected the immutable onboarding weight baseline behind owner-scoped RPCs,
  while preserving ordinary weight creation, editing, and deletion. Historical
  plan versions now display their saved start and target weights rather than a
  later mutable goal.
- Made logout, Settings profile updates, check-ins, weight history, plan actions,
  food lookup, and label operations distinguish a missing session from a
  retryable authentication or profile-service outage, with safe error codes and
  no raw provider or database diagnostics.
- Patched the transitive `nanoid` and `brace-expansion` security advisories and
  added a high-severity dependency audit to local verification and CI.
- Limited routine Dependabot groups to compatible minor and patch updates,
  keeping compiler and Node-type major upgrades aligned with the supported
  TypeScript toolchain and Node 22 runtime.

Database migrations in this release revoke direct authenticated weight,
profile, legal-acceptance, and legacy inner-onboarding writes; add protected
weight mutation RPCs; serialize pending external-food category replacement;
repair verified profiles without deleting any historical consent record; guard
completed-onboarding replay; and add durable private label-upload reservations
and cleanup. Existing owner-private foods and referenced evidence are preserved.
Legacy unreferenced UUID-path label objects are queued for a trusted-server
reference check before deletion rather than removed during migration.

## 1.0.0-beta.3 — 2026-08-09

**Let's Go Green! 1.0 Beta 3** focuses on a safer, clearer registration and
onboarding test path.

- Added System, Light, and Dark appearance modes. System follows the live
  device/macOS appearance without a light-theme flash, while explicit
  overrides persist locally.
- Replaced generic registration and onboarding failures with stable, safe error
  codes, concrete explanations, next actions, and retry guidance; duplicate
  registration emails are now identified while login and recovery remain
  account-enumeration safe.
- Hardened credential forms against pre-hydration browser submission and moved
  the verification-email handoff out of the onboarding URL into one-time,
  short-lived same-tab storage.
- Published Terms of Use 1.2 and Privacy Notice 1.3, effective August 9, 2026,
  for the explicit reusable-product opt-in and Beta 3 browser-data boundaries.
- Scoped browser onboarding drafts to the authenticated account, safely removed
  unattributable legacy global drafts, compared browser/account update times,
  and hardened callback redirects and blocked-storage recovery.
- Rebuilt food discovery as one overflow-safe, explicitly submitted search that
  ranks saved foods with USDA and Open Food Facts name matches, shows available
  product photos and nutrition previews, and makes the intended meal clear.
- Removed the barcode-scanning workflow from onboarding. The photo-first label
  path never guesses nutrition: the user must compare and confirm every value,
  and normalized cross-account reuse requires a separate explicit opt-in while
  the photo and account identity remain private.
- Migrated earlier shared-label catalog rows by replacing legacy photo-derived
  public hashes with hashes of normalized, non-photo facts. Records linked to a
  Terms 1.1 acceptance remain pending review, unlinked rows are rejected, and
  every owner-private food and private evidence image is preserved.
- Made height a required list selection in centimeters or feet and inches, used
  it in the deterministic energy estimate, and added a database guard for
  completed onboarding.
- Added directional onboarding-step motion, staggered search results, polished
  responsive spacing, richer interaction feedback, and reduced-motion-safe
  behavior.

## 1.0.0-beta.2 — 2026-08-02

**Let's Go Green! 1.0 Beta 2** strengthens account setup and gives the complete
interface one consistent, premium motion language.

- Replaced self-reported numeric age with a validated date of birth and a final
  age confirmation before account creation.
- Made a confirmed date of birth immutable while deriving the current age for
  safety and plan calculations without sending the raw birth date to AI.
- Bound new verified accounts to canonical DOB data, aligned registration and
  later age calculations to the detected device time zone, and stopped carrying
  legal acceptance state across browser sessions or document versions.
- Added coordinated page, section, surface, stack, dialog, and feedback motion
  plus tactile highlight-and-lift states for interactive controls.
- Preserved keyboard focus, pointer-specific hover behavior, disabled states,
  responsive layouts, and the operating system's reduced-motion preference.

## 1.0.0-beta.1 — 2026-07-29

**Let's Go Green! 1.0 Beta 1** is the first named testing release.

- Added the complete account, onboarding, meal-planning, daily check-in,
  progress, profile, and settings experience.
- Added reviewed local nutrition records, direct online food-name search,
  barcode lookup, and private nutrition-label capture.
- Added responsive green styling, accessible interaction states, reduced-motion
  support, reproducible Codespaces setup, and the full automated verification
  gate.
- Added an in-app testing-channel and exact-version label.

This is a beta build, not a stable production release. Features and stored-data
formats may change before `1.0.0`.
