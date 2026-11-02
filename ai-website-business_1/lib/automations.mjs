// The automations — fixed, rule-based workflows that run on a trigger.
// They are separate from the agents: they move data and kick things off,
// while the agents make the judgement calls.
//
// 1. Daily intake       (schedule: every morning, or "Pull new filings" button)
//      fetch new state filings → rule-filter → dedupe & store → hand batch to agents → notify operator
// 2. Approval workflow  (event: operator clicks Approve)
//      publish site → send/queue outreach → schedule follow-up → notify operator
// 3. Follow-up check    (schedule: daily)
//      find leads past their follow-up date → flag them → notify operator

import { config } from "./config.mjs";
import { fetchNewFilings } from "./colorado.mjs";
import { prefilter } from "./filters.mjs";
import { getSeen, addSeen, recordRun, listLeads, getLead, updateLead, setSiteSlug, traceLead } from "./store.mjs";
import { newLeadFromFiling, previewUrlFor } from "./pipeline.mjs";
import { notifyOperator, sendEmail } from "./notify.mjs";

const iso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * Daily intake. Returns the run record including the lead IDs to hand to the agents.
 * `startAgents(run, ids)` is supplied by the caller (background function or inline).
 */
export async function runIntake({ trigger = "schedule", startAgents } = {}) {
  const run = { id: `run-${Date.now()}`, type: "Daily intake", trigger, startedAt: iso(), status: "running", steps: [] };
  const step = async (name, detail) => { run.steps.push({ step: name, at: iso(), detail }); await recordRun(run); };
  try {
    // Step 1 — fetch
    const since = daysAgo(config.lookbackDays);
    const filings = await fetchNewFilings({ sinceDate: since });
    await step("Fetched new state filings", `${filings.length} Colorado registrations since ${since}`);

    // Step 2 — rule filter
    const { kept, dropped } = prefilter(filings, { targetCities: config.targetCities });
    await step("Rule filter", `${kept.length} kept · dropped ${dropped.type} wrong type, ${dropped.status} not in good standing, ${dropped.outOfState} out of state, ${dropped.name} holding/shell names`);

    // Step 3 — dedupe + store
    const seen = await getSeen();
    const fresh = kept.filter((f) => !seen[f.id]);
    const batch = fresh.slice(0, config.scoutBatch);
    await addSeen(fresh.map((f) => f.id));
    for (const f of batch) await newLeadFromFiling(f, "intake");
    await step("Deduped and stored", `${fresh.length} not seen before · top ${batch.length} queued for the Scout agent`);

    run.leadIds = batch.map((f) => f.id);
    run.stats = { fetched: filings.length, kept: kept.length, fresh: fresh.length, queued: batch.length };

    // Step 4 — hand off to agents
    if (batch.length && startAgents) {
      await step("Started agent pipeline", `${batch.length} leads sent to Scout → Researcher → Builder → Outreach`);
      await startAgents(run, run.leadIds);
    } else {
      run.status = "done"; run.finishedAt = iso();
      await step("Nothing new to process", "");
      await notifyOperator({ kind: "intake", title: "Daily intake: no new prospects", text: `${filings.length} filings checked, none new after filtering.` });
    }
    return run;
  } catch (err) {
    run.status = "error"; run.error = err.message; run.finishedAt = iso();
    await recordRun(run);
    await notifyOperator({ kind: "error", title: "Daily intake failed", text: err.message });
    return run;
  }
}

