import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.PORT || 3100);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filename);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filename)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CS-Web demo: http://127.0.0.1:${port}`);
});
