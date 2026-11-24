import { defineConfig, type Plugin } from "vite";

const VALVE_MAP_PREFIX = "\0valve-map:";
const VALVE_MAP_SUFFIX = ".js";

/**
 * Loads TrenchBroom `.map` files via a virtual `.js` module ID.
 * Vite's dev middleware hardcodes `*.map` paths as `application/json` source
 * maps and skips JS transformation, so routing through a `.js`-suffixed
 * virtual ID keeps real `.map` files on disk while serving `text/javascript`.
 */
function valveMapPlugin(): Plugin {
  return {
    name: "valve-map-raw",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.endsWith(".map")) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved) return `${VALVE_MAP_PREFIX}${resolved.id}${VALVE_MAP_SUFFIX}`;
      }
      return null;
    },
    async load(id) {
      if (id.startsWith(VALVE_MAP_PREFIX) && id.endsWith(VALVE_MAP_SUFFIX)) {
        const filePath = id.slice(VALVE_MAP_PREFIX.length, -VALVE_MAP_SUFFIX.length);
        const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as {
          readFileSync(path: string, enc: string): string;
        };
        this.addWatchFile(filePath);
        return `export default ${JSON.stringify(fs.readFileSync(filePath, "utf8"))};`;
      }
      return null;
    },
  };
}

function envPort(): number | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.PORT ?? env?.npm_config_port;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

const port = envPort();

export default defineConfig({
  root: "client",
  // `client/public/assets/` holds vetted CC0 / original web assets (tracked in
  // PROVENANCE.md). Never add Valve-derived or unlicensed binaries here.
  publicDir: "public",
  plugins: [valveMapPlugin()],
  server: port ? { port } : undefined,
  preview: port ? { port } : undefined,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
