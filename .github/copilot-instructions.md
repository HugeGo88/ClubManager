# Project instructions

- Read [ARCHITECTURE.md](../ARCHITECTURE.md) before making architectural changes;
  verify its statements against the current code.
- When a change affects architecture, module boundaries, data formats, behavior,
  security, build, testing, or release workflows, update the relevant sections
  of `ARCHITECTURE.md` in the same change.
- Keep current implementation separate from proposed features, and keep
  [PRODUCT_IDEAS.md](../PRODUCT_IDEAS.md) aligned when product functionality changes.
- Add user-facing German release notes to [changelog.json](../src/shared/changelog.json)
  for each new app version.
- When asked to increase the app version, increment the patch (third) version
  number and check that the release notes are up to date.
