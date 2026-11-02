// Scheduled trigger for the follow-up check (daily, mid-morning Mountain time).

import { runFollowups } from "../../lib/automations.mjs";

export default async () => {
  await runFollowups({ trigger: "schedule (daily)" });
};

export const config = { schedule: "30 16 * * *" };
