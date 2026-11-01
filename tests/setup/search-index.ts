// Bun test preload (bunfig.toml): provides virtual:search-index, which Vite
// generates at build time, so tests that render the app (e.g. the SSR
// render in ssr-concurrency.test.tsx) can import the command palette. Built
// by the same function as the Vite plugin, so tests see the real index.

import { plugin } from "bun";
import path from "node:path";
import { buildSearchIndex } from "../../vite/searchIndex";

const root = path.resolve(import.meta.dir, "../..");

plugin({
  name: "prism-search-index",
  setup(build) {
    build.module("virtual:search-index", () => ({
      contents: `export default ${JSON.stringify(buildSearchIndex(root))};`,
      loader: "js",
    }));
  },
});
