// Orchestrates the agents for a batch of leads:
//   Scout (whole batch) → for the best N: Researcher → Builder → Outreach → human review.

import { config } from "./config.mjs";
import { getLead, saveLead, updateLead, traceLead, recordRun } from "./store.mjs";
import { scoutBatch } from "./agents/scout.mjs";
import { researchLead } from "./agents/researcher.mjs";
import { buildSite } from "./agents/builder.mjs";
import { writeOutreach } from "./agents/outreach.mjs";
import { notifyOperator } from "./notify.mjs";

export const slugFor = (lead) =>
  `${(lead.filing.displayName || lead.filing.name || "site")
    .toLowerCase().replace(/\b(llc|inc|l\.l\.c|ltd|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${lead.id.slice(-4)}`;

export const previewUrlFor = (lead) => `${config.siteUrl.replace(/\/$/, "")}/s/${lead.site?.slug || slugFor(lead)}`;

const tracer = (id) => (e) => traceLead(id, e);

async function setStatus(id, status, extra = {}) {
  return updateLead(id, (l) => { l.status = status; Object.assign(l, extra); });
}

export async function runScout(leadIds, run) {
  const leads = (await Promise.all(leadIds.map(getLead))).filter(Boolean);
  if (!leads.length) return [];
  for (const l of leads) await setStatus(l.id, "scouting");
  run && (run.steps.push({ step: "Scout agent screening", at: new Date().toISOString(), detail: `${leads.length} leads` }), await recordRun(run));

  // Batch-level reasoning is stored on the automation run; each lead gets its own decision.
  const batchTrace = [];
  const onEvent = async (e) => {
    batchTrace.push({ at: new Date().toISOString(), ...e });
    if (run) { run.trace = batchTrace.slice(-300); await recordRun(run); }
  };
  const res = await scoutBatch({
    leads,
    onEvent,
    onDecision: async (id, d) => {
      await updateLead(id, (l) => {
        l.scout = { decision: d.decision, score: d.score, category: d.category, reason: d.reason, existingWebsite: d.existing_website || null, searched: !!d.searched };
        l.status = d.decision === "qualified" ? "qualified" : "rejected";
        l.trace = l.trace || [];
        l.trace.push({ at: new Date().toISOString(), agent: "Scout", kind: "decision", text: `${d.decision.toUpperCase()} (${d.score}) — ${d.reason}${d.searched ? " [searched the web]" : ""}` });
      });
    },
  });
  const after = (await Promise.all(leadIds.map(getLead))).filter(Boolean);
  // Anything the scout somehow skipped is marked for a human to look at.
  for (const l of after.filter((x) => x.status === "scouting")) await setStatus(l.id, "rejected", { scout: { decision: "rejected", score: 0, reason: "Scout did not decide" } });
  const qualified = after.filter((l) => l.status === "qualified").sort((a, b) => b.scout.score - a.scout.score);
  if (run) run.scoutSummary = res.summary;
  return { qualified: qualified.map((l) => l.id), summary: res.summary };
}

export async function runLeadPipeline(id, { feedback, from = "research" } = {}) {
  const onEvent = tracer(id);
  try {
    let lead = await getLead(id);
    if (from === "research") {
      await setStatus(id, "researching");
      const { brief } = await researchLead({ lead, onEvent });
      lead = await updateLead(id, (l) => { l.brief = brief; });
      if (brief.online_presence?.website) {
        await setStatus(id, "rejected", { rejectReason: `Already has a website: ${brief.online_presence.website}` });
        return getLead(id);
      }
    }
    if (from === "research" || from === "build") {
      await setStatus(id, "building");
      lead = await getLead(id);
      const built = await buildSite({ lead, feedback, onEvent });
      lead = await updateLead(id, (l) => {
        const versions = l.site?.versions || [];
        if (l.site?.spec) versions.push({ at: l.site.builtAt, spec: l.site.spec, feedback: feedback || null });
        l.site = { slug: l.site?.slug || slugFor(l), spec: built.spec, rationale: built.rationale, checks: built.checks, builtAt: new Date().toISOString(), versions: versions.slice(-5) };
      });
    }
    await setStatus(id, "drafting");
    lead = await getLead(id);
    const outreach = await writeOutreach({ lead, previewUrl: previewUrlFor(lead), onEvent });
    delete outreach.usage;
    await setStatus(id, "review", { outreach });
    return getLead(id);
  } catch (err) {
    await traceLead(id, { agent: "System", kind: "error", text: err.message });
    await setStatus(id, "error", { error: err.message });
    return getLead(id);
  }
}

/** Full pipeline for a batch: scout everything, then build the best few. */
export async function runBatch(leadIds, { run } = {}) {
  const { qualified = [], summary } = (await runScout(leadIds, run)) || {};
  const toBuild = qualified.slice(0, config.maxBuilds);
  if (run) { run.steps.push({ step: "Agents building previews", at: new Date().toISOString(), detail: `${qualified.length} qualified, building top ${toBuild.length}` }); await recordRun(run); }
  const done = [];
  for (const id of toBuild) done.push(await runLeadPipeline(id));
  const ready = done.filter((l) => l?.status === "review");
  if (run) {
    run.steps.push({ step: "Operator notified", at: new Date().toISOString(), detail: `${ready.length} ready for review` });
    run.status = "done"; run.finishedAt = new Date().toISOString();
    await recordRun(run);
  }
  await notifyOperator({
    kind: "review",
    title: `${ready.length} new preview site${ready.length === 1 ? "" : "s"} ready for review`,
    text: ready.length ? ready.map((l) => `• ${l.filing.displayName} (${l.filing.city}) — score ${l.scout?.score}`).join("\n") : `Scout summary: ${summary || "no strong prospects in this batch."}`,
  });
  return { qualified, built: done.map((l) => l?.id) };
}

export async function newLeadFromFiling(filing, origin = "intake") {
  const existing = await getLead(filing.id);
  if (existing) return existing;
  return saveLead({ id: filing.id, filing, status: "new", origin, createdAt: new Date().toISOString(), trace: [] });
}
