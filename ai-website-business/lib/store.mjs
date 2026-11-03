// Storage layer. On Netlify this uses Netlify Blobs. Locally (tests / dev
// harness) it falls back to JSON files in .data/ so everything can run offline.

import fs from "node:fs/promises";
import path from "node:path";

let backendPromise;

async function backend() {
  if (!backendPromise) backendPromise = pickBackend();
  return backendPromise;
}

async function pickBackend() {
  if (process.env.LOCAL_STORE !== "1") {
    try {
      const { getStore } = await import("@netlify/blobs");
      const store = getStore({ name: "dayone", consistency: "strong" });
      return {
        async get(key) { return (await store.get(key, { type: "json" })) ?? null; },
        async set(key, value) { await store.setJSON(key, value); },
        async del(key) { await store.delete(key); },
      };
    } catch (err) {
      if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) throw err;
    }
  }
  const dir = path.resolve(process.env.LOCAL_STORE_DIR || ".data");
  await fs.mkdir(dir, { recursive: true });
  const file = (key) => path.join(dir, encodeURIComponent(key) + ".json");
  return {
    async get(key) {
      try { return JSON.parse(await fs.readFile(file(key), "utf8")); }
      catch { return null; }
    },
    async set(key, value) { await fs.writeFile(file(key), JSON.stringify(value, null, 2)); },
    async del(key) { await fs.rm(file(key), { force: true }); },
  };
}

const now = () => new Date().toISOString();

// ---------- leads ----------

export async function getLead(id) {
  return (await backend()).get(`lead/${id}`);
}

export async function saveLead(lead, { index = true } = {}) {
  lead.updatedAt = now();
  const b = await backend();
  await b.set(`lead/${lead.id}`, lead);
  if (index) await upsertIndex(summarize(lead));
  return lead;
}

export async function updateLead(id, fn, opts) {
  const lead = await getLead(id);
  if (!lead) throw new Error(`Lead ${id} not found`);
  const out = (await fn(lead)) || lead;
  return saveLead(out, opts);
}

export async function traceLead(id, event) {
  // Append a step to a lead's agent trace (what each agent decided and did).
  return updateLead(id, (lead) => {
    lead.trace = lead.trace || [];
    lead.trace.push({ at: now(), ...event });
    if (lead.trace.length > 400) lead.trace = lead.trace.slice(-400);
  }, { index: false });
}

function summarize(lead) {
  return {
    id: lead.id,
    name: lead.filing?.name,
    city: lead.filing?.city,
    formedAt: lead.filing?.formedAt,
    status: lead.status,
    score: lead.scout?.score ?? null,
    category: lead.scout?.category || lead.brief?.industry || null,
    slug: lead.site?.slug || null,
    updatedAt: lead.updatedAt,
    createdAt: lead.createdAt,
  };
}

export async function listLeads() {
  return (await (await backend()).get("index")) || [];
}

async function upsertIndex(summary) {
  const b = await backend();
  const index = (await b.get("index")) || [];
  const i = index.findIndex((x) => x.id === summary.id);
  if (i >= 0) index[i] = summary; else index.unshift(summary);
  index.sort((a, b2) => (b2.createdAt || "").localeCompare(a.createdAt || ""));
  await b.set("index", index.slice(0, 2000));
}

// ---------- dedupe ("seen" filings) ----------

export async function getSeen() {
  return (await (await backend()).get("seen")) || {};
}

export async function addSeen(ids) {
  const b = await backend();
  const seen = (await b.get("seen")) || {};
  const today = now().slice(0, 10);
  for (const id of ids) seen[id] = seen[id] || today;
  // keep 45 days of history
  const cutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  for (const [id, d] of Object.entries(seen)) if (d < cutoff) delete seen[id];
  await b.set("seen", seen);
}

// ---------- published sites ----------

export async function setSiteSlug(slug, leadId) {
  await (await backend()).set(`site/${slug}`, { leadId });
}
export async function leadIdForSlug(slug) {
  return (await (await backend()).get(`site/${slug}`))?.leadId || null;
}

// ---------- automation runs + activity feed ----------

export async function recordRun(run) {
  const b = await backend();
  const runs = (await b.get("runs")) || [];
  const i = runs.findIndex((r) => r.id === run.id);
  if (i >= 0) runs[i] = run; else runs.unshift(run);
  await b.set("runs", runs.slice(0, 60));
}
export async function listRuns() {
  return (await (await backend()).get("runs")) || [];
}

export async function addActivity(item) {
  const b = await backend();
  const feed = (await b.get("activity")) || [];
  feed.unshift({ at: now(), ...item });
  await b.set("activity", feed.slice(0, 250));
}
export async function listActivity() {
  return (await (await backend()).get("activity")) || [];
}
