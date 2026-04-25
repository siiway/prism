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
prettier -w worker src
```
1. Your commit message should only contain ASCII characters and should be clean. e.g,
```text
implement <stuff you implemented>
fix <bug you fixed>
add <feature>
```
