// Tiny static server for the Expo web export. Mirrors Vercel's cleanUrls (/style-guide -> style-guide.html) and the /player rewrite in apps/app/vercel.json.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// E2E_DIST picks another build folder (the demo-mode build lives in apps/app/dist-demo).
const root = resolve(
  fileURLToPath(new URL("../../apps/app", import.meta.url)),
  process.env.E2E_DIST ?? "dist",
);
const port = Number(process.env.E2E_PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" }).end("Bad request");
    return;
  }
  let safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  // Mirrors vercel.json: a single /player/<segment> URL is served by the dynamic route's HTML.
  if (/^\/player\/[^/]+$/.test(safe)) safe = "/player/[idSlug]";
  const candidates = [join(root, safe), join(root, `${safe}.html`), join(root, safe, "index.html")];
  let file = null;
  for (const c of candidates) {
    if ((c === root || c.startsWith(root + sep)) && (await exists(c))) {
      file = c;
      break;
    }
  }
  const status = file ? 200 : 404;
  file ??= join(root, "+not-found.html");
  // Read before writing headers, so a missing file can still get a clean 404.
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(status, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
