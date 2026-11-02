// Renders a Builder site spec into a complete, self-contained HTML page.

import { THEMES } from "./themes.mjs";

const esc = (s = "") => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderSite(spec, { mode = "preview", agency, claimUrl, contact } = {}) {
  const theme = THEMES[spec.theme] || THEMES.sturdy;
  const p = theme.palettes[spec.palette] || Object.values(theme.palettes)[0];
  const f = theme.fonts;
  const year = new Date().getFullYear();
  const isPreview = mode !== "live";
  const claimHref = claimUrl || `mailto:${agency?.email || ""}?subject=${encodeURIComponent(`Claim my site: ${spec.business_name}`)}`;

  const services = (spec.services || []).map((s) => `
      <li class="svc"><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p></li>`).join("");
  const why = (spec.why_points || []).map((w) => `
      <li><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></li>`).join("");
  const steps = (spec.process_steps || []).map((s, i) => `
      <li><span class="n" aria-hidden="true">${i + 1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></li>`).join("");

  const contactLines = [];
  if (contact?.phone) contactLines.push(`<a href="tel:${esc(contact.phone)}">${esc(contact.phone)}</a>`);
  if (contact?.email) contactLines.push(`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`);
  const contactBlock = contactLines.length
    ? `<p class="contact-lines">${contactLines.join("<br>")}</p>`
    : isPreview
      ? `<p class="placeholder">Your phone number, email and booking link go here when you claim this site.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.seo_title || spec.business_name)}</title>
<meta name="description" content="${esc(spec.seo_description || spec.hero_subhead || "")}">
${isPreview ? '<meta name="robots" content="noindex, nofollow">' : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${f.href}&display=swap" rel="stylesheet">
<style>
:root{--bg:${p.bg};--surface:${p.surface};--ink:${p.ink};--muted:${p.muted};--primary:${p.primary};--on-primary:${p.onPrimary};--accent:${p.accent};
--display:"${f.display}",system-ui,sans-serif;--body:"${f.body}",system-ui,sans-serif;--dw:${f.displayWeight}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.6 var(--body)}
a{color:inherit}img{max-width:100%}
h1,h2,h3{font-family:var(--display);font-weight:var(--dw);line-height:1.08;margin:0 0 .5em}
h3{font-size:1.25rem;line-height:1.2}
p{margin:0 0 1em}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.btn{display:inline-block;background:var(--primary);color:var(--on-primary);text-decoration:none;font-weight:600;padding:.85em 1.4em;border-radius:var(--radius,6px);border:2px solid var(--primary)}
.btn.ghost{background:transparent;color:var(--primary)}
.btn:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
header.top{padding:18px 0}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{font-family:var(--display);font-weight:var(--dw);font-size:1.35rem;text-decoration:none;letter-spacing:.01em}
.hero{padding:72px 0 80px}
.hero h1{font-size:clamp(2.4rem,6vw,4.6rem);max-width:15ch}
.hero .sub{font-size:1.2rem;color:var(--muted);max-width:52ch;margin-bottom:1.6em}
.hero .area{display:inline-block;margin-top:1.4em;color:var(--muted);font-size:.95rem}
section{padding:72px 0}
section h2{font-size:clamp(1.8rem,3.6vw,2.6rem);max-width:22ch}
.svcs{list-style:none;padding:0;margin:32px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
.svc{background:var(--surface);padding:24px;border-radius:var(--radius,6px)}
.svc p{color:var(--muted);margin:0}
.why{list-style:none;padding:0;margin:32px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px}
.why p{color:var(--muted)}
.steps{list-style:none;padding:0;margin:32px 0 0;display:grid;gap:20px;max-width:720px}
.steps li{display:flex;gap:18px;align-items:flex-start}
.steps .n{flex:none;width:44px;height:44px;border-radius:50%;background:var(--primary);color:var(--on-primary);display:grid;place-items:center;font-family:var(--display);font-weight:var(--dw);font-size:1.2rem}
.steps p{color:var(--muted);margin:0}
.about p{max-width:62ch;font-size:1.125rem}
.contact{background:var(--primary);color:var(--on-primary)}
.contact h2{color:var(--on-primary)}
.contact p{max-width:56ch}
.contact .btn{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
.contact .placeholder{opacity:.85;font-style:italic}
.contact-lines{font-size:1.25rem;font-weight:600}
footer{padding:32px 0;color:var(--muted);font-size:.9rem}
footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
.preview-bar{position:sticky;top:0;z-index:10;background:#1B1F24;color:#F5F7FA;font:500 .9rem/1.4 system-ui,sans-serif;padding:10px 0}
.preview-bar .wrap{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:space-between}
.preview-bar a{color:#FFFFFF;font-weight:700}

/* ---- theme: sturdy ---- */
.t-sturdy{--radius:4px}
.t-sturdy .hero{background:var(--primary);color:var(--on-primary);padding:88px 0 96px;position:relative;overflow:hidden}
.t-sturdy .hero h1{text-transform:uppercase;letter-spacing:.005em;font-size:clamp(2.8rem,8vw,5.8rem);max-width:13ch}
.t-sturdy .hero .sub,.t-sturdy .hero .area{color:var(--on-primary);opacity:.9}
.t-sturdy .hero .btn{background:var(--accent);border-color:var(--accent);color:var(--ink)}
.t-sturdy .hero::after{content:"";position:absolute;right:-60px;bottom:-60px;width:360px;height:360px;border:36px solid var(--accent);border-radius:50%;opacity:.35}
.t-sturdy header.top{background:var(--surface)}
.t-sturdy section h2{text-transform:uppercase}
.t-sturdy .svc{border-top:6px solid var(--accent)}
.t-sturdy .areaband{background:var(--accent);color:var(--ink);padding:18px 0;font-family:var(--display);font-weight:var(--dw);font-size:1.4rem;text-transform:uppercase}

/* ---- theme: editorial ---- */
.t-editorial{--radius:2px}
.t-editorial .hero{padding:96px 0 88px;display:block}
.t-editorial .hero .wrap{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:48px;align-items:end}
.t-editorial .hero h1{font-size:clamp(2.6rem,6.2vw,5rem);max-width:14ch}
.t-editorial .hero aside{border-left:3px solid var(--primary);padding-left:20px;color:var(--muted)}
.t-editorial .svc{background:transparent;padding:0 0 0 18px;border-left:1px solid var(--accent)}
.t-editorial section+section{border-top:1px solid var(--accent)}
.t-editorial .areaband{display:none}
@media (max-width:760px){.t-editorial .hero .wrap{grid-template-columns:1fr}}

/* ---- theme: neighborhood ---- */
.t-neighborhood{--radius:18px}
.t-neighborhood .btn{border-radius:999px}
.t-neighborhood .hero{position:relative;overflow:hidden}
.t-neighborhood .hero::before{content:"";position:absolute;z-index:-1;right:-8%;top:-20%;width:min(560px,70vw);aspect-ratio:1;background:var(--accent);border-radius:46% 54% 60% 40%/50% 42% 58% 50%}
.t-neighborhood .hero{z-index:0}
.t-neighborhood .svc{box-shadow:0 1px 0 rgba(0,0,0,.04),0 8px 24px -12px rgba(0,0,0,.18)}
.t-neighborhood .areaband{background:var(--surface);padding:18px 0;font-weight:700;text-align:center}
.t-neighborhood .contact{border-radius:28px;margin:0 16px 24px}

@media (max-width:600px){.hero{padding:48px 0 56px}section{padding:52px 0}.t-sturdy .hero::after{display:none}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
</head>
<body class="t-${esc(spec.theme)}">
${isPreview ? `<div class="preview-bar" role="note"><div class="wrap"><span>Free preview made for ${esc(spec.business_name)} by ${esc(agency?.name || "")}. This site isn't live yet.</span><a href="${esc(claimHref)}">Claim this site</a></div></div>` : ""}
<header class="top"><div class="wrap"><a class="brand" href="#">${esc(spec.business_name)}</a><a class="btn ghost" href="#contact">${esc(spec.cta_label || "Get in touch")}</a></div></header>
<main>
<div class="hero"><div class="wrap">
  <div>
    <h1>${esc(spec.hero_headline)}</h1>
    <p class="sub">${esc(spec.hero_subhead)}</p>
    <a class="btn" href="#contact">${esc(spec.cta_label || "Get in touch")}</a>
    ${spec.theme !== "editorial" ? "" : `<br><span class="area">Serving ${esc(spec.service_area)}</span>`}
  </div>
  ${spec.theme === "editorial" ? `<aside><p>${esc(spec.tagline || "")}</p></aside>` : ""}
</div></div>
${spec.theme !== "editorial" ? `<div class="areaband"><div class="wrap">Serving ${esc(spec.service_area)}</div></div>` : ""}
<section id="services"><div class="wrap">
  <h2>${esc(spec.services_heading || "What we do")}</h2>
  <ul class="svcs">${services}</ul>
</div></section>
${why ? `<section><div class="wrap"><h2>${esc(spec.why_heading || "Why work with us")}</h2><ul class="why">${why}</ul></div></section>` : ""}
${steps ? `<section><div class="wrap"><h2>${esc(spec.process_heading || "How it works")}</h2><ol class="steps">${steps}</ol></div></section>` : ""}
<section class="about"><div class="wrap"><h2>${esc(spec.about_heading || "About us")}</h2><p>${esc(spec.about_text)}</p></div></section>
<section class="contact" id="contact"><div class="wrap">
  <h2>${esc(spec.contact_heading || "Let's talk")}</h2>
  <p>${esc(spec.contact_text || "")}</p>
  ${contactBlock}
  ${isPreview ? `<a class="btn" href="${esc(claimHref)}">Claim this site</a>` : ""}
</div></section>
</main>
<footer><div class="wrap"><span>&copy; ${year} ${esc(spec.business_name)}</span><span>${isPreview ? `Preview site by ${esc(agency?.name || "")}` : `Site by ${esc(agency?.name || "")}`}</span></div></footer>
</body>
</html>`;
}
