# CONTRIBUTING

The app lives in `app/`; run its commands there. `docs/` is the documentation site, a separate package.

## Running locally

```bash
cd app
bun install
bun run db:migrate
bun dev
```

Open <http://localhost:5173>. The dev server runs the Worker against a local database, so you don't need a Cloudflare account. Run `bun run db:migrate` again after pulling new migrations.

Links and the OAuth issuer use `APP_URL` from `app/wrangler.jsonc`. To point them at `localhost`, create `app/.dev.vars` containing `APP_URL=http://localhost:5173`.

To preview the docs: `cd docs`, `bun install`, `bun run dev`.

## Before you submit

Please make sure these are done before you submit anything:

1. Everything CI checks passes. One command in `app/` runs the typechecks, eslint, the prettier check (over the whole repository), the tests and the translation key check (needs only Bun, on any OS):

```bash
bun run check
```

Use `bun run format:fix` to apply prettier.

2. Your commit message should only contain ASCII characters and should be clean. e.g,

```text
implement <stuff you implemented>
fix <bug you fixed>
add <feature>
```

## Git hooks

[prek](https://prek.j178.dev) runs prettier and eslint on commit, and the typechecks and tests on push. CI runs the same hooks from `app/prek.toml` over every file. prek is a dev dependency and `bun install` in `app/` enables both hooks, so there is nothing to set up (the hooks need `bun` on your PATH, on Windows too). To reinstall them by hand, in `app/`:

```bash
bun scripts/hooks.ts
```
