// Dashboard API. All routes require the operator password (x-admin-key header).

import { config as cfg, publicConfig } from "../../lib/config.mjs";
import { listLeads, getLead, updateLead, listRuns, listActivity, traceLead } from "../../lib/store.mjs";
import { runIntake, runApproval, runFollowups } from "../../lib/automations.mjs";
import { newLeadFromFiling, previewUrlFor } from "../../lib/pipeline.mjs";
import { fetchFilingById, SOURCE } from "../../lib/colorado.mjs";
import { prefilter } from "../../lib/filters.mjs";
import { renderSite } from "../../lib/render.mjs";
import { notifyOperator } from "../../lib/notify.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function startBackground(origin, payload) {
  if (process.env.PIPELINE_INLINE === "1") {
    const { handlePipeline } = await import("./pipeline-background.mjs");
    // local harness: run without blocking the response
    handlePipeline(payload).catch((e) => console.error(e));
    return true;
  }
  const res = await fetch(`${origin}/.netlify/functions/pipeline-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, key: cfg.adminPassword }),
  });
  return res.status === 202 || res.ok;
}

export default async (req) => {
  const url = new URL(req.url);
  const origin = process.env.URL && !process.env.NETLIFY_DEV ? process.env.URL : url.origin;
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (req.headers.get("x-admin-key") !== cfg.adminPassword) return json({ error: "Wrong password" }, 401);
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};

  try {
    // GET /api/status
    if (parts[0] === "status") {
      const [leads, runs, activity] = await Promise.all([listLeads(), listRuns(), listActivity()]);
      const counts = {};
      for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1;
      return json({
        config: publicConfig(), source: SOURCE, counts,
        runs: runs.slice(0, 15).map(({ trace, ...r }) => ({ ...r, traceCount: trace?.length || 0 })),
        activity: activity.slice(0, 40),
      });
    }

    if (parts[0] === "runs" && parts[1]) {
      const run = (await listRuns()).find((r) => r.id === parts[1]);
      return run ? json(run) : json({ error: "Run not found" }, 404);
    }

    // POST /api/intake — manual trigger of the daily intake automation
    if (parts[0] === "intake" && method === "POST") {
      const run = await runIntake({
        trigger: "manual (dashboard)",
        startAgents: async (r, ids) => {
          const ok = await startBackground(origin, { mode: "batch", ids, run: r });
          if (!ok) throw new Error("Could not start the agent pipeline (background function unavailable)");
        },
      });
      return json(run);
    }

    if (parts[0] === "followups" && method === "POST") return json(await runFollowups({ trigger: "manual (dashboard)" }));

    if (parts[0] === "leads" && !parts[1]) return json(await listLeads());

    // POST /api/leads/add { entityId } — pull one specific filing into the pipeline
    if (parts[0] === "leads" && parts[1] === "add" && method === "POST") {
      const filing = await fetchFilingById(String(body.entityId || "").trim());
      if (!filing) return json({ error: "No Colorado filing with that ID" }, 404);
      const [enriched] = prefilter([filing]).kept.length ? prefilter([filing]).kept : [{ ...filing, flags: [] }];
      const lead = await newLeadFromFiling(enriched, "manual");
      await startBackground(origin, { mode: "batch", ids: [lead.id], run: { id: `run-${Date.now()}`, type: "Manual lead", trigger: `added ${filing.displayName}`, startedAt: new Date().toISOString(), status: "running", steps: [], leadIds: [lead.id] } });
      return json(lead);
    }

    const id = parts[1];
    if (parts[0] === "leads" && id) {
      const lead = await getLead(id);
      if (!lead) return json({ error: "Lead not found" }, 404);
      const action = parts[2];

      if (!action && method === "GET") return json({ ...lead, previewUrl: lead.site ? previewUrlFor(lead) : null });

      if (action === "preview") {
        if (!lead.site?.spec) return new Response("No site yet", { status: 404 });
        const html = renderSite(lead.site.spec, { mode: "preview", agency: cfg.agency, contact: null });
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (action === "approve" && method === "POST") return json(await runApproval(id, { channel: body.channel, editedEmail: body.email }));

      if (action === "reject" && method === "POST") {
        const out = await updateLead(id, (l) => { l.status = "dismissed"; l.rejectReason = body.reason || "Rejected by reviewer"; });
        await traceLead(id, { agent: "Human", kind: "human", text: `Rejected: ${out.rejectReason}` });
        return json(out);
      }

      if (action === "rebuild" && method === "POST") {
        if (!body.feedback) return json({ error: "Add feedback for the Builder" }, 400);
        await updateLead(id, (l) => { l.status = "building"; });
        await traceLead(id, { agent: "Human", kind: "human", text: `Requested changes: ${body.feedback}` });
        await startBackground(origin, { mode: "lead", id, from: "build", feedback: body.feedback });
        return json({ ok: true });
      }

      if (action === "retry" && method === "POST") {
        const from = lead.brief ? (lead.site ? "outreach" : "build") : "research";
        await startBackground(origin, { mode: "lead", id, from });
        return json({ ok: true });
      }

      if (action === "outcome" && method === "POST") {
        const status = body.outcome === "won" ? "won" : "lost";
        const out = await updateLead(id, (l) => { l.status = status; });
        await notifyOperator({ kind: status, leadId: id, title: `${status === "won" ? "Won" : "Closed"}: ${lead.filing.displayName}`, text: body.note || "" });
        return json(out);
      }
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

export const config = { path: "/api/*" };
