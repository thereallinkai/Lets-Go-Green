# Let's Go Green!

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/thereallinkai/Lets-Go-Green?quickstart=1)

Let's Go Green! is a calm, safety-aware meal-planning and habit-tracking application. It combines meal guidance, daily meal check-ins, weight-trend tracking, and a versioned plan workflow without presenting estimates as medical facts or guaranteeing a body-weight outcome.

The repository is a single full-stack TypeScript application built with Next.js App Router, React, Tailwind CSS, Supabase PostgreSQL and Auth, a deterministic mock AI provider, an optional server-only OpenAI provider, Vitest, React Testing Library, and Playwright.

> **Wellness and safety:** Let's Go Green! provides general wellness information and is not medical advice. Individual needs can vary. Consult a qualified healthcare professional or registered dietitian when appropriate.

The current testing build is **Let's Go Green! 1.0 Beta 3**
(`1.0.0-beta.3`). See [VERSIONING.md](VERSIONING.md) for the release-number
policy and [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Current feature set

The repository is structured to provide:

- Public landing, login, registration, password-recovery, Terms, and Privacy experiences.
- Date-of-birth registration with deterministic age validation, an explicit
  final age confirmation, immutable confirmed birth dates, and current-age
  derivation on the automatically detected device time zone for safety
  calculations.
- Authenticated Today, My Plan, Calendar, Progress, Profile, and Settings experiences on desktop and mobile.
- Resumable onboarding for profile, food preferences, goals, lifestyle, safety context, and review.
- Required height selection from metric or imperial lists, with height included
  in the deterministic energy estimate and plan context.
- A searchable food catalog that distinguishes generic foods from exact brand,
  product, and flavor or variant records.
- Expandable nutrition facts with energy, macronutrients, available micronutrients, measurement basis, source attribution, and verification status.
- One authenticated, explicitly submitted food-name search that ranks saved
  foods with USDA FoodData Central and Open Food Facts candidates, product
  photos when supplied, server-side normalization, and a pending-review boundary.
- Private, sanitized nutrition-label photo upload and exact manual confirmation
  for a user-confirmed personal product; a separate opt-in can create one
  reusable normalized pending-review record without sharing the photo or
  account identity.
- Versioned seven-day plans with an accepted-plan boundary.
- Six ordered daily spaces—breakfast, morning snack, lunch, afternoon snack, dinner, and evening snack—with extra-food recording and an explicit skipped state whose reason is optional.
- A profile reached from the account avatar, automatic device-time-zone initialization without a location permission prompt, a replayable first-run tutorial, and clearly external nearby-shopping links.
- A green responsive visual system with coordinated page, section, surface,
  stack, dialog, and interaction feedback that respects reduced-motion
  preferences.
- System, Light, and Dark appearance modes; System follows live device/macOS
  appearance, while an explicit override is stored locally.
- Safe structured registration and onboarding errors with a concrete reason,
  stable reference code, recovery action, and retry guidance.
- Local-date weight entries, progress summaries, and rolling trends.
- Deterministic unit, date, progress, completion, nutrition, filtering, and safety calculations.
- Local Supabase Auth, PostgreSQL, Row Level Security, migrations, deterministic seed data, Studio, and captured email.
- Mock-backed plan generation for credential-free development and CI.
- A server-only, explicit-opt-in OpenAI path that validates structured output before persistence.
- Unit, component, database/RLS, end-to-end, responsive, and accessibility test surfaces.

The local and CI paths do not require a hosted Supabase project, SMTP provider, OpenAI key, Vercel account, or production secret. See [Current limitations](#current-limitations) for the external configuration that remains intentionally separate.

## Architecture

```mermaid
flowchart LR
  B[Browser]
  N[Next.js App Router]
  D[Deterministic domain logic]
  S[Supabase API and Auth]
  P[(PostgreSQL with RLS)]
  F[(Private label-photo storage)]
  M[Mock plan provider]
  O[OpenAI Responses API]
  U[USDA FoodData Central]
  X[Open Food Facts]
  G[Google Maps]
  E[Local captured email]

  B -->|Pages, forms, same-origin API| N
  N -->|Validated calculations| D
  N -->|User-scoped SSR client| S
  S -->|RLS-enforced queries| P
  S -->|Owner-scoped metadata| F
  S -->|Development messages| E
  N -->|Default local and CI mode| M
  N -. Explicit server-only opt-in .-> O
  N -->|Server-side text lookup| U
  N -->|Explicit submitted name lookup| X
  B -. Clearly labeled external search .-> G
```

The browser uses same-origin Next.js pages, Route Handlers, and Server Actions. Protected operations resolve the authenticated user on the server and use a user-scoped Supabase client so Row Level Security remains active. Server-only provider code loads trusted profile data from PostgreSQL; the browser never sends an arbitrary trusted profile snapshot to OpenAI.

Deterministic code—not a language model—owns unit conversion, timeline math, progress, completion, rolling averages, nutrition totals, food filtering, data-sufficiency states, and safety flags. AI output is a suggestion that must reference allowed food IDs, pass validation, and be recalculated before a complete plan version can be saved.

### Food catalog, nutrition, and label-photo trust boundaries

| Data path | What is stored or displayed | Trust and plan boundary |
| --- | --- | --- |
| Reviewed local catalog | Generic foods or exact products, measurement basis, nutrition, safety metadata, and provenance | Eligible only when the required nutrition and safety records have the reviewed statuses enforced by the database |
| USDA FoodData Central | Text-search candidates and a server-refetched normalized record | Labeled source-reported and `pending_review`; searchable and loggable, but not eligible for generated plans until reviewed |
| Open Food Facts | Explicit brand/product/flavor name-search candidates and provider photos when available, followed by a server-refetched normalized product | Community-source data with attribution, labeled source-reported and `pending_review`; not eligible for generated plans until reviewed |
| Uploaded package label | A server-re-encoded, owner-private JPEG/PNG plus the account owner's exact transcription | The original upload is not retained as-is; confirmation requires sanitized nutrition-label evidence and creates an active `user_label` personal product for that owner, not an independently reviewed record |
| Opt-in reusable label facts | One normalized catalog identity derived from exact product text and confirmed core nutrition | Created only after a separate sharing confirmation; reusable as `pending_review`, while the private photo, account identity, and owner-private product are never published to other accounts |

Nutrition cards preserve the stated basis—such as raw, dry, cooked, as sold, per 100 g, or one label serving—and show only values actually present in the stored source. Calories, energy in kilojoules, protein, carbohydrate, fat, fiber, sodium, saturated and trans fat, sugars, cholesterol, potassium, calcium, iron, vitamin D, and additional provider-reported nutrients can be displayed when available. A missing nutrient remains missing; it is never filled by a guess.

The deterministic broccoli, spinach, romaine lettuce, carrot, and tomato records
include the conventional nutrition summary plus 19 additional nutrients from
their exact USDA FDC records. Label confirmation separately requires an
explicit allergen review, an explicit dietary-restriction review, and a
nutrition photo. Known allergen words in the package statement must match the
selected allergen mappings. Image attempts are rate-limited, and uploading the
same evidence kind replaces the current private image rather than accumulating
unbounded copies.

Google Search and ChatGPT are not nutrition sources for this application. Google Maps links are shopping conveniences only: they open an external search, may use Google's own location settings, and do not prove product inventory, price, availability, or suitability.

The initial time zone comes from the browser's standard device time-zone setting through `Intl.DateTimeFormat`; Let's Go Green! does not request precise geolocation for that step. The user can review or change the saved IANA time zone in Settings.

## Development environment strategy

| Path | Host requirements | Intended use |
| --- | --- | --- |
| GitHub Codespaces | A browser and GitHub access | Primary zero-local-install development path |
| VS Code Dev Container | Git, VS Code, Docker Desktop or a compatible Docker runtime, and the Dev Containers extension | Reproducible local fallback |
| Bare host | Not supported | Do not install Node, PostgreSQL, Supabase CLI, or Playwright directly for this project |
| Production | Authorized cloud accounts and securely configured runtime values | Separate deployment process; never the local Supabase stack |

The Dev Container pins Node.js `22.23.1` and npm `10.9.8`, includes Git, GitHub CLI, Docker-in-Docker, the PostgreSQL client, browser system libraries, and recommended VS Code extensions. Supabase CLI and Playwright remain project-local lockfile dependencies.

The recommended Codespaces machine has at least 4 CPU cores, 8 GB memory, and 32 GB storage because local Supabase runs several containers.

## Zero-local-install GitHub Codespaces

1. Select the badge above or use **Code → Codespaces → Create codespace**. A repository branch, feature branch, or pull-request branch can be opened in its own Codespace.
2. Wait for the Dev Container `postCreateCommand`. It runs `npm run bootstrap`, which installs the exact lockfile and prepares the credential-free local stack.
3. Run **Terminal → Run Task → Start Let's Go Green!**. The same action is available from the Command Palette as **Tasks: Run Task**.
4. Keep the start terminal running. When Next.js prints `✓ Ready`, open the
   privately forwarded **Let's Go Green!** port in the external browser. The
   committed port configuration uses HTTP between Codespaces and Next.js and
   keeps the forwarded URL private.

The application, Supabase API, PostgreSQL, Supabase Studio, and captured-email ports are private by default. Bootstrap derives the application origin and exact Supabase Auth callback from Codespaces runtime variables without embedding a GitHub domain literal. Use the Codespaces **Ports** panel to open Studio or captured email instead of copying a forwarded-domain pattern into configuration.

The first `npm run doctor` may report that Next.js is not ready when the
application has not been started yet; that result is expected. After
`npm run dev:all` prints `✓ Ready`, run `npm run doctor` in a second terminal
to verify the application without stopping the development server.

Codespaces can be configured for prebuilds after the workflow is stable. Prebuilds must not start secret-dependent work or embed a key in the container image.

## Local VS Code Dev Container

The local desktop prerequisites are limited to:

- Git.
- VS Code.
- Docker Desktop or another compatible Docker runtime.
- The VS Code Dev Containers extension.

Then:

1. Clone the repository.
2. Open the repository folder in VS Code.
3. Select **Dev Containers: Reopen in Container**.
4. Wait for bootstrap to complete.
5. Run the **Start Let's Go Green!** task if it did not already start.
6. Open the forwarded application URL.

No host installation of Node.js, npm packages, PostgreSQL, Supabase CLI, or Playwright is used by this path.

## Bootstrap and start behavior

`npm run bootstrap`:

1. Confirms that it is running in the Linux Codespace, Dev Container, or CI environment.
2. Verifies Node, npm, Docker, `psql`, and `curl`.
3. runs `npm ci`;
4. starts or reuses local Supabase and waits on an actual health endpoint;
5. applies pending version-controlled migrations without resetting data;
6. applies the deterministic, idempotent seed;
7. reads local connection values from the running Supabase CLI;
8. creates or extends ignored `.env.local` and `supabase/.env` without replacing unrelated existing values;
9. generates `src/types/database.ts`;
10. installs the matching Playwright Chromium browser and system dependencies;
11. checks PostgreSQL and a temporary `/api/health` application process; and
12. prints the application, Studio, and captured-email URLs.

Rerunning bootstrap does not reset the database, duplicate deterministic seed records, overwrite a user-provided key, or replace an existing `.env.local` value. It can update the generated database type file when migrations change.

`npm run dev:all` is the one-action daily start command. It starts or reuses Supabase, safely applies pending migrations and the idempotent catalog seed, and then runs Next.js on port 3000. If the environment has never been prepared, it runs bootstrap first. A normal restart after `git pull` therefore picks up database-backed features without deleting existing local accounts or onboarding drafts.

## Local services

| Service | Default container URL | Forwarded port | Notes |
| --- | --- | ---: | --- |
| Let's Go Green! | `http://localhost:3000` | 3000 | Next.js application |
| Supabase API | `http://127.0.0.1:54321` | 54321 | Browser and server API |
| PostgreSQL | `postgresql://…@127.0.0.1:54322/postgres` | 54322 | Local development database |
| Supabase Studio | `http://127.0.0.1:54323` | 54323 | Local database UI |
| Captured email | `http://127.0.0.1:54324` | 54324 | Local auth email inspection |

The generated `.env.local` contains local-only values from `supabase status -o env`. Those values are not production credentials and are never committed.

### Local email verification

Supabase Auth sends development signup, verification, and password-reset messages to the Supabase CLI local email-capture service (Mailpit in the pinned CLI). Open the **Local captured email** forwarded port, select the message for the test address, and use the current verification code or reset link.

This verifies the local Supabase email flow. It does not test a production SMTP provider, production sender reputation, or a hosted redirect configuration.

### External food lookup configuration

Exact-product lookup runs on the server. Add these values to the ignored `.env.local` file or the appropriate secure runtime store, never to a `NEXT_PUBLIC_*` variable:

```dotenv
# Server-only data.gov key for USDA FoodData Central.
USDA_FDC_API_KEY=

# Descriptive application identity sent to food-data providers.
FOOD_LOOKUP_USER_AGENT=LetsGoGreen/1.0.0-beta.3 (https://github.com/thereallinkai/Lets-Go-Green)
```

- `USDA_FDC_API_KEY` is optional for local development because non-production mode can use the USDA `DEMO_KEY`. That shared key is rate-limited and is not a production configuration. Obtain and secure a data.gov key before relying on USDA lookup in a deployed environment.
- `FOOD_LOOKUP_USER_AGENT` is not a secret, but it must be a descriptive value of at least eight characters. The committed default identifies this repository.
- Open Food Facts name lookup does not require a key. Both providers require outbound network access and can be unavailable, incomplete, or rate-limited.
- Online name lookup is user-triggered, not search-as-you-type. The server limits fields and result count because [Open Food Facts limits search requests and warns against search-as-you-type](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).
- Search results are candidates only. Import refetches the selected USDA or Open Food Facts record on the server, stores provenance and a source snapshot, and marks the normalized record `pending_review`.

Provider configuration expands the catalog; it does not turn source-reported data into reviewed nutrition or make a pending record eligible for generated plans.

## Mock and real AI modes

Development and CI use:

```dotenv
AI_PROVIDER=mock
ENABLE_REAL_AI=false
```

Mock plans are deterministic and must be labeled **Mock AI plan — development only**. They require no OpenAI account or key and never spend API credits.

Real AI remains server-only and disabled unless all of the following are true:

- `AI_PROVIDER=openai`.
- `ENABLE_REAL_AI=true`.
- A valid `OPENAI_API_KEY` exists in the server runtime secret store.
- A supported `OPENAI_MODEL` is configured; the documented default is `gpt-5.6-luna`.
- Runtime validation passes.

A key alone never enables paid calls. The real adapter uses the OpenAI Responses API, structured output, timeout and retry limits, idempotency, validated food identifiers, deterministic nutrient recalculation, and plan versioning. The opt-in smoke test makes one budget-bounded request and is not part of pull-request CI.

## Health reporting

`GET /api/health` returns non-sensitive status for:

- application availability;
- database reachability;
- migration compatibility; and
- AI provider mode: `mock`, `openai`, or `unavailable`.

The endpoint does not expose keys, connection strings, internal tokens, raw provider responses, or detailed production infrastructure.

`npm run doctor` checks the pinned Node and npm versions, Docker daemon, project-local Supabase CLI, local service status, PostgreSQL connectivity, migration state, required ports, local configuration names, Next.js readiness, and the installed Playwright browser. It reports every check with remediation and exits nonzero if a required check fails.

## Command reference

| Command | Purpose |
| --- | --- |
| `npm run doctor` | Diagnose the complete running development environment. |
| `npm run bootstrap` | Idempotently install dependencies and prepare local services, configuration, types, browsers, and health checks. |
| `npm run services:start` | Start or reuse Supabase and wait until it is healthy. |
| `npm run db:sync` | Apply pending migrations and the idempotent catalog seed without resetting local data. |
| `npm run dev` | Start only Next.js; use this when services are already running. |
| `npm run dev:all` | Start or prepare Supabase, safely synchronize its schema/catalog, then start Next.js. This powers the VS Code task. |
| `npm run test` | Run the Vitest unit and component suite once. |
| `npm run test:db` | Run schema, seed, constraint, atomic-RPC, and RLS checks against the running local Supabase database. |
| `npm run test:e2e` | Run mock-backed Playwright end-to-end and accessibility tests. |
| `npm run typecheck` | Check TypeScript without emitting files. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Create the production Next.js build. |
| `npm run verify:app` | Run typecheck, lint, Vitest, production build, and mock-backed Playwright without the database/RLS gate. |
| `npm run verify` | Run the full typecheck, lint, Vitest, database/RLS, generated-type drift, production-build, Playwright, and accessibility gate. |
| `npm run db:types` | Regenerate `src/types/database.ts` from the running local database. |
| `npm run db:types:check` | Fail when generated types differ from the local migration state. |
| `npm run db:reset` | **Destructively** reconstruct only the local database after an explicit confirmation. |
| `npm run down` | Stop local Supabase while preserving development data. |
| `npm run openai:smoke` | Run the explicitly enabled real-provider smoke request or report why it was skipped. |

`npm run verify` requires a healthy local Supabase stack and installed Playwright Chromium. Use `npm run verify:app` only for an application-only check when the database environment is unavailable; it does not replace the full handoff gate.

## Database migrations, seed data, and types

Migrations under `supabase/migrations/` are the source of truth. Do not edit a migration that may already have been applied.

The product, package, documentation, container labels, environment variables,
current browser-storage keys, exports, and runtime identifiers use **Let's Go
Green!**. Two persistent hidden legacy identifiers intentionally remain
compatible: the original migration filename/history and Supabase `project_id`.
Renaming either would make an existing local database look unapplied or detach
its preserved Docker volumes. Non-sensitive legacy configuration and
Auth-redirect keys are read only long enough to migrate them. The legacy
`cutting-plan-registration-draft` key is read once for safe non-password fields,
migrated to the current same-tab registration draft when valid, and then
removed. Older globally keyed onboarding drafts are removed without restoration
because they cannot be safely attributed to one account on a shared browser;
Beta 3 stores new onboarding drafts under an authenticated account scope.

For a schema change:

```bash
npx --no-install supabase migration new descriptive_change
# Edit the new SQL file.
npm run services:start
npx --no-install supabase migration up --local
npm run db:types
npm run test:db
npm run db:types:check
```

Review and commit the migration and `src/types/database.ts` together. Seed changes belong in `supabase/seed.sql` and must use stable identifiers and conflict-safe statements so bootstrap can reapply them without duplicating rows or removing user-created local records.

### Deliberate local reset

`npm run db:reset` deletes all user-created records in the local Supabase database and reconstructs it from migrations and seed data. It requests the phrase `RESET LOCAL DATABASE`. Noninteractive disposable CI use additionally requires `ALLOW_LOCAL_DB_RESET=1`.

Bootstrap, service start, container rebuild, and ordinary tests must not invoke this command after a developer has created data.

### Production migration process

Use one protected deployment job as the only production migration owner:

1. Back up the hosted database and confirm recovery capability.
2. Review a backward-compatible migration against a staging or isolated preview database.
3. Apply the migration with a narrowly scoped deployment identity.
4. Verify the migration and application health.
5. Release the compatible application version.

For rollback, prefer rolling the application back while the schema remains backward-compatible, then ship a reviewed forward corrective migration. Do not automatically run a destructive down migration. Restore a database backup only as a deliberate incident action with authorization.

## Testing

Use [MANUAL_TESTING.md](MANUAL_TESTING.md) for the complete human-run feature checklist, expected results, failure-path checks, two-user privacy checks, and optional real-provider validation.

The expected full local gate is:

```bash
npm run verify
```

Current automated coverage includes:

- Unit coverage of conversions, dates, time zones, progress direction, missing data, trends, six-slot meal normalization, meal guidance, nutrition basis, filtering, safety, plan mapping, schema validation, and idempotency.
- Component coverage of authentication controls and DOB confirmation; safe
  session-draft restoration without passwords or legal acceptance; onboarding
  validation, food selection, warning acknowledgement, reordering, and removal;
  plan version review and restore; progress ranges and deletion confirmation;
  Today and Calendar snack/skip behavior; profile and tutorial controls; weight
  persistence rollback; and optimistic-save rollback.
- Real local database coverage of schema and seed invariants, immutable DOB and
  legacy-account boundaries, constraints, catalog and pending-record visibility,
  private ownership, cross-user RLS denial, snack and skipped-meal persistence,
  and atomic application RPCs.
- Playwright coverage of public and legal navigation, registration age
  confirmation, protected mock pages, Today persistence, mock-plan generation
  and acceptance, motion/reduced-motion behavior, mobile primary navigation,
  horizontal overflow at 375/768/1280/1440 pixels, and axe scans.

Authentication email, OTP, the complete external-provider and photo-upload workflows, full onboarding, two-user browser isolation, keyboard-only critical flow, and production-provider behavior still require the hands-on checks in `MANUAL_TESTING.md`. Do not treat a narrower mock-backed browser suite as evidence that those flows or any production integration have passed.

The default suite never spends OpenAI credits. A protected GitHub Actions `workflow_dispatch` can run `openai:smoke` only after a reviewer enables the `openai-smoke` environment and provides its server secret. Report that test as passed, failed, or skipped; never collapse a skip into a pass.

## Pull-request workflow and CI

A **pull request** proposes and reviews a code change. It is not how a developer downloads the application. Use **clone** for a first local checkout and **pull** to update an existing checkout.

A typical change is:

```bash
git switch -c feature/short-description
# Make and verify the change.
git add .
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Then open a pull request on GitHub. A developer can open the repository, the feature branch, or the pull-request branch directly in Codespaces.

The default branch is protected by the owner-only setup documented in
[GITHUB_SETUP.md](GITHUB_SETUP.md). It requires this pull-request workflow,
resolved review conversations, and the exact **Local mock-backed suite** check;
it also blocks deletion and force-pushes.

CI runs for every pull request and push to `main`. It uses Node 22, `npm ci`, fresh local Supabase, migrations, deterministic seed data, captured email, mock AI, generated-type drift detection, type checking, lint, Vitest, database/RLS tests, a production build, and Playwright. Cleanup stops Supabase even after failure. Superseded branch runs are cancelled.

CI has only `contents: read`, uses no production secrets, and does not use `pull_request_target`; forked pull requests can run the same local mock suite safely. Failed Playwright diagnostics are retained briefly and should contain only test data.

A pull-request preview deployment and a production deployment are separate from Codespaces and from CI. Neither is implied merely because a pull request passed.

## Deployment readiness

The multi-stage production `Dockerfile`:

- builds with pinned Node.js 22;
- uses Next.js standalone output;
- copies only runtime output and public assets;
- runs as a non-root user; and
- checks `/api/health`.

Build it only after production runtime validation and the production build pass:

```bash
docker build --tag lets-go-green:local .
```

The recommended hosted architecture is Vercel for Next.js, hosted Supabase for PostgreSQL and Auth, a production SMTP provider for authentication email, and the OpenAI API from server-only code. The application is hosting-provider neutral; the container can run on another platform that supports Node and secure runtime environment variables.

Before production:

1. Authorize and configure the hosting, Supabase, SMTP, and optional OpenAI accounts.
2. Configure separate Preview and Production values.
3. Use an isolated preview or staging database; previews must never access production user data.
4. Configure allowed Auth redirect URLs and email templates.
5. Put production migration execution behind a protected environment and make one automation path its owner.
6. Configure monitoring, backups, rate boundaries, a domain, privacy operations, and an account-deletion procedure.
7. Validate signup, OTP, cookies, protected routes, password reset, email delivery, RLS, and health in that environment.

Do not deploy the local Supabase CLI stack as production. This repository does not claim that preview or production deployment works before those provider accounts and values are configured.

## Secret boundaries

Commit variable names and safe examples only. Use separate stores for:

| Context | Store | Examples |
| --- | --- | --- |
| Local mock development | Generated ignored `.env.local` | Local Supabase values and mock mode |
| Optional developer credentials | GitHub Codespaces secrets | A personal USDA key or explicitly enabled OpenAI test key |
| Protected automation | GitHub Actions secrets and Environments | Real provider smoke or deployment credentials |
| Preview hosting | Vercel Preview environment values | Preview Supabase URL and server credentials |
| Production hosting | Vercel Production environment values | Production Supabase and OpenAI server values |
| Auth email | Supabase and SMTP provider secret stores | SMTP password and sender configuration |

Never commit API keys, access tokens, database passwords, production credential URLs, SMTP passwords, service-role keys, session tokens, or generated environment files. Never place a server credential in a `NEXT_PUBLIC_*` variable. New computers do not need production secrets to run the local mock-backed application.

## Current limitations

- Hosted Supabase, production SMTP, Vercel, domains, billing, production monitoring, and production secrets are intentionally not configured.
- Local captured email demonstrates development authentication only.
- Mock AI is the default. A real OpenAI result is not claimed until the protected opt-in smoke test actually runs.
- Clean Codespaces and Dev Container acceptance, email/OTP, cookies, password reset, onboarding, external lookup, and label upload must be verified in the target environment with the documented checklist; repository code alone is not production acceptance.
- USDA development lookup can use the shared `DEMO_KEY`, which has restrictive rate limits. A deployed environment needs its own secured `USDA_FDC_API_KEY`.
- USDA and Open Food Facts values are source-reported, can be incomplete, and enter the shared catalog as `pending_review`. No external import is automatically approved for generated plans.
- A confirmed personal label product is eligible only for its owner and remains
  labeled `user_label`. If the user separately opts in, its exact normalized
  shared identity remains pending review; the re-encoded photo evidence and
  account identity remain private.
- Nearby Google Maps links do not verify inventory, price, availability, distance, or product suitability. Google Search and ChatGPT are not nutrition truth.
- Account export is implemented, but account deletion remains visibly unavailable until a reviewed deletion and retention procedure is implemented.
- Plan meals show conservative per-meal nutrition where supported; the UI does not yet claim an authoritative summed daily plan total.
- Production deployment requires one-time provider authorization and a reviewed migration/recovery process.

## Troubleshooting

Start with:

```bash
npm run doctor
```

### Docker is unavailable

In Codespaces, wait for Docker-in-Docker to finish starting and retry. Locally, confirm Docker Desktop is running, then reopen the repository in the Dev Container. Do not install Supabase directly on the host as a workaround.

### Supabase does not become healthy

Inspect `docker ps`, confirm the recommended Codespaces machine size, and rerun:

```bash
npm run services:start
```

The script polls the Auth health endpoint for up to 120 seconds; it does not assume an arbitrary startup delay.

### A required port is occupied

`npm run doctor` reports the affected port. Stop the conflicting development process without deleting Supabase volumes. Do not change committed local Supabase ports merely to work around an unknown process.

### `.env.local` is missing or incomplete

Run `npm run bootstrap`. It appends missing local values and preserves every existing assignment, including a user-provided secret. Delete or edit a local value only when you deliberately intend to replace it.

### Migrations differ

Run:

```bash
npx --no-install supabase migration up --local
npm run db:types
npm run db:types:check
```

Do not reset the database merely to resolve a pending migration.

### Playwright Chromium is missing

Inside the Dev Container, run:

```bash
npx --no-install playwright install --with-deps chromium
```

### The application health check fails

Confirm that local services are healthy, then run `npm run dev:all` and inspect the terminal. `/api/health` intentionally returns only sanitized status; use server logs for local diagnosis and do not copy secret-bearing output into an issue.

### Port 3000 opens as a download or does not show the application

`✓ Ready` means Next.js is listening; no additional wait is required. Keep that
terminal running, then use the Codespaces **Ports** panel:

1. Locate the row labeled **Let's Go Green!** with port **3000**. Port 54321
   is an API and port 54322 is PostgreSQL; neither is the application page.
2. Right-click port 3000 and select **Change Port Protocol → HTTP**.
3. Confirm **Port Visibility → Private**.
4. Select the globe icon or **Open in Browser**. Do not type a local
   `localhost:3000` URL into the browser on your own computer.

An existing Codespace remembers its port protocol for its lifetime, so a stale
setting can override a newly pulled `devcontainer.json`. If the download prompt
continues, stop forwarding port 3000 from the **Ports** panel, add port 3000
again, set it to HTTP and private, and reopen it. To apply the committed
automatic port behavior, pull the latest commit and run
**Codespaces: Rebuild Container** from the Command Palette; bootstrap is
idempotent and does not intentionally reset the local database.

From a second terminal, distinguish an application problem from a forwarding
problem:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
npm run doctor
```

If both succeed while the forwarded URL still downloads, Next.js is healthy
and only the Codespaces port setting needs to be recreated.

### Verification email does not arrive

Open the privately forwarded **Local captured email** port. Confirm that Supabase Auth is running and that the message was addressed to the expected test email. Production delivery is a separate SMTP configuration.

### Local data must be reconstructed

Back up anything needed, then run `npm run db:reset` and enter the exact confirmation phrase. This is the only routine command documented here that intentionally removes user-created local records.

## Data and safety principles

- Use neutral, nonjudgmental language. A missed meal or check-in is simply `Not marked`.
- Clearly distinguish `Provided by you`, `Calculated by the app`, `Suggested by AI`, and `Pending verification`.
- Preserve raw, dry, cooked, as-sold, and label-serving measurement bases.
- Identify branded foods by exact brand, product, flavor or variant, and provider identity when available; never invent nutrition for an unspecified branded or variable product.
- Display source attribution and review status beside source-reported nutrition. Provider availability is not evidence quality.
- Re-encode uploaded label photos, keep the sanitized evidence owner-private,
  require exact user confirmation, and share a normalized pending catalog
  record only after the user separately opts in.
- Use device time-zone settings without treating a time zone as precise location. Label external shopping links and make no inventory claim.
- Treat safety questions as optional unless functionally required and explain why they are requested.
- Do not generate aggressive restriction advice for a minor, pregnancy or nursing, an eating-disorder history, relevant medical concerns, or reported symptoms such as dizziness, fainting, heart palpitations, or severe weakness.
- Encourage appropriate professional guidance without diagnosing.
- Never automatically make a plan more restrictive because of one weight entry.

## Roadmap

1. Complete clean Codespaces and local Dev Container acceptance from the GitHub repository.
2. Expand automated authentication, onboarding, external-provider, label-upload, RLS, responsive, keyboard, and accessibility coverage.
3. Establish a reviewed moderation workflow for pending external and normalized label records, including nutrition-source refresh dates.
4. Exercise the protected real-provider smoke path with explicit credentials and a budget limit.
5. Configure an isolated preview environment and production provider accounts.
6. Perform security, privacy, accessibility, recovery, and deployment reviews before inviting real users.
