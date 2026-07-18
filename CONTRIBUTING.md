# Contributing

## Local verification

Run `pnpm check` before committing. The same command runs independently in CI and includes lint,
format verification, TypeScript checking, tests, and production-license auditing.

The repository installs a pre-commit hook that runs this command. Hooks are a convenience, not a
replacement for CI.

## Commit messages

Commit messages follow Conventional Commits:

```text
feat(project-io): add atomic project transaction
fix(renderer): preserve custom Java conflict state
docs(adr): record parser selection
```

Use a short kebab-case scope when helpful. Breaking changes use `!` or a `BREAKING CHANGE:` footer.
The commit-msg hook validates messages with Commitlint.

## Changelog

User-visible changes are grouped under Added, Changed, Fixed, Security, and Removed. Release notes
must also identify Project Schema, Base Template, or Preset compatibility changes. Internal-only
refactors do not require a user-facing changelog entry unless they alter generated output.
