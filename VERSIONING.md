# Let's Go Green! release versioning

`package.json` is the single source of truth for the application release
version. The runtime version helper, visible Settings label, lockfile, release
notes, Git tags, and deployment labels must match it.

## Current release

The current testing release is **Let's Go Green! 1.0 Beta 4**, represented by
the Semantic Versioning identifier `1.0.0-beta.4`.

- `1.0.0` is the stable release this beta is preparing for.
- `beta` makes it explicit that the app is still being tested.
- `.4` identifies the fourth distributed beta build.

Beta versions sort before the corresponding stable version. The next testing
build is `1.0.0-beta.5`; the stable release is `1.0.0`.

## Version bump policy

After the stable release:

- **Patch** (`1.0.0` → `1.0.1`) is for backward-compatible bug fixes and small
  corrections.
- **Minor** (`1.0.0` → `1.1.0`) is for backward-compatible features or a
  meaningful capability expansion.
- **Major** (`1.0.0` → `2.0.0`) is for an intentionally incompatible product,
  API, or stored-data change that requires migration or coordinated adoption.

While the app is in beta, every shared testing build increments the prerelease
counter (`beta.1` → `beta.2`), even if it contains only fixes. A large change
that alters the intended stable compatibility target must also change the
major, minor, or patch base before adding the new beta suffix.

Use `alpha.N` for incomplete internal builds, `beta.N` for feature-complete
testing builds that may still change, and `rc.N` for release candidates that
should become stable unless a blocking defect is found.

## Release checklist

1. Choose the next version according to the policy above.
2. Change `version` in `package.json` and synchronize `package-lock.json`.
3. Add concise release notes describing user-visible changes and migrations.
4. Run `npm run verify`.
5. Commit and merge through the protected `main` branch.
6. Create the matching Git tag only after the protected checks pass.

Never reuse an already distributed version number for different code.
