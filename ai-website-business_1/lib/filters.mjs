// Rule-based pre-filter used by the intake automation (no LLM here).
// It removes filings that are clearly not website prospects and ranks the rest
// so the Scout agent spends its budget on the most promising ones.

const KEEP_TYPES = new Set(["DLLC", "DPC", "DPC-PBC"]);

// Names that almost always mean a holding / investment / shell entity.
const EXCLUDE = /\b(holding|holdings|properties|property|investments?|investors?|capital|trust|assets?|real estate|realty holdings|equity|fund|funding|spv|acquisitions?|ventures? group|family|enterprises? holdings|management group|hoa|homeowners|association|series \w+|land|rentals?|lending|partners lp)\b/i;

// Words that suggest a local, customer-facing business that needs a website.
const SERVICE_WORDS = /\b(plumbing|plumber|roofing|roofers?|electric(al)?|hvac|heating|cooling|landscap\w*|lawn|tree|snow|clean\w*|maid|janitorial|painting|painters?|construction|builders?|remodel\w*|handyman|flooring|concrete|fencing|pest|moving|movers|hauling|junk|transport\w*|towing|auto|automotive|detail\w*|mechanic|salon|barber\w*|beauty|nails?|lash|brows?|spa|massage|wellness|yoga|pilates|fitness|gym|training|coach\w*|tutor\w*|daycare|childcare|dental|chiropract\w*|therapy|counsel\w*|clinic|vet\w*|pet|grooming|dog|bakery|bake\w*|coffee|cafe|catering|kitchen|food|tacos?|pizza|bbq|brew\w*|photo\w*|video\w*|studio|design|media|marketing|events?|wedding|florist|floral|boutique|shop|apparel|tattoo|music|dance|art|craft|cleaners|laundry|repair|services?|solutions|consulting|bookkeeping|tax|accounting|insurance|law|legal|realty|homes?)\b/i;

// Mailbox / registered-agent addresses — the business may have no real location.
const VIRTUAL_ADDRESSES = [/1500 n grant st/i, /^po box/i, /\bpmb\b/i, /#\d{3,}/];

export function prefilter(filings, { targetCities = [] } = {}) {
  const kept = [];
  const dropped = { type: 0, status: 0, outOfState: 0, name: 0 };
  for (const f of filings) {
    if (!KEEP_TYPES.has(f.type)) { dropped.type++; continue; }
    if (f.status && f.status !== "Good Standing") { dropped.status++; continue; }
    if (f.state && f.state !== "CO") { dropped.outOfState++; continue; }
    if (EXCLUDE.test(f.name || "")) { dropped.name++; continue; }
    kept.push({ ...f, priority: priority(f, targetCities), flags: flags(f) });
  }
  kept.sort((a, b) => b.priority - a.priority);
  return { kept, dropped };
}

function flags(f) {
  const out = [];
  if (VIRTUAL_ADDRESSES.some((re) => re.test(f.address || ""))) out.push("virtual_address");
  if (f.agent?.isOrganization) out.push("commercial_registered_agent");
  if (SERVICE_WORDS.test(f.name || "")) out.push("service_keyword");
  return out;
}

function priority(f, targetCities) {
  let p = 0;
  if (SERVICE_WORDS.test(f.name || "")) p += 40;
  if (targetCities.length && targetCities.includes((f.city || "").toLowerCase())) p += 30;
  if (!VIRTUAL_ADDRESSES.some((re) => re.test(f.address || ""))) p += 15;
  if (!f.agent?.isOrganization) p += 10; // owner listed as agent: small, local
  if (/\b(llc|inc)\b/i.test(f.name || "") && (f.name || "").split(" ").length <= 2) p -= 10; // e.g. "XJQ LLC"
  // stable tie-break so batches are deterministic
  p += (parseInt(String(f.id).slice(-3), 10) % 10) / 10;
  return p;
}
