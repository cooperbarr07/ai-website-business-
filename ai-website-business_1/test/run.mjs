// End-to-end smoke test in demo mode (no API key, fixture filings, file storage).
//   npm test

import fs from "node:fs/promises";
import assert from "node:assert/strict";

process.env.LOCAL_STORE = "1";
process.env.LOCAL_STORE_DIR = ".data-test";
process.env.FIXTURE_FILINGS = new URL("./fixture-filings.json", import.meta.url).pathname;
process.env.MOCK_LLM = "1";
await fs.rm(".data-test", { recursive: true, force: true });

const { runIntake, runApproval, runFollowups } = await import("../lib/automations.mjs");
const { runBatch } = await import("../lib/pipeline.mjs");
const { listLeads, getLead, listRuns, listActivity, updateLead } = await import("../lib/store.mjs");
const { validateSpec } = await import("../lib/validate.mjs");
const { complianceCheck } = await import("../lib/agents/outreach.mjs");
const { renderSite } = await import("../lib/render.mjs");

// 1. Intake automation → agents
const run = await runIntake({ trigger: "test", startAgents: (r, ids) => runBatch(ids, { run: r }) });
console.log("intake:", run.status, run.stats, run.steps.map((s) => s.step));
assert.equal(run.status, "done");
assert.ok(run.stats.kept < run.stats.fetched, "filter removed something");

const leads = await listLeads();
const byStatus = Object.groupBy(leads, (l) => l.status);
console.log("statuses:", Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])));
assert.ok(!leads.some((l) => /HOLDINGS|PROPERTIES|Investments/i.test(l.name)), "holding cos filtered by rules");
assert.ok((byStatus.review || []).length >= 1, "at least one lead reached review");

// 2. Approval automation
const first = await getLead(byStatus.review[0].id);
assert.ok(first.trace.some((t) => t.kind === "check_failed"), "builder self-corrected");
const approved = await runApproval(first.id);
console.log("approved:", approved.status, approved.outreach.delivery, approved.followUpAt?.slice(0, 10));
assert.equal(approved.status, "contacted");

// 3. Follow-up automation
await updateLead(first.id, (l) => { l.followUpAt = new Date(Date.now() - 1000).toISOString(); });
const fu = await runFollowups({ trigger: "test" });
console.log("followups:", fu.steps.map((s) => `${s.step}: ${s.detail}`));
assert.equal((await getLead(first.id)).status, "follow_up");

// 4. Guardrails
const bad = { ...first.site.spec, hero_subhead: "Rated 5 stars by 200+ happy customers. Call (303) 555-1234! Licensed & insured since 2009." };
const v = validateSpec(bad, first.brief);
console.log("validator caught:", v.errors.length, "problems");
assert.ok(v.errors.length >= 4);
const c = complianceCheck({ subject: "Re: your invoice", body: "hi" }, { previewUrl: "https://x/s/a", agencyAddress: "Boulder, CO" });
assert.ok(!c.ok && c.problems.length >= 4);

// 5. Render every built site
await fs.mkdir(".data-test/sites", { recursive: true });
for (const s of leads) {
  const l = await getLead(s.id);
  if (l.site?.spec) await fs.writeFile(`.data-test/sites/${l.site.slug}.html`, renderSite(l.site.spec, { agency: { name: "Day One Sites", email: "hello@example.com" } }));
}
console.log("runs:", (await listRuns()).length, "activity:", (await listActivity()).length);
console.log("ALL TESTS PASSED");
