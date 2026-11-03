// AGENT 2 — Researcher
// Input: one qualified filing.
// Job: work out what the business actually does, who it serves, where, and how
// to reach the owner — keeping verified facts (with sources) separate from
// inferences. Its brief is the only factual input the Builder may use.

import { runAgent } from "../llm.mjs";
import { config } from "../config.mjs";

const SYSTEM = `You are the Researcher agent for a web-design agency. You prepare a business brief for a brand-new Colorado business so another agent can build them a preview website and pitch it to the owner.

Process:
1. Start from the state filing (name, city, address, registered agent).
2. Search the web for the business (exact name + city). Look for social profiles, Google/Yelp/Nextdoor listings, marketplace profiles, news, or the owner's other businesses. If nothing is online yet (common for businesses that registered yesterday), say so — that is normal.
3. Decide what the business most likely does, which services it would offer, who its customers are, and its service area. Base inferences on the name, location and anything you found.
4. Find a contact channel only if it is publicly listed (email, phone, social page). Never guess an email address.
5. Call save_brief.

Hard rules:
- Put something in "verified_facts" ONLY if you saw it on a page, and include that page's URL.
- Everything else is an inference: label it as such in "likely_services" and keep it generic and plausible.
- Never invent reviews, years in business, licenses, certifications, awards, prices, staff names or team size.
- If the registered agent is an individual, note they may be the owner — but do not claim it.`;

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    display_name: { type: "string", description: "How the business would present its name (title case, drop LLC if natural)" },
    industry: { type: "string" },
    one_line: { type: "string", description: "What the business most likely does, in one sentence" },
    likely_services: { type: "array", items: { type: "string" }, description: "3–6 likely services (inferred unless verified)" },
    target_customers: { type: "string" },
    service_area: { type: "string" },
    brand_tone: { type: "string", description: "e.g. 'friendly and dependable', 'polished and modern'" },
    online_presence: {
      type: "object",
      properties: {
        found_anything: { type: "boolean" },
        website: { type: ["string", "null"] },
        profiles: { type: "array", items: { type: "string" } },
      },
      required: ["found_anything"],
    },
    contact: {
      type: "object",
      properties: {
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        social: { type: ["string", "null"] },
        source_url: { type: ["string", "null"], description: "Where the contact detail was found" },
        possible_owner: { type: ["string", "null"], description: "Registered agent name if an individual" },
      },
    },
    verified_facts: {
      type: "array",
      items: {
        type: "object",
        properties: { fact: { type: "string" }, source_url: { type: "string" } },
        required: ["fact", "source_url"],
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["display_name", "industry", "one_line", "likely_services", "target_customers", "service_area", "brand_tone", "online_presence", "verified_facts", "unknowns", "confidence"],
};

export async function researchLead({ lead, onEvent }) {
  let saved = null;
  const tools = [
    {
      name: "save_brief",
      description: "Save the finished business brief.",
      input_schema: BRIEF_SCHEMA,
      finish: true,
      handler: async (brief) => {
        const problems = [];
        if (!Array.isArray(brief.likely_services) || brief.likely_services.length < 3) problems.push("likely_services needs at least 3 items");
        for (const f of brief.verified_facts || []) if (!/^https?:\/\//.test(f.source_url || "")) problems.push(`verified fact "${f.fact}" has no source URL`);
        if (brief.contact?.email && !brief.contact?.source_url) problems.push("contact.email needs a source_url — never guess an email");
        if (problems.length) return { error: problems.join("; ") };
        saved = brief;
        return { ok: true };
      },
    },
  ];

  if (config.mock) return mockResearch({ lead, tools, onEvent });

  const f = lead.filing;
  const result = await runAgent({
    name: "Researcher",
    system: SYSTEM,
    task: `State filing:\n${JSON.stringify({
      name: f.name, display_name: f.displayName, entity_type: f.type, formed: f.formedAt,
      address: `${f.address}, ${f.city}, ${f.state} ${f.zip}`,
      registered_agent: f.agent?.name, agent_is_company: f.agent?.isOrganization, flags: f.flags,
    }, null, 1)}\n\nScout's note: ${lead.scout?.reason || "n/a"} (category: ${lead.scout?.category || "?"})`,
    tools,
    webSearches: 5,
    location: { city: f.city || "Denver", region: "Colorado", country: "US", timezone: "America/Denver" },
    onEvent,
  });
  return { brief: saved || result.input, usage: result.usage };
}

async function mockResearch({ lead, tools, onEvent }) {
  const f = lead.filing;
  const name = f.displayName.replace(/,?\s*(LLC|Inc\.?|L\.L\.C\.)$/i, "").trim();
  const cat = lead.scout?.category || "Local services";
  await onEvent({ agent: "Researcher", kind: "search", text: `"${name}" ${f.city} CO` });
  await onEvent({ agent: "Researcher", kind: "thought", text: "[demo mode] No online presence found yet — normal for a business formed this week. Inferring services from the name and category." });
  const services = {
    "Cleaning services": ["Recurring home cleaning", "Deep cleaning", "Move-in / move-out cleaning", "Office cleaning"],
    "Landscaping": ["Lawn care and mowing", "Garden and bed maintenance", "Seasonal cleanups", "Snow removal"],
    "Moving & transport": ["Local moves", "Loading and unloading help", "Furniture delivery", "Junk hauling"],
    "Home services": ["Repairs and installs", "Free estimates", "Small projects", "Maintenance visits"],
    "Food & drink": ["Catering for events", "Custom orders", "Weekly specials", "Local pickup"],
  }[cat] || ["Consultations", "Core services", "Custom requests", "Ongoing support"];
  await onEvent({ agent: "Researcher", kind: "tool", tool: "save_brief", text: name });
  const brief = {
    display_name: name,
    industry: cat,
    one_line: `A new ${cat.toLowerCase()} business serving ${f.city} and nearby communities.`,
    likely_services: services,
    target_customers: `Households and small businesses in and around ${f.city}`,
    service_area: `${f.city}, Colorado and surrounding area`,
    brand_tone: "friendly and dependable",
    online_presence: { found_anything: false, website: null, profiles: [] },
    contact: { email: null, phone: null, social: null, source_url: null, possible_owner: f.agent?.isOrganization ? null : f.agent?.name },
    verified_facts: [{ fact: `Registered with the Colorado Secretary of State on ${f.formedAt}`, source_url: f.source }],
    unknowns: ["Exact services offered", "Pricing", "Contact email"],
    confidence: "low",
  };
  await tools[0].handler(brief);
  return { brief, usage: null };
}
