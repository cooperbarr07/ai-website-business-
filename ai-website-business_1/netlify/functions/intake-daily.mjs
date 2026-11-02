// Scheduled trigger for the daily intake automation (7:00 am Mountain Standard Time).

import { config as cfg } from "../../lib/config.mjs";
import { runIntake } from "../../lib/automations.mjs";

export default async () => {
  await runIntake({
    trigger: "schedule (daily 7am MT)",
    startAgents: async (run, ids) => {
      const res = await fetch(`${process.env.URL}/.netlify/functions/pipeline-background`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "batch", ids, run, key: cfg.adminPassword }),
      });
      if (res.status !== 202 && !res.ok) throw new Error(`Agent pipeline did not start (${res.status})`);
    },
  });
};

export const config = { schedule: "0 14 * * *" };
