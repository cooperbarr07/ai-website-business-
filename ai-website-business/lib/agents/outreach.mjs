// AGENT 4 — Outreach writer
// Input: brief + preview link + agency details.
// Job: pick the best channel (email if a public address was found, otherwise
// a mailed letter to the address on the state filing), write a short,
// personal, honest pitch, and pass the compliance check (CAN-SPAM basics).

import { runAgent } from "../llm.mjs";
import { config } from "../config.mjs";

const SYSTEM = `You are the Outreach agent for a small web-design agency. A brand-new Colorado business just got a free preview website from us. Write the first message to the owner.

Process:
1. Decide the channel: "email" only if the brief has a publicly listed email; otherwise "letter" (mailed to the address on their state filing). Social DM is not allowed.
2. Write BOTH a short email (subject + body) and a letter version — the reviewer may switch channels.
3. Call check_compliance on the email and fix every problem.
4. Call save_outreach.

Style: under 150 words, warm and specific, no hype. Congratulate them on starting the business, mention one concrete detail about their trade or town, link the preview, say what it costs nothing to look at, and give one easy next step (reply / scan to claim). Sign with the sender's first name and agency.
Honesty: say plainly that we found them through public Colorado business registrations. Never pretend to be a customer, never imply we work with the state, never use fake urgency or "Re:"/"Fwd:" subjects. Don't promise prices.`;

export function complianceCheck({ subject = "", body = "" }, ctx) {
  const problems = [];
  if (/^\s*(re|fwd?):/i.test(subject)) problems.push("Subject must not start with Re:/Fwd: (deceptive under CAN-SPAM).");
  if (/urgent|act now|last chance|expires|invoice|payment due|final notice/i.test(subject + " " + body)) problems.push("Remove fake urgency / billing language.");
  if (subject.length < 8 || subject.length > 70) problems.push("Subject should be 8–70 characters.");
  if (!body.includes(ctx.previewUrl)) problems.push(`Body must include the preview link exactly: ${ctx.previewUrl}`);
  if (!/unsubscribe|opt out|don't want (to hear|more)|won't (email|contact) you again|reply ['"]?stop/i.test(body)) problems.push("Include a clear opt-out line (e.g. 'Reply STOP and I won't contact you again').");
  if (!body.includes(ctx.agencyAddress)) problems.push(`Include the agency's physical address exactly: ${ctx.agencyAddress}`);
  if (!/public|registration|secretary of state|state filing|registered/i.test(body)) problems.push("Say how we found them (public Colorado business registrations).");
  if (/secretary of state (sent|asked|requires)|on behalf of the state|official notice/i.test(body)) problems.push("Never imply we are affiliated with the state.");
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 190) problems.push(`Too long (${words} words). Keep the email under ~150 words before the footer.`);
  return { ok: problems.length === 0, problems };
}

export async function writeOutreach({ lead, previewUrl, onEvent }) {
  const agency = config.agency;
  const ctx = { previewUrl, agencyAddress: agency.address };
  let passed = false;

  const tools = [
    {
      name: "check_compliance",
      description: "Check an email draft for CAN-SPAM basics and our outreach rules.",
      input_schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] },
      handler: async (draft) => {
        const r = complianceCheck(draft, ctx);
        passed = r.ok;
        await onEvent({ agent: "Outreach", kind: r.ok ? "check_passed" : "check_failed", text: r.ok ? "Compliance check passed" : r.problems.join(" | ") });
        return r;
      },
    },
    {
      name: "save_outreach",
      description: "Save the final outreach package.",
      input_schema: {
        type: "object",
        properties: {
          recommended_channel: { type: "string", enum: ["email", "letter"] },
          channel_reason: { type: "string" },
          email_subject: { type: "string" },
          email_body: { type: "string" },
          letter_body: { type: "string" },
          greeting_name: { type: ["string", "null"] },
        },
        required: ["recommended_channel", "channel_reason", "email_subject", "email_body", "letter_body"],
      },
      finish: true,
      handler: async (o) => {
        const r = complianceCheck({ subject: o.email_subject, body: o.email_body }, ctx);
        if (!r.ok) return { error: "Email fails compliance", problems: r.problems };
        if (o.recommended_channel === "email" && !lead.brief?.contact?.email) return { error: "No public email in the brief — recommend 'letter'." };
        if (!o.letter_body.includes(previewUrl)) return { error: "Letter must include the preview link." };
        return { ok: true };
      },
    },
  ];

  if (config.mock) return mockOutreach({ lead, previewUrl, agency, tools, onEvent });

  const result = await runAgent({
    name: "Outreach",
    system: SYSTEM,
    task: JSON.stringify({
      brief: lead.brief,
      filing: { name: lead.filing.displayName, city: lead.filing.city, formed: lead.filing.formedAt, mailing_address: `${lead.filing.address}, ${lead.filing.city}, CO ${lead.filing.zip}` },
      preview_url: previewUrl,
      agency: { name: agency.name, sender_first_name: agency.sender, reply_email: agency.email, physical_address: agency.address },
    }, null, 1),
    tools,
    onEvent,
  });
  return { ...result.input, usage: result.usage };
}

async function mockOutreach({ lead, previewUrl, agency, tools, onEvent }) {
  const b = lead.brief;
  const owner = b.contact?.possible_owner?.split(" ")[0];
  const hi = owner ? `Hi ${owner},` : "Hi there,";
  const body = `${hi}

Congratulations on registering ${b.display_name}! I saw it in this week's public Colorado business registrations and, since it's still early days, I put together a free preview website for you:

${previewUrl}

It's built around ${b.likely_services[0].toLowerCase()} in ${b.service_area.split(",")[0]}. If you like it, reply and I'll set it up with your phone number, email and domain. No cost to look, and no obligation.

${agency.sender}
${agency.name} · ${agency.email}
${agency.address}

Reply STOP and I won't contact you again.`;
  await onEvent({ agent: "Outreach", kind: "thought", text: "[demo mode] No public email found → recommending a mailed letter to the filing address." });
  await onEvent({ agent: "Outreach", kind: "tool", tool: "check_compliance", text: "email draft" });
  await tools[0].handler({ subject: `A free website preview for ${b.display_name}`, body });
  const out = {
    recommended_channel: b.contact?.email ? "email" : "letter",
    channel_reason: b.contact?.email ? "Public email found." : "No public email yet; the filing has a mailing address.",
    email_subject: `A free website preview for ${b.display_name}`,
    email_body: body,
    letter_body: body.replace("Reply STOP and I won't contact you again.", "Scan the link above or email me to claim it. If you'd rather not hear from me again, just email STOP."),
    greeting_name: owner || null,
  };
  const r = await tools[1].handler(out);
  if (r.error) throw new Error(r.error + " " + (r.problems || []).join("; "));
  return { ...out, usage: null };
}
