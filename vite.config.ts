import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "../assets", // serves /maps/*.glb and /models/psx/** in dev
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
