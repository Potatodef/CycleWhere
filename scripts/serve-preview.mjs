import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number.parseInt(process.env.PORT || "4173", 10);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".ts", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".map", "application/json; charset=utf-8"]
]);

function safeJoin(urlPath) {
  const normalized = decodeURIComponent(urlPath.split("?")[0]);
  const target = normalized === "/" ? "/preview-index.html" : normalized;
  const full = path.normalize(path.join(root, target));
  if (!full.startsWith(root)) {
    return null;
  }
  return full;
}

const server = http.createServer(async (request, response) => {
  const fullPath = safeJoin(request.url || "/");
  if (!fullPath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    let stat;
    let filePath = fullPath;
    try {
      stat = await fs.stat(fullPath);
    } catch (error) {
      const jsFallback =
        fullPath.endsWith(".ts") ? fullPath.slice(0, -3) + ".js" : null;
      if (!jsFallback) {
        throw error;
      }
      stat = await fs.stat(jsFallback);
      filePath = jsFallback;
    }

    if (stat.isDirectory()) {
      filePath = path.join(fullPath, "index.html");
    }

    const contents = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(contents);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CycleWhere preview running at http://127.0.0.1:${port}`);
});
