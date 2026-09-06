# AGENTS

## Package Manager

- Use Bun as the default package manager and script runner in this repository.
- Prefer bun run <script> over npm, pnpm, or yarn commands unless explicitly requested.

## Common Commands

- Build app: bun run build
- Build docs: bun run docs:build
- Run docs dev server: bun run docs:dev
- Lint: bun run lint

## Domain model

- `CONTEXT.md` (repo root) is the project glossary — the canonical meaning of
  Prism-specific terms (User, Team-as-user, OAuth source vs OAuth app, step-up
  2FA, captcha enabled set, etc.). Read it before writing code so you use the
  project's vocabulary, and use it to disambiguate overloaded words.
- When you introduce, rename, or sharpen a domain term, update `CONTEXT.md` in
  the same change. It is a glossary only: definitions, not implementation
  details or specs. An out-of-date glossary is a bug.

## Documentation

- After making functional changes (new features, changed behavior, deprecated
  endpoints), update the corresponding documentation files under `docs/`
  and `docs/zh/` to reflect the latest state. Out-of-date docs are a bug.
- Configuration keys, env vars, API endpoints, and architecture listings must
  stay in sync between English and Chinese translations.

## Contributing

@CONTRIBUTING.md
