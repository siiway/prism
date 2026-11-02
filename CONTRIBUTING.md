# CONTRIBUTING

Please make sure these are done before you submit anything:

1. The tsc command should output no errors.

```bash
tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json
```

2. Linting should also output no errors.

```bash
bun run lint
```

3. Use prettier to format the code.

```bash
prettier -w .
```

4. Your commit message should only contain ASCII characters and should be clean. e.g,

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
