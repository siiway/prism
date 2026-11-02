# CONTRIBUTING

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

[prek](https://prek.j178.dev) runs prettier and eslint on commit, and the typechecks and tests on push. Install it, then enable the hooks once (needs `bun` on your PATH, on Windows too):

```bash
prek install --hook-type pre-commit --hook-type pre-push
```
