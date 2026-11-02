# AGENTS

- The app is in `app/`. It uses Bun: run `bun` commands there, never npm or
  pnpm. `bun run check` must pass before you finish.
- `docs/` is the documentation site, a separate Bun package.
- Commit messages are ASCII, conventional style only.

## Docs

- A change in behavior updates `docs/` and `docs/zh/` in the same change, and
  the two stay in sync.
- `docs/` is for operators and integrators. Don't document the codebase there.

## No hardcoded English

- API errors are codes, with `params` for anything to fill in:
  `c.json({ error: "field_required", params: { field: "name" } }, 400)`. Add
  the text under `apiErrors` in `app/src/web/i18n/en.json` and `zh.json`. No
  English sentences or `message` fields; the one exception is OAuth/OIDC
  `error_description`.
- On the client, compare `err.code`, never `err.message` (already translated).
- All UI text goes through `t()`, including placeholders, `aria-label`s and
  `<option>`s.
