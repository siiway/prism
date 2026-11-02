import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { searchIndexPlugin } from "./vite/searchIndex.ts";
import { bundledPackagesPlugin } from "./vite/packages.ts";

const emptyStub = path.resolve(
  import.meta.dirname,
  "src/worker/lib/stubs/empty.js",
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    searchIndexPlugin(),
    bundledPackagesPlugin(),
    // The Worker builds into dist/<environment name>/. Pin the name so the
    // folder stays dist/prism whatever the Worker is called in wrangler.jsonc;
    // scripts/build.ts reads it from there.
    cloudflare({ viteEnvironment: { name: "prism" } }),
    react(),
  ],
  resolve: {
    // capjs-core (embedded Cap captcha) lazily `import()`s esbuild and
    // javascript-obfuscator for instrumentation obfuscation level >= 4. Those
    // are Node-native and cannot run in the Worker. We pin the embedded Cap
    // instrumentation to level <= 3, which never touches them, so aliasing
    // both to an empty stub keeps them out of the bundle without losing any
    // reachable functionality.
    alias: {
      esbuild: emptyStub,
      "javascript-obfuscator": emptyStub,
    },
  },
});
