// Public route for published preview sites: /s/<slug>

import { config as cfg } from "../../lib/config.mjs";
import { leadIdForSlug, getLead } from "../../lib/store.mjs";
import { renderSite } from "../../lib/render.mjs";

export default async (req) => {
  const slug = new URL(req.url).pathname.split("/").filter(Boolean)[1] || "";
  const id = await leadIdForSlug(slug);
  const lead = id ? await getLead(id) : null;
  if (!lead?.site?.publishedAt) {
    return new Response("<!doctype html><title>Not found</title><p style='font:16px system-ui;padding:40px'>This preview isn't available.</p>", { status: 404, headers: { "content-type": "text/html" } });
  }
  const claimed = lead.status === "won";
  const html = renderSite(lead.site.spec, { mode: claimed ? "live" : "preview", agency: cfg.agency, contact: claimed ? lead.brief?.contact : null });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
};

export const config = { path: "/s/*" };
