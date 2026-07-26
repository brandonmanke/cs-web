import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  // Deliberately NOT ../assets. Vite copies publicDir verbatim into the build,
  // which previously staged the Valve-derived *_ref.glb files (and raw .blend /
  // .psd sources) into dist/ — shipping exactly what the repo forbids. All art
  // is generated in code now, so the build has no runtime assets at all.
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
