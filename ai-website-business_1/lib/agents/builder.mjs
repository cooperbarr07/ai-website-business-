// AGENT 3 — Builder
// Input: the Researcher's brief (+ optional human feedback on a previous draft).
// Job: choose a theme and palette that fit the business, write all the site
// copy, run the preview check, fix every problem it reports, then submit.
// Decisions: visual direction, structure (which sections), copy, and how to
// respond to validation failures or reviewer feedback.

import { runAgent } from "../llm.mjs";
import { config } from "../config.mjs";
import { themeCatalog } from "../themes.mjs";
import { validateSpec } from "../validate.mjs";

const SYSTEM = `You are the Builder agent at a web-design agency. You turn a business brief into a one-page preview website for a brand-new Colorado business. The owner will see this preview as our pitch, so it must feel made for them — specific to their trade, town and customers — and it must be honest.

Process:
1. Call list_themes and pick the theme and palette that suit this business and its brand tone.
2. Write the site spec. Copy should be concrete and plain-spoken, written as the business ("we"), aimed at its customers. Name the town/area. Prefer specific nouns over hype.
3. Call check_site with your spec. It returns errors and warnings.
4. Fix every error (and warnings where sensible) and check again. Repeat until it passes.
5. Call submit_site with the passing spec and a one-sentence design rationale.

Honesty rules (the checker enforces most of these):
- Never claim reviews, ratings, awards, licenses, insurance, certifications, guarantees, years of experience, prices, free offers, customer counts or team size unless they appear in the brief's verified_facts.
- Never write phone numbers or email addresses; contact details are added later by the owner.
- Services can only be ones listed in the brief's likely_services (you may reword them).
- About text should describe the business's focus and who it serves, not an invented history.`;

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    theme: { type: "string" },
    palette: { type: "string" },
    business_name: { type: "string" },
    tagline: { type: "string" },
    hero_headline: { type: "string" },
    hero_subhead: { type: "string" },
    cta_label: { type: "string" },
    service_area: { type: "string" },
    services_heading: { type: "string" },
    services: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"] } },
    why_heading: { type: "string" },
    why_points: { type: "array", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
    process_heading: { type: "string" },
    process_steps: { type: "array", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
    about_heading: { type: "string" },
    about_text: { type: "string" },
    contact_heading: { type: "string" },
    contact_text: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
  required: ["theme", "palette", "business_name", "hero_headline", "hero_subhead", "cta_label", "service_area", "services", "about_text", "contact_text", "seo_title", "seo_description"],
};

export async function buildSite({ lead, feedback, onEvent }) {
  const brief = lead.brief;
  let checks = 0;
  let lastPassed = null;

  const tools = [
    {
      name: "list_themes",
      description: "List the available site themes and their palettes.",
      input_schema: { type: "object", properties: {} },
      handler: async () => ({ themes: themeCatalog() }),
    },
    {
      name: "check_site",
      description: "Validate a site spec. Returns errors (must fix) and warnings.",
      input_schema: SPEC_SCHEMA,
      handler: async (spec) => {
        checks++;
        const r = validateSpec(spec, brief);
        await onEvent({ agent: "Builder", kind: r.ok ? "check_passed" : "check_failed", text: r.ok ? `Check ${checks} passed${r.warnings.length ? ` with ${r.warnings.length} warning(s)` : ""}` : `Check ${checks}: ${r.errors.length} problem(s) — ${r.errors.slice(0, 3).join(" | ")}` });
        if (r.ok) lastPassed = JSON.stringify(spec);
        return r;
      },
    },
    {
      name: "submit_site",
      description: "Submit the final site spec. It must have passed check_site unchanged.",
      input_schema: {
        type: "object",
        properties: { spec: SPEC_SCHEMA, rationale: { type: "string" } },
        required: ["spec", "rationale"],
      },
      finish: true,
      handler: async ({ spec, rationale }) => {
        if (!checks) return { error: "Run check_site before submitting." };
        const r = validateSpec(spec, brief);
        if (!r.ok) return { error: "Spec fails validation", ...r };
        return { ok: true, rationale };
      },
    },
  ];

  if (config.mock) return mockBuild({ lead, tools, onEvent });

  const result = await runAgent({
    name: "Builder",
    system: SYSTEM,
    task: [
      `Business brief:\n${JSON.stringify(brief, null, 1)}`,
      `Filing: ${lead.filing.displayName}, ${lead.filing.city}, CO (formed ${lead.filing.formedAt})`,
      feedback ? `\nA human reviewer rejected the previous draft with this feedback — address it directly:\n"${feedback}"\n\nPrevious draft:\n${JSON.stringify(lead.site?.spec || {}, null, 1)}` : "",
    ].join("\n"),
    tools,
    maxTokens: 6000,
    maxTurns: 12,
    onEvent,
  });
  return { spec: result.input.spec, rationale: result.input.rationale, checks, usage: result.usage };
}

async function mockBuild({ lead, tools, onEvent }) {
  const b = lead.brief;
  const cat = (b.industry || "").toLowerCase();
  const theme = /home|landscap|moving|automotive|construction/.test(cat) ? "sturdy"
    : /food|beauty|pet|fitness/.test(cat) ? "neighborhood" : "editorial";
  const palette = { sturdy: "spruce", neighborhood: "citrus", editorial: "ink" }[theme];
  const town = (b.service_area || "").split(",")[0] || lead.filing.city;
  await onEvent({ agent: "Builder", kind: "thought", text: `[demo mode] ${b.industry} → "${theme}" theme, "${palette}" palette.` });
  await tools[0].handler({});
  const spec = {
    theme, palette,
    business_name: b.display_name,
    tagline: `${b.industry} for ${town}`,
    hero_headline: `${b.industry} ${town} can count on`,
    hero_subhead: `${b.display_name} is a new ${b.industry.toLowerCase()} business serving ${b.service_area}. Tell us what you need and we'll get back to you quickly.`,
    cta_label: "Request a quote",
    service_area: b.service_area,
    services_heading: "What we do",
    services: b.likely_services.slice(0, 4).map((s) => ({ title: s, description: `${s} for ${b.target_customers.toLowerCase()}, scheduled around you.` })),
    why_heading: "Why neighbors call us",
    why_points: [
      { title: "Local to " + town, text: "We live and work here, so we know the area and show up when we say we will." },
      { title: "Clear communication", text: "You'll know what to expect before we start, and we keep you posted along the way." },
      { title: "Careful work", text: "We treat every job, big or small, like it's for our own family." },
    ],
    process_heading: "How it works",
    process_steps: [
      { title: "Tell us about the job", text: "Send a quick message with what you need and when." },
      { title: "Get a clear plan", text: "We'll confirm the details and timing with you." },
      { title: "We take care of it", text: "We do the work and check that you're happy with it." },
    ],
    about_heading: `About ${b.display_name}`,
    about_text: `${b.display_name} was started to give ${town} a ${b.brand_tone} option for ${b.industry.toLowerCase()}. We focus on ${b.likely_services.slice(0, 2).join(" and ").toLowerCase()}, and we're building this business one happy customer at a time.`,
    contact_heading: "Let's get started",
    contact_text: `Tell us a little about what you need and we'll reply with next steps.`,
    seo_title: `${b.display_name} | ${b.industry} in ${town}, CO`.slice(0, 65),
    seo_description: `${b.display_name} offers ${b.likely_services.slice(0, 3).join(", ").toLowerCase()} in ${b.service_area}.`.slice(0, 160),
  };
  // Demo the self-correction loop: first draft includes a forbidden claim.
  const draft = { ...spec, hero_subhead: spec.hero_subhead + " Licensed and insured." };
  await onEvent({ agent: "Builder", kind: "tool", tool: "check_site", text: "draft 1" });
  await tools[1].handler(draft);
  await onEvent({ agent: "Builder", kind: "thought", text: "[demo mode] Removing the unverified 'licensed and insured' claim and re-checking." });
  await onEvent({ agent: "Builder", kind: "tool", tool: "check_site", text: "draft 2" });
  const r = await tools[1].handler(spec);
  if (!r.ok) throw new Error("Mock spec failed validation: " + r.errors.join("; "));
  await tools[2].handler({ spec, rationale: "[demo mode] Theme matched to industry." });
  return { spec, rationale: `[demo mode] ${theme} theme fits ${b.industry.toLowerCase()}.`, checks: 2, usage: null };
}
