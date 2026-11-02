# AGENTS

## Package Manager

- Use Bun as the default package manager and script runner in this repository.
- Prefer bun run <script> over npm, pnpm, or yarn commands unless explicitly requested.

## Common Commands

- Build app: bun run build
- Build docs: bun run docs:build
- Run docs dev server: bun run docs:dev
- Lint: bun run lint

## Documentation

- After making functional changes (new features, changed behavior, deprecated
  endpoints), update the corresponding documentation files under `docs/`
  and `docs/zh/` to reflect the latest state. Out-of-date docs are a bug.
- Configuration keys, env vars, and API endpoints must stay in sync between
  English and Chinese translations.
- `docs/` is for operators and app developers integrating with Prism. Don't
  add pages describing the codebase's internals.

## No hardcoded English

- API errors are codes: `c.json({ error: "team_not_found" }, 404)`, with
  `params` for anything to fill in, as in
  `{ error: "field_required", params: { field: "name" } }`. Add the code's
  text to `apiErrors` in both `src/web/i18n/en.json` and `src/web/i18n/zh.json`.
  Never send an English sentence
  or a `message` field; `tests/api-error-codes.test.ts` fails if you do. The
  exception is OAuth/OIDC protocol `error_description`, which the RFCs define
  for client developers.
- On the client, `ApiError.message` is already translated; compare against
  `err.code`, never the message. Success toasts use the page's own `t()`
  strings, not anything from the response.
- UI text goes through `t()`, including labels, placeholders, `aria-label`s
  and `<option>` text. Only technical examples (URLs, JSON, code) may be
  literal.

## Contributing

@.github/CONTRIBUTING.md
