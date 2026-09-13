import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";
import istanbul from "vite-plugin-istanbul";
import {compactMapLibreStyleSpec} from "./build/compact-maplibre-style-spec";

export default defineConfig(({ command, mode }) => ({
  server: {
    port: 8889,
  },
  build: {
    sourcemap: true,
    rolldownOptions: {
      checks: { invalidAnnotation: false },
    },
  },
  plugins: [
    compactMapLibreStyleSpec(),
    react(),
    istanbul({
      requireEnv: true,
      nycrcPath: "./.nycrc.json",
      forceBuildInstrument: true, // Instrument the source so e2e runs can collect coverage
    }),
  ],
  optimizeDeps: {
    exclude: ["maplibre-gl/dist/maplibre-gl-worker.mjs"],
  },
  // Keep the existing development URL, but emit relative production asset URLs
  // so GitHub Pages works regardless of the repository name or custom domain.
  base: mode === "desktop" ? "/" : command === "build" ? "./" : "/maputnik/",
  define: {
    global: "globalThis"
  },
}));
