// Tiny static server for the Expo web export. Mirrors Vercel's cleanUrls (/style-guide -> style-guide.html).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../apps/app/dist", import.meta.url)));
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
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(root, safe), join(root, `${safe}.html`), join(root, safe, "index.html")];
  let file = null;
  for (const c of candidates) {
    if (c.startsWith(root) && (await exists(c))) {
      file = c;
      break;
    }
  }
  const status = file ? 200 : 404;
  file ??= join(root, "+not-found.html");
  try {
    res.writeHead(status, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
