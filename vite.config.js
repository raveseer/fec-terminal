import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    // baked at build time — rendered bottom-right so you can see which build is running
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"),
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
