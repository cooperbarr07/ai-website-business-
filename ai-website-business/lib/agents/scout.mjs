// AGENT 1 — Scout / Qualifier
// Input: a batch of brand-new filings that passed the rule filter.
// Job: decide which are real, local, customer-facing businesses that do NOT
// already have a website, score them, and reject the rest with a reason.
// Decisions it makes: which leads deserve a web search, qualify vs reject,
// a 0–100 opportunity score and the business category.

import { runAgent } from "../llm.mjs";
import { config } from "../config.mjs";

const SYSTEM = `You are the Scout agent for a small web-design agency in Colorado.
Every day you receive businesses that registered with the Colorado Secretary of State in the last day or two.
Your job is to find the ones worth building a free preview website for.

A GOOD prospect:
- is a real operating business that sells to local customers or clients (trades, home services, food, beauty, fitness, health, pets, events, creative services, professional services for locals)
- does NOT already have its own website (search the web to check the promising ones)
- has a name that tells you roughly what it does

REJECT:
- holding companies, investment/property/asset entities, single-purpose or shell LLCs, personal LLCs named after a person with no clear trade
- names too vague to build a site for (e.g. "XJQ LLC", "Semibold Industries") unless a search reveals what they do
- franchises / branches of national brands, and businesses that already have a real website
- nonprofits, government, or anything sensitive (cannabis, firearms, adult, debt collection)

Process:
1. Read the whole batch. Make an initial judgement from the name, address flags and agent.
2. Use web_search on the most promising candidates (not every lead) to check if they already have a website or what they do. Search the exact business name plus the city.
3. Call record_decision once for EVERY lead in the batch. Be decisive and specific in your reason (one sentence).
4. Call finish_scouting with a short summary.

Scores: 80–100 clear local service business with no web presence; 60–79 likely good but uncertain; below 60 reject.
Never invent facts. If you are unsure what a business does, say so in the reason.`;

export async function scoutBatch({ leads, onDecision, onEvent }) {
  const ids = new Set(leads.map((l) => l.id));
  const decided = new Map();

  const tools = [
    {
      name: "record_decision",
      description: "Record your qualify/reject decision for one lead in the batch.",
      input_schema: {
        type: "object",
        properties: {
          entity_id: { type: "string" },
          decision: { type: "string", enum: ["qualified", "rejected"] },
          score: { type: "integer", minimum: 0, maximum: 100 },
          category: { type: "string", description: "Short industry label, e.g. 'Moving & hauling'" },
          reason: { type: "string" },
          existing_website: { type: ["string", "null"], description: "URL if you found one, else null" },
          searched: { type: "boolean", description: "Did you search the web for this lead?" },
        },
        required: ["entity_id", "decision", "score", "category", "reason"],
      },
      handler: async (input) => {
        if (!ids.has(String(input.entity_id))) return { error: `entity_id ${input.entity_id} is not in this batch` };
        if (input.decision === "qualified" && input.existing_website) {
          return { error: "A lead with an existing website should be rejected (or set existing_website to null if it is only a directory listing)." };
        }
        if (input.decision === "qualified" && input.score < 60) {
          return { error: "Qualified leads must score 60 or higher. Reject it or raise the score with a reason." };
        }
        decided.set(String(input.entity_id), input);
        await onDecision(String(input.entity_id), input);
        return { ok: true, remaining: [...ids].filter((id) => !decided.has(id)).length };
      },
    },
    {
      name: "finish_scouting",
      description: "Finish once every lead has a recorded decision.",
      input_schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      finish: true,
      handler: async (input) => {
        const missing = [...ids].filter((id) => !decided.has(id));
        if (missing.length) return { error: `Still missing decisions for: ${missing.join(", ")}` };
        return { ok: true, summary: input.summary };
      },
    },
  ];

  if (config.mock) return mockScout({ leads, tools, onEvent });

  const batchText = leads.map((l) => ({
    entity_id: l.id,
    name: l.filing.name,
    type: l.filing.type,
    city: l.filing.city,
    zip: l.filing.zip,
    formed: l.filing.formedAt,
    flags: l.filing.flags,
    registered_agent: l.filing.agent?.isOrganization ? "commercial agent service" : "individual (often the owner)",
  }));

  const result = await runAgent({
    name: "Scout",
    model: config.scoutModel,
    system: SYSTEM,
    task: `Today's batch (${leads.length} new Colorado filings):\n${JSON.stringify(batchText, null, 1)}`,
    tools,
    webSearches: Math.min(10, Math.max(3, Math.ceil(leads.length * 0.6))),
    location: { city: "Denver", region: "Colorado", country: "US", timezone: "America/Denver" },
    maxTurns: 20,
    onEvent,
  });
  return { decisions: Object.fromEntries(decided), summary: result.input.summary, usage: result.usage };
}

// Deterministic stand-in used when no API key is configured.
async function mockScout({ leads, tools, onEvent }) {
  const [record, finish] = tools;
  const service = /(clean|landscap|moving|haul|transport|plumb|roof|paint|salon|barber|bake|coffee|cater|fitness|yoga|pet|groom|photo|auto|detail|repair|construction|remodel|electric|hvac|lawn|tree|dance|tutor|massage|florist|studio)/i;
  await onEvent({ agent: "Scout", kind: "thought", text: "[demo mode] Screening batch by name, address flags and registered agent." });
  for (const l of leads) {
    const m = (l.filing.name || "").match(service);
    const virtual = (l.filing.flags || []).includes("virtual_address");
    const qualified = Boolean(m) && !virtual;
    if (qualified) await onEvent({ agent: "Scout", kind: "search", text: `"${l.filing.displayName}" ${l.filing.city} website` });
    await onEvent({ agent: "Scout", kind: "tool", tool: "record_decision", text: l.filing.name });
    await record.handler({
      entity_id: l.id,
      decision: qualified ? "qualified" : "rejected",
      score: qualified ? 70 + (parseInt(l.id.slice(-2), 10) % 25) : 20 + (parseInt(l.id.slice(-2), 10) % 30),
      category: m ? categoryFor(m[1]) : "Unclear",
      reason: qualified
        ? `Name indicates a local ${categoryFor(m[1]).toLowerCase()} business; no website found.`
        : virtual ? "Registered to a mailbox address and the name doesn't say what it does." : "Name doesn't indicate a customer-facing local business.",
      existing_website: null,
      searched: qualified,
    });
  }
  const res = await finish.handler({ summary: "[demo mode] Batch screened." });
  return { decisions: {}, summary: res.summary, usage: null };
}

function categoryFor(word) {
  const w = word.toLowerCase();
  if (/clean/.test(w)) return "Cleaning services";
  if (/landscap|lawn|tree/.test(w)) return "Landscaping";
  if (/moving|haul|transport/.test(w)) return "Moving & transport";
  if (/plumb|roof|paint|construction|remodel|electric|hvac|repair/.test(w)) return "Home services";
  if (/salon|barber|massage/.test(w)) return "Beauty & wellness";
  if (/bake|coffee|cater/.test(w)) return "Food & drink";
  if (/fitness|yoga|dance/.test(w)) return "Fitness";
  if (/pet|groom/.test(w)) return "Pet services";
  if (/photo|studio/.test(w)) return "Creative services";
  if (/auto|detail/.test(w)) return "Automotive";
  return "Local services";
}
