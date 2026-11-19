# Verification and review

## Tests

- Before running checks, compare `node --version` with `.nvmrc` and `package.json`'s `engines.node`. Run project checks with the pinned Node version.
- For ticket or spec work, map every acceptance criterion to a named behavioral test or explicit verification result. A data-shape assertion alone does not verify a user-visible behavior. Report any criterion without evidence as incomplete.
- Call a failure unrelated or pre-existing only after reproducing it on the supported runtime or comparing it against the relevant baseline.

## Reviews

- Record `git status --short` and choose the intended base before reviewing. For uncommitted changes, review `git diff <base>` so staged and unstaged work is included; do not rely only on `<base>...HEAD`.
- Confirm the reviewed file list matches the task's changed files. If the diff is empty or unexpected, correct the base before reporting findings.

## Editing

- Before backing out edits, inspect the diff for the affected file and apply a targeted patch that preserves unrelated or staged work.
