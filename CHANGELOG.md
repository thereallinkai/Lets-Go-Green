# Changelog

User-visible application releases are recorded here. Version identifiers follow
the policy in [VERSIONING.md](VERSIONING.md).

## 1.0.0-beta.6 — 2026-08-20

**Let's Go Green! 1.0 Beta 6** makes meal preferences editable after
onboarding, brings food recording to every Today slot, and adds private
on-device assistance for reading package nutrition labels.

- Added an authenticated meal-preference editor in Settings for Breakfast,
  Lunch, and Dinner. It reuses the saved-food discovery and nutrition cards,
  adds or removes one choice at a time, represents an intentionally empty meal
  as **None selected**, and explains that changes affect future plan drafts
  without rewriting an accepted plan or today's log.
- Added explicit, descriptive None choices for allergies, dietary
  restrictions, disliked foods, and additional safety context in Settings.
  Onboarding now exposes the matching allergy, restriction, and safety-context
  choices; it does not collect disliked foods. Empty values are stored as empty
  values rather than a literal `None` allergy, restriction, dislike, or safety
  flag.
- Added in-browser package-label reading from a selected JPEG or PNG. Pinned
  Tesseract worker, WebAssembly, and English-language assets load only from this
  application; the photo is not sent to an OCR, AI, or other external provider
  for recognition. Only explicitly labeled, sufficiently confident values are
  suggested, ambiguous values remain blank, and every suggestion must be
  compared with the package and confirmed before the existing private save.
- Bounded label reading by file type, file size, decoded dimensions, pixel
  count, downscaled working image, timeout, cancellation, and one active worker.
  Replacing a photo or retrying cannot leave stale suggested facts or a
  confirmation checked, while manual input survives an empty or unreadable
  recognition result.
- Exposed **Record food** or **Manage recorded foods** for breakfast, lunch,
  dinner, and all three snack spaces. Today now separates accepted-plan detail
  from foods recorded today, discloses that recording a food marks that slot
  done, keeps delete/status behavior consistent after reload, and gives every
  repeated control a meal-qualified accessible name.
- Replaced the oversized completion action with a compact animated status pill
  that retains a 44-pixel target, visible keyboard focus, text and icon state,
  `aria-pressed`, dark-mode contrast, reduced-motion behavior, and responsive
  wrapping.
- Added Profile-to-Settings preference navigation, expanded structured error
  and retry states for preference mutations and local label reading, updated
  container/bootstrap preparation for the pinned OCR assets, and expanded
  component, route, parser, accessibility, responsive, and end-to-end checks.
- Hardened unfinished package-label drafts with atomic owner-scoped creation,
  exact replay protection, database-enforced active and rolling limits, and an
  idempotent server-only discard. Discarded private-photo paths remain in a
  trusted cleanup queue until deletion succeeds; package-label visits retry
  pending work without delaying the label list response.
- Made the credential-free native start and doctor require the repository's
  exact Node.js and npm versions before installing dependencies or launching,
  so the no-Docker path matches the release toolchain instead of accepting a
  nearby runtime silently.

The database migration in this release adds owner-scoped, serialized meal-
preference and label-draft creation RPCs, enforces their limits inside the
transaction, validates plan eligibility and package facts, and revokes direct
writes that could bypass those checks. It also preserves a trusted draft-
creation ledger, adds a durable discard-cleanup queue, and restricts discard
and cleanup operations to the service-role boundary. Existing preference,
profile, accepted-plan, daily-log, and private-label rows are preserved;
owner-scoped selection and one-item removal remain available. The migration
layers the Beta 6 health contract over the prior health checks. The OCR feature
adds no OCR-result table, external OCR recipient, or new photo-retention path.

## 1.0.0-beta.5 — 2026-08-13

**Let's Go Green! 1.0 Beta 5** makes onboarding food discovery shorter,
clearer, and recoverable when an external source is temporarily limited.

- Reworked Step 3 around one explicit destination for approved saved foods,
  six initially visible ranked results, and an accessible **Show all remaining
  matches** action.
  Online candidates no longer show decorative Breakfast, Lunch, or Dinner
  selectors: saving one creates a pending catalog-review record and does not
  falsely imply that the food entered a meal.
- Scoped an online-candidate import failure to the exact result card that
  failed. Already loaded results remain visible, only the affected provider's
  review actions pause during its cooldown, and the card states whether the
  provider was contacted or any record was saved.
- Balanced USDA lookup between generic Foundation/SR Legacy foods and branded
  products, improved exact-name ranking, and collapsed duplicate-looking
  records while preserving products with genuinely different formulations or
  package details.
- Preserved provider-reported product identifiers, retained package and
  source-version metadata for safer visible-result deduplication, and expanded
  vegetable categorization to include asparagus and other common produce names.
- Separated provider-scoped search and import capacity into independent
  five-minute buckets, so repeated searches cannot consume the reserved import
  allowance. Limited responses include an exact body value and HTTP
  `Retry-After`; rejected early retries do not extend the cooldown.
- Reused only complete searches during the current Step 3 page session.
  Partial provider responses stay usable but are not cached, allowing a
  temporarily unavailable provider to recover on the next submission.
- Updated the release metadata and food-provider identity to Beta 5, expanded
  the manual test contract for populated and rate-limited search states, and
  patched the transitive `fast-uri` denial-of-service advisory by pinning
  4.1.2. The test runner now uses two workers to prevent fork-startup timeouts
  on smaller development environments.

The database migration in this release adds a validated search/import request
kind, an indexed provider-and-kind rate bucket, an atomic trusted-server
allowance RPC that returns the exact retry delay, and the Beta 5 health
contract. Existing lookup history is preserved as search history, and no food,
profile, plan, or label record is deleted.

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
