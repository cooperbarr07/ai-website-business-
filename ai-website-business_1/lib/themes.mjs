// Curated website themes. The Builder agent chooses a theme + palette and
// writes the copy; the renderer guarantees the result is accessible and
// never broken. (Contrast of every palette was checked by hand: body text
// and buttons meet WCAG AA.)

export const THEMES = {
  sturdy: {
    label: "Sturdy",
    bestFor: "Trades, home services, moving, hauling, automotive, construction, landscaping",
    feel: "Bold condensed headlines, solid color bands, built to look dependable",
    fonts: { display: "Barlow Condensed", displayWeight: 800, body: "Barlow", href: "family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600" },
    palettes: {
      spruce: { bg: "#F3F6F4", surface: "#FFFFFF", ink: "#16241C", muted: "#4C5E53", primary: "#1E5A3C", onPrimary: "#FFFFFF", accent: "#E8B23A" },
      brick:  { bg: "#F7F4F2", surface: "#FFFFFF", ink: "#24160F", muted: "#5E4C43", primary: "#9A3412", onPrimary: "#FFFFFF", accent: "#F4C26B" },
      steel:  { bg: "#F2F5F8", surface: "#FFFFFF", ink: "#14202E", muted: "#4B5A6B", primary: "#1F3A5F", onPrimary: "#FFFFFF", accent: "#F2A900" },
      safety: { bg: "#FFFBEA", surface: "#FFFFFF", ink: "#1E2329", muted: "#545B63", primary: "#2B3440", onPrimary: "#FFD34E", accent: "#FFC400" },
    },
  },
  editorial: {
    label: "Editorial",
    bestFor: "Consultants, creative studios, photographers, coaches, therapists, professional services",
    feel: "Generous whitespace, a refined serif display, calm and credible",
    fonts: { display: "Young Serif", displayWeight: 400, body: "Instrument Sans", href: "family=Young+Serif&family=Instrument+Sans:wght@400;500;600" },
    palettes: {
      ink:   { bg: "#F5F6FA", surface: "#FFFFFF", ink: "#171C33", muted: "#545A72", primary: "#27306B", onPrimary: "#FFFFFF", accent: "#B9C3F0" },
      sage:  { bg: "#F1F5F1", surface: "#FFFFFF", ink: "#18241D", muted: "#4F5F55", primary: "#2F5A45", onPrimary: "#FFFFFF", accent: "#C9DCCB" },
      plum:  { bg: "#F8F3F6", surface: "#FFFFFF", ink: "#2A1626", muted: "#644F5F", primary: "#6B2C5F", onPrimary: "#FFFFFF", accent: "#E7C6DD" },
      stone: { bg: "#F4F4F2", surface: "#FFFFFF", ink: "#1D1D1B", muted: "#5A5A55", primary: "#3D4A3F", onPrimary: "#FFFFFF", accent: "#D8D3C4" },
    },
  },
  neighborhood: {
    label: "Neighborhood",
    bestFor: "Food & drink, bakeries, salons, pet care, fitness, kids, events, retail",
    feel: "Warm, rounded and friendly, like a favorite local shop",
    fonts: { display: "Bricolage Grotesque", displayWeight: 700, body: "Nunito Sans", href: "family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Nunito+Sans:wght@400;600;700" },
    palettes: {
      citrus: { bg: "#FFF7F0", surface: "#FFFFFF", ink: "#2B1A10", muted: "#6A5143", primary: "#C2410C", onPrimary: "#FFFFFF", accent: "#FFD8A8" },
      berry:  { bg: "#FFF4F8", surface: "#FFFFFF", ink: "#2C1120", muted: "#6D4A5B", primary: "#A3255F", onPrimary: "#FFFFFF", accent: "#FFC9DE" },
      lagoon: { bg: "#EFF8F8", surface: "#FFFFFF", ink: "#0F2A2E", muted: "#46646A", primary: "#13707E", onPrimary: "#FFFFFF", accent: "#A7E3E3" },
      meadow: { bg: "#F4F9EE", surface: "#FFFFFF", ink: "#1A2A12", muted: "#4F6146", primary: "#3F6B1F", onPrimary: "#FFFFFF", accent: "#CFE8A9" },
    },
  },
};

export function themeCatalog() {
  return Object.entries(THEMES).map(([id, t]) => ({
    id, label: t.label, best_for: t.bestFor, feel: t.feel,
    palettes: Object.entries(t.palettes).map(([pid, p]) => ({ id: pid, primary: p.primary, background: p.bg, accent: p.accent })),
  }));
}
