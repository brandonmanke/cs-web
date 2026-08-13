import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  // Vite copies publicDir verbatim into the build. This once pointed at a
  // directory of reference art, which staged Valve-derived *_ref.glb files (and
  // raw .blend / .psd sources) into dist/ — shipping exactly what the repo
  // forbids. That directory is gone and all art is generated in code, so the
  // build has no runtime assets at all. Never repoint this at binaries.
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
