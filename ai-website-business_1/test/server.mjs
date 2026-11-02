// Local dev harness: serves public/ and routes requests to the Netlify
// function handlers, without needing the Netlify CLI.
//   npm run dev   (uses .data/ for storage, runs agents inline)

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.LOCAL_STORE ??= "1";
process.env.PIPELINE_INLINE ??= "1";
const PORT = Number(process.env.PORT || 8888);
process.env.URL ??= `http://localhost:${PORT}`;
process.env.NETLIFY_DEV = "1";

const api = (await import("../netlify/functions/api.mjs")).default;
const site = (await import("../netlify/functions/site.mjs")).default;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let handler = null;
    if (url.pathname.startsWith("/api/")) handler = api;
    else if (url.pathname.startsWith("/s/")) handler = site;
    if (handler) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await handler(request, {});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === "ENOENT" ? 404 : 500);
    res.end(String(err.message));
  }
}).listen(PORT, () => console.log(`Dev server on http://localhost:${PORT}`));
