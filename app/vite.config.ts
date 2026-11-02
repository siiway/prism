import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { searchIndexPlugin } from "./vite/searchIndex";
import { bundledPackagesPlugin } from "./vite/packages";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    searchIndexPlugin(),
    bundledPackagesPlugin(),
    cloudflare(),
    react(),
  ],
});
