// Background function (up to 15 minutes): runs the agents.
// Invoked by the intake automation and by dashboard actions.

import { config } from "../../lib/config.mjs";
import { runBatch, runLeadPipeline } from "../../lib/pipeline.mjs";
import { recordRun } from "../../lib/store.mjs";

export async function handlePipeline(p) {
  if (p.mode === "batch") {
    const run = p.run || { id: `run-${Date.now()}`, type: "Agent batch", trigger: "api", startedAt: new Date().toISOString(), status: "running", steps: [] };
    try {
      await runBatch(p.ids, { run });
    } catch (err) {
      run.status = "error"; run.error = err.message; run.finishedAt = new Date().toISOString();
      await recordRun(run);
    }
  } else if (p.mode === "lead") {
    await runLeadPipeline(p.id, { from: p.from, feedback: p.feedback });
  }
}

export default async (req) => {
  const p = await req.json().catch(() => ({}));
  if (p.key !== config.adminPassword) return new Response("Unauthorized", { status: 401 });
  await handlePipeline(p);
  return new Response("ok");
};
