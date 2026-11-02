// Notifications to the operator (and, in live mode, outreach email to prospects).
// Always written to the dashboard activity feed; email via Resend and a
// Slack/Discord-compatible webhook are used when configured.

import { config } from "./config.mjs";
import { addActivity } from "./store.mjs";

export async function notifyOperator({ title, text, kind = "info", leadId }) {
  await addActivity({ kind, title, text, leadId });
  const results = { feed: true };
  if (config.webhookUrl) {
    try {
      const r = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${text}`, content: `**${title}**\n${text}` }),
      });
      results.webhook = r.ok;
    } catch { results.webhook = false; }
  }
  if (config.resendKey && config.operatorEmail) {
    results.email = await sendEmail({ to: config.operatorEmail, subject: `[${config.agency.name}] ${title}`, text });
  }
  return results;
}

export async function sendEmail({ to, subject, text, replyTo }) {
  if (!config.resendKey) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.resendKey}` },
      body: JSON.stringify({ from: config.resendFrom, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return r.ok;
  } catch { return false; }
}
