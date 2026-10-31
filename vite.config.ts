import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { searchIndexPlugin } from "./vite/searchIndex";

// https://vite.dev/config/
export default defineConfig({
  plugins: [searchIndexPlugin(), cloudflare(), react()],
  server: {
    allowedHosts: ["vite.krnl64.win"],
  },
});
