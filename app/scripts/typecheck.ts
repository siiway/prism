// Typecheck every TypeScript project in the app with TypeScript 7.
//
//   bun run typecheck

import { parseArgs, tsc } from "./lib.ts";

const USAGE = `Usage: bun run typecheck

  -h, --help    Show this help`;

parseArgs(process.argv.slice(2), { flags: [] }, USAGE);

for (const project of ["src/web", "src/worker", "scripts", "tests"]) {
  tsc(["-p", project]);
}
