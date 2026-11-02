// Guardrails the Builder must pass before a site can go to human review.
// These are the "can't-trust-the-LLM" checks: no invented social proof,
// credentials, prices or contact details for a real business.

import { THEMES } from "./themes.mjs";

const CLAIMS = [
  [/testimonial|\breviews?\b|\brated\b|★|\b\d(\.\d)?\s*stars?\b|five[- ]star|5[- ]star/i, "customer reviews / ratings"],
  [/\baward|voted|#\s?1\b|number one|best in (town|denver|colorado|the)/i, "awards or rankings"],
  [/licen[cs]ed|insured|bonded|certified|accredited|board[- ]certified/i, "licenses, insurance or certifications"],
  [/guarantee|warranty/i, "guarantees or warranties"],
  [/\b\d+\+?\s*(years?|yrs)\b|since (19|20)\d\d|decades? of/i, "years in business / experience"],
  [/\$\s?\d|\d+\s?%\s?off|free (estimate|quote)s?/i, "prices, discounts or free offers"],
  [/\b\d[\d,]*\+?\s*(happy\s+)?(customers|clients|homes|families|projects|jobs|moves|events)\b/i, "customer counts"],
  [/(\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/, "phone numbers"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "email addresses"],
  [/\b(our|the) team of\b|\bstaff of\b/i, "team size"],
];

const LIMITS = {
  hero_headline: [8, 70], hero_subhead: [30, 200], cta_label: [3, 24], tagline: [0, 90],
  about_text: [80, 600], contact_text: [20, 260], seo_title: [10, 65], seo_description: [50, 160],
};

export function validateSpec(spec, brief) {
  const errors = [];
  const warnings = [];
  const facts = (brief?.verified_facts || []).map((f) => f.fact.toLowerCase()).join(" ");

  if (!THEMES[spec.theme]) errors.push(`theme must be one of: ${Object.keys(THEMES).join(", ")}`);
  else if (!THEMES[spec.theme].palettes[spec.palette]) {
    errors.push(`palette "${spec.palette}" is not in theme "${spec.theme}". Options: ${Object.keys(THEMES[spec.theme].palettes).join(", ")}`);
  }
  if (!spec.business_name) errors.push("business_name is required");
  else if (brief?.display_name && spec.business_name.toLowerCase() !== brief.display_name.toLowerCase()) {
    warnings.push(`business_name "${spec.business_name}" differs from the brief's display_name "${brief.display_name}"`);
  }
  if (!spec.service_area) errors.push("service_area is required");

  for (const [k, [min, max]] of Object.entries(LIMITS)) {
    const v = spec[k] || "";
    if (min && v.length < min) errors.push(`${k} is too short (${v.length} chars, min ${min})`);
    if (v.length > max) errors.push(`${k} is too long (${v.length} chars, max ${max})`);
  }

  const services = spec.services || [];
  if (services.length < 3 || services.length > 6) errors.push(`services needs 3–6 items (has ${services.length})`);
  services.forEach((s, i) => {
    if (!s.title || s.title.length > 48) errors.push(`services[${i}].title missing or longer than 48 chars`);
    if (!s.description || s.description.length < 30 || s.description.length > 180) errors.push(`services[${i}].description should be 30–180 chars`);
  });
  const why = spec.why_points || [];
  if (why.length && why.length !== 3) warnings.push("why_points reads best with exactly 3 items");
  const steps = spec.process_steps || [];
  if (steps.length && (steps.length < 3 || steps.length > 4)) errors.push("process_steps needs 3–4 items, or omit it");

  // Claim scan across all visible copy.
  const fields = [];
  const walk = (v, p) => {
    if (typeof v === "string") fields.push([p, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(spec, "");
  for (const [p, text] of fields) {
    if (["theme", "palette"].includes(p)) continue;
    for (const [re, label] of CLAIMS) {
      const m = text.match(re);
      if (m && !facts.includes(m[0].toLowerCase())) {
        errors.push(`${p} contains "${m[0]}" (${label}). This is a real business: don't state ${label} that aren't in the brief's verified facts. Rephrase.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
