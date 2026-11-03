// Colorado Secretary of State business registry, published daily on
// data.colorado.gov (Socrata dataset 4ykn-tg5h). Free, no key required.

const BASE = "https://data.colorado.gov/resource/4ykn-tg5h.json";

export const SOURCE = {
  name: "Colorado Secretary of State — Business Entities",
  url: "https://data.colorado.gov/Business/Colorado-Business-Entities/4ykn-tg5h",
};

export async function fetchNewFilings({ sinceDate, limit = 2000 }) {
  if (process.env.FIXTURE_FILINGS) {
    const fs = await import("node:fs/promises");
    const rows = JSON.parse(await fs.readFile(process.env.FIXTURE_FILINGS, "utf8"));
    return rows.map(normalize);
  }
  const params = new URLSearchParams({
    $where: `entityformdate >= '${sinceDate}T00:00:00'`,
    $order: "entityformdate DESC",
    $limit: String(limit),
  });
  const res = await fetch(`${BASE}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Colorado data API returned ${res.status}`);
  const rows = await res.json();
  return rows.map(normalize);
}

export async function fetchFilingById(entityId) {
  if (process.env.FIXTURE_FILINGS) {
    const all = await fetchNewFilings({ sinceDate: "1900-01-01" });
    return all.find((f) => f.id === entityId) || null;
  }
  const params = new URLSearchParams({ entityid: entityId });
  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`Colorado data API returned ${res.status}`);
  const [row] = await res.json();
  return row ? normalize(row) : null;
}

const titleCase = (s = "") =>
  s.length > 3 && s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLlc\b/g, "LLC")
    : s;

export function normalize(r) {
  const agentPerson = [r.agentfirstname, r.agentlastname].filter(Boolean).join(" ");
  return {
    id: String(r.entityid),
    name: r.entityname,
    displayName: titleCase(r.entityname || ""),
    type: r.entitytype,
    status: r.entitystatus,
    formedAt: (r.entityformdate || "").slice(0, 10),
    address: [r.principaladdress1, r.principaladdress2].filter(Boolean).join(", "),
    city: titleCase(r.principalcity || ""),
    state: r.principalstate,
    zip: r.principalzipcode,
    jurisdiction: r.jurisdictonofformation, // (sic) field name in the dataset
    agent: {
      name: agentPerson ? titleCase(agentPerson) : r.agentorganizationname || "",
      isOrganization: !agentPerson && Boolean(r.agentorganizationname),
      address: [r.agentprincipaladdress1, r.agentprincipaladdress2].filter(Boolean).join(", "),
      city: r.agentprincipalcity,
    },
    source: SOURCE.url,
  };
}