/** Approval workflow — triggered when the operator approves a lead. */
export async function runApproval(id, { channel, editedEmail } = {}) {
  const lead = await getLead(id);
  if (!lead) throw new Error("Lead not found");
  if (lead.status !== "review") throw new Error(`Lead is "${lead.status}", not awaiting review`);
  const run = { id: `run-${Date.now()}`, type: "Approval", trigger: `approved: ${lead.filing.displayName}`, startedAt: iso(), status: "running", steps: [], leadIds: [id] };
  const step = async (name, detail) => { run.steps.push({ step: name, at: iso(), detail }); await recordRun(run); await traceLead(id, { agent: "Automation", kind: "automation", text: `${name}: ${detail}` }); };

  // Step 1 — publish the preview site
  await setSiteSlug(lead.site.slug, id);
  const url = previewUrlFor(lead);
  await updateLead(id, (l) => { l.status = "published"; l.site.publishedAt = iso(); l.site.url = url; });
  await step("Published preview site", url);

  // Step 2 — send or queue outreach
  const chosen = channel || lead.outreach.recommended_channel;
  const subject = editedEmail?.subject || lead.outreach.email_subject;
  const body = editedEmail?.body || lead.outreach.email_body;
  let delivery;
  if (chosen === "email" && config.sendMode === "live" && lead.brief?.contact?.email) {
    const ok = await sendEmail({ to: lead.brief.contact.email, subject, text: body, replyTo: config.agency.email });
    delivery = ok ? `Emailed ${lead.brief.contact.email}` : "Email send failed — queued for manual send";
  } else if (chosen === "email") {
    const ok = config.operatorEmail ? await sendEmail({ to: config.operatorEmail, subject: `[TEST — would go to prospect] ${subject}`, text: body }) : false;
    delivery = `Test mode: ${ok ? `copy emailed to ${config.operatorEmail}` : "email queued in dashboard"} (prospects are never emailed in test mode)`;
  } else {
    delivery = `Letter queued for mailing to ${lead.filing.address}, ${lead.filing.city}, CO ${lead.filing.zip}`;
  }
  await updateLead(id, (l) => {
    l.status = "contacted";
    l.outreach = { ...l.outreach, email_subject: subject, email_body: body, sentChannel: chosen, delivery, sentAt: iso() };
  });
  await step("Outreach sent/queued", delivery);

  // Step 3 — schedule follow-up
  const followUpAt = new Date(Date.now() + config.followupDays * 864e5).toISOString();
  await updateLead(id, (l) => { l.followUpAt = followUpAt; });
  await step("Follow-up scheduled", followUpAt.slice(0, 10));

  // Step 4 — notify
  await notifyOperator({ kind: "approved", leadId: id, title: `Published: ${lead.filing.displayName}`, text: `${url}\n${delivery}\nFollow up on ${followUpAt.slice(0, 10)}.` });
  run.status = "done"; run.finishedAt = iso();
  await step("Operator notified", "Activity feed" + (config.webhookUrl ? " + webhook" : "") + (config.resendKey && config.operatorEmail ? " + email" : ""));
  return getLead(id);
}

/** Follow-up check — scheduled daily. */
export async function runFollowups({ trigger = "schedule" } = {}) {
  const run = { id: `run-${Date.now()}`, type: "Follow-up check", trigger, startedAt: iso(), status: "running", steps: [] };
  const index = await listLeads();
  const contacted = index.filter((l) => l.status === "contacted");
  run.steps.push({ step: "Scanned contacted leads", at: iso(), detail: `${contacted.length} awaiting a reply` });
  const due = [];
  for (const s of contacted) {
    const l = await getLead(s.id);
    if (l?.followUpAt && l.followUpAt <= iso()) {
      await updateLead(l.id, (x) => { x.status = "follow_up"; });
      due.push(l);
    }
  }
  run.steps.push({ step: "Flagged due follow-ups", at: iso(), detail: `${due.length} due` });
  if (due.length) {
    await notifyOperator({ kind: "followup", title: `${due.length} follow-up${due.length === 1 ? "" : "s"} due today`, text: due.map((l) => `• ${l.filing.displayName} — contacted ${l.outreach?.sentAt?.slice(0, 10)}`).join("\n") });
  }
  run.steps.push({ step: "Operator notified", at: iso(), detail: due.length ? "Sent" : "Nothing due" });
  run.status = "done"; run.finishedAt = iso();
  await recordRun(run);
  return run;
}
