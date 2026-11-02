# CONTRIBUTING

## Running locally

```bash
bun install
bun run db:migrate
bun dev
```

Open <http://localhost:5173>. The dev server runs the Worker against a local database, so you don't need a Cloudflare account. Run `bun run db:migrate` again after pulling new migrations.

Links and the OAuth issuer use `APP_URL` from `wrangler.jsonc`. To point them at `localhost`, create a `.dev.vars` file containing `APP_URL=http://localhost:5173`.

## Before you submit

Please make sure these are done before you submit anything:

1. Everything CI checks passes. One command runs the typechecks, eslint, the prettier check, the tests and the translation key check (needs only Bun, on any OS):

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

[prek](https://prek.j178.dev) runs prettier and eslint on commit, and the typechecks and tests on push. CI runs the same hooks from `prek.toml` over every file. Install it, then enable the hooks once (needs `bun` on your PATH, on Windows too):

```bash
prek install --hook-type pre-commit --hook-type pre-push
```
