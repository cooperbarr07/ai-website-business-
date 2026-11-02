// Lead Desk — operator dashboard. Vanilla JS, no build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");

const LABEL = {
  new: "Queued", scouting: "Scouting", qualified: "Qualified", rejected: "Not a fit", researching: "Researching",
  building: "Building site", drafting: "Writing pitch", review: "Needs review", published: "Published",
  contacted: "Contacted", follow_up: "Follow up", won: "Won", lost: "Closed", dismissed: "Dismissed", error: "Error",
};
const WORKING = new Set(["new", "scouting", "researching", "building", "drafting"]);
const FILTERS = [
  ["review", "Needs review", (l) => l.status === "review"],
  ["working", "In progress", (l) => WORKING.has(l.status) || l.status === "qualified"],
  ["out", "Contacted", (l) => ["published", "contacted", "follow_up", "won", "lost"].includes(l.status)],
  ["all", "All", () => true],
];

const state = {
  key: safeGet("adminKey"), view: "leads", filter: safeGet("filter") || "review",
  leads: [], status: null, selected: null, lead: null, tab: "site", mobile: false, poll: null,
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    method: opts.body ? "POST" : "GET",
    headers: { "x-admin-key": state.key || "", "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { state.key = null; safeSet("adminKey", null); renderLogin("That password didn't work."); throw new Error("unauthorized"); }
  if (opts.raw) return res.text();
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 3200);
}

// ---------------- login ----------------
function renderLogin(error = "") {
  app.innerHTML = `<div class="login"><form>
    <h1>Lead Desk</h1>
    <p>New Colorado businesses, a preview site for each, and a pitch ready for your review.</p>
    <label for="pw"><b>Operator password</b></label>
    <input id="pw" type="password" autocomplete="current-password" required>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <button class="btn primary">Open the desk</button>
  </form></div>`;
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    state.key = $("#pw").value; safeSet("adminKey", state.key);
    try { await load(); } catch {}
  };
  $("#pw").focus();
}

// ---------------- data ----------------
async function load({ quiet = false } = {}) {
  const [status, leads] = await Promise.all([api("status"), api("leads")]);
  state.status = status; state.leads = leads;
  if (state.selected) state.lead = await api(`leads/${state.selected}`).catch(() => null);
  // Polling only redraws when something changed, so edits and the preview aren't reset.
  const sig = JSON.stringify([leads.map((l) => [l.id, l.status, l.updatedAt]), status.runs.map((r) => [r.id, r.status, r.steps?.length, r.traceCount]), status.activity[0]?.at, state.lead?.updatedAt]);
  const typing = document.activeElement?.matches?.("textarea, input");
  if (!quiet || (sig !== state.sig && !typing && !$("#dlg")?.open)) { state.sig = sig; render(); }
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(state.poll);
  const busy = state.leads.some((l) => WORKING.has(l.status)) || state.status?.runs?.some((r) => r.status === "running");
  state.poll = setTimeout(() => load({ quiet: true }).catch(() => {}), busy ? 3000 : 20000);
}

// ---------------- shell ----------------
function render() {
  const s = state.status;
  const cfg = s.config;
  const lastIntake = s.runs.find((r) => r.type === "Daily intake" && r.stats);
  const st = lastIntake?.stats;
  const counts = s.counts || {};
  const ready = counts.review || 0;
  const live = (counts.published || 0) + (counts.contacted || 0) + (counts.follow_up || 0) + (counts.won || 0);

  app.innerHTML = `
  <header class="top">
    <div class="mark">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#F2C14E"/><circle cx="16" cy="16" r="8" fill="none" stroke="#15233A" stroke-width="3"/><circle cx="16" cy="16" r="2.5" fill="#15233A"/></svg>
      <span>${esc(cfg.agency.name)} <small>Lead Desk</small></span>
    </div>
    <nav class="nav" aria-label="Views">
      <button data-view="leads" ${state.view === "leads" ? 'aria-current="page"' : ""}>Leads</button>
      <button data-view="auto" ${state.view === "auto" ? 'aria-current="page"' : ""}>Automations</button>
    </nav>
    ${cfg.mock ? `<span class="mode" title="No ANTHROPIC_API_KEY set: agents are deterministic stand-ins">Demo mode</span>` : ""}
    ${cfg.sendMode === "test" ? `<span class="mode" title="Outreach never reaches prospects in test mode">Test sending</span>` : ""}
    <span class="spacer"></span>
    <button class="btn" id="add">Add by filing ID</button>
    <button class="btn primary" id="pull">Pull new filings</button>
  </header>
  <div class="funnel" aria-label="Pipeline">
    ${st ? `
      <span class="f"><b>${st.fetched.toLocaleString()}</b> new filings</span><span class="arrow" aria-hidden="true">›</span>
      <span class="f"><b>${st.kept.toLocaleString()}</b> passed the filter</span><span class="arrow" aria-hidden="true">›</span>
      <span class="f"><b>${st.queued}</b> scouted</span><span class="arrow" aria-hidden="true">›</span>`
      : `<span class="f">No intake run yet.</span>`}
    <span class="f"><b>${ready}</b> waiting for you</span><span class="arrow" aria-hidden="true">›</span>
    <span class="f"><b>${live}</b> published</span>
    <span class="src">Source: <a href="${esc(s.source.url)}" target="_blank" rel="noopener">${esc(s.source.name)}</a>${lastIntake ? ` · last pull ${timeAgo(lastIntake.startedAt)}` : ""}</span>
  </div>
  <main id="main"></main>
  <dialog id="dlg"></dialog>`;

  app.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { state.view = b.dataset.view; render(); }));
  $("#pull").onclick = pull;
  $("#add").onclick = addById;
  state.view === "leads" ? renderDesk() : renderAutomations();
}

async function pull() {
  const b = $("#pull"); b.disabled = true; b.textContent = "Pulling…";
  try {
    const run = await api("intake", { body: {} });
    toast(run.status === "error" ? `Intake failed: ${run.error}` : `${run.stats?.queued ?? 0} new leads sent to the agents`);
    state.filter = "working";
  } catch (e) { toast(e.message); }
  await load();
}

function addById() {
  const d = $("#dlg");
  d.innerHTML = `<form method="dialog">
    <h2>Add a business by filing ID</h2>
    <p>Paste the Colorado Secretary of State ID number (for example 20268346786). The agents will scout, research and build it.</p>
    <div class="field"><label for="eid">Filing ID</label><input id="eid" inputmode="numeric" required pattern="[0-9]{6,}"></div>
    <div class="row-btns"><button class="btn quiet" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add and process</button></div>
  </form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try {
      const lead = await api("leads/add", { body: { entityId: $("#eid", d).value } });
      state.selected = lead.id; state.filter = "all"; toast(`Added ${lead.filing.displayName}`);
      await load();
    } catch (e) { toast(e.message); }
  };
}

// ---------------- leads desk ----------------
function renderDesk() {
  const main = $("#main");
  const f = FILTERS.find((x) => x[0] === state.filter) || FILTERS[0];
  const items = state.leads.filter(f[2]).sort((a, b) => state.filter === "review" ? (b.score ?? 0) - (a.score ?? 0) : 0);
  main.innerHTML = `<div class="desk">
    <aside class="queue" aria-label="Lead queue">
      <div class="filters" role="group" aria-label="Filter leads">
        ${FILTERS.map(([id, label, fn]) => `<button data-f="${id}" aria-pressed="${id === state.filter}">${label}<span class="n">${state.leads.filter(fn).length}</span></button>`).join("")}
      </div>
      <ul class="list">${items.map(rowHtml).join("") || `<li class="empty">${emptyQueueText()}</li>`}</ul>
    </aside>
    <section class="detail" id="detail" aria-live="polite">${state.lead ? detailHtml(state.lead) : emptyDetailHtml()}</section>
  </div>`;
  main.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; safeSet("filter", state.filter); renderDesk(); }));
  main.querySelectorAll("[data-lead]").forEach((b) => (b.onclick = () => select(b.dataset.lead)));
  if (state.lead) wireDetail();
}

const emptyQueueText = () => state.filter === "review"
  ? "Nothing is waiting for review. Pull new filings to start a batch."
  : "No leads here yet.";

function rowHtml(l) {
  const sc = l.score ?? "";
  return `<li><button class="row" data-lead="${esc(l.id)}" aria-current="${l.id === state.selected}">
    <span class="nm">${esc(l.name)}</span>
    <span class="score ${sc >= 75 ? "hi" : ""}" aria-label="Score ${sc}">${sc}</span>
    <span class="meta">${esc(l.city || "")} · <span class="pill ${esc(l.status)} ${WORKING.has(l.status) ? "working" : ""}">${LABEL[l.status] || l.status}</span></span>
  </button></li>`;
}

function emptyDetailHtml() {
  const n = state.status.counts.review || 0;
  return `<div class="empty"><h2>${n ? `${n} preview${n === 1 ? "" : "s"} waiting for you` : "Start with today's filings"}</h2>
    <p>${n ? "Pick a lead on the left to check its site and pitch before anything goes out." : "Pull new filings and the agents will screen them, research the best few, build a preview site for each, and draft the outreach. Nothing is published or sent until you approve it."}</p></div>`;
}

async function select(id) {
  state.selected = id; state.tab = "site";
  state.lead = await api(`leads/${id}`);
  renderDesk();
}

function detailHtml(l) {
  const f = l.filing;
  const working = WORKING.has(l.status);
  return `
  <div class="filing">
    <div>
      <h1>${esc(l.brief?.display_name || f.displayName)}</h1>
      <div class="facts">
        <span>Filed <b>${esc(f.formedAt)}</b></span>
        <span>${esc(f.type)} · <b>${esc(f.city)}</b>, CO ${esc(f.zip || "")}</span>
        <span>Registered agent <b>${esc(f.agent?.name || "—")}</b></span>
      </div>
    </div>
    <div class="stamp ${esc(l.status)}" role="status">${esc(LABEL[l.status] || l.status)}<small>CO #${esc(f.id)}</small></div>
  </div>
  ${l.scout ? `<p class="scout-note"><b>Scout ${l.scout.score}/100</b>${esc(l.scout.category || "")}: ${esc(l.scout.reason)}</p>` : ""}
  ${l.rejectReason ? `<p class="scout-note"><b>Stopped</b>${esc(l.rejectReason)}</p>` : ""}
  ${l.error ? `<p class="scout-note"><b>Error</b>${esc(l.error)}</p>` : ""}
  ${actionsHtml(l, working)}
  <div class="tabs" role="tablist">
    ${[["site", "Preview site", l.site], ["outreach", "Outreach", l.outreach], ["brief", "Research brief", l.brief], ["trace", "Agent trace", true]]
      .map(([id, label, has]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}" ${has ? "" : "disabled"}>${label}</button>`).join("")}
  </div>
  <div class="pane" role="tabpanel">${paneHtml(l)}</div>`;
}

function actionsHtml(l, working) {
  if (working) return `<div class="actions"><span class="hint">Agents are working on this lead. The trace updates live.</span></div>`;
  if (l.status === "review") return `<div class="actions">
      <span class="hint">Nothing goes out until you approve.</span>
      <button class="btn danger" id="reject">Reject</button>
      <button class="btn" id="changes">Request changes</button>
      <button class="btn go" id="approve">Approve and send</button></div>`;
  if (["contacted", "follow_up", "published"].includes(l.status)) return `<div class="actions">
      <span class="hint">${esc(l.outreach?.delivery || "")}${l.followUpAt ? ` · follow up ${esc(l.followUpAt.slice(0, 10))}` : ""}</span>
      <a class="btn quiet" href="${esc(l.previewUrl)}" target="_blank" rel="noopener">Open live preview</a>
      <button class="btn" data-outcome="lost">Mark closed</button>
      <button class="btn go" data-outcome="won">Mark won</button></div>`;
  if (["qualified", "error", "rejected"].includes(l.status)) return `<div class="actions">
      <span class="hint">${l.status === "qualified" ? "Qualified but not built in this batch." : l.status === "rejected" ? "The Scout passed on this one. You can overrule it." : "Something failed. You can retry from the last good step."}</span>
      <button class="btn primary" id="retry">${l.status === "error" ? "Retry" : "Build a preview anyway"}</button></div>`;
  return "";
}

function paneHtml(l) {
  if (state.tab === "site" && l.site) return `
    <div class="frame-wrap">
      <div class="frame-bar"><span class="url">${esc(l.previewUrl || "")}</span>
        <button data-vp="desktop" aria-pressed="${!state.mobile}">Desktop</button><button data-vp="mobile" aria-pressed="${state.mobile}">Phone</button>
      </div>
      <iframe class="site ${state.mobile ? "mobile" : ""}" title="Preview of the generated site" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>
    </div>
    <p class="rationale"><b>Builder:</b> ${esc(l.site.rationale || "")} · passed the honesty check after ${l.site.checks || 1} attempt${l.site.checks === 1 ? "" : "s"}${l.site.versions?.length ? ` · version ${l.site.versions.length + 1}` : ""}</p>`;

  if (state.tab === "outreach" && l.outreach) {
    const o = l.outreach;
    const editable = l.status === "review";
    return `
      <div class="callout"><b>Recommended: ${o.recommended_channel === "email" ? "email" : "mailed letter"}.</b> ${esc(o.channel_reason || "")}</div>
      ${editable ? `<div class="channel" role="radiogroup" aria-label="Channel">
        <label><input type="radio" name="ch" value="letter" ${o.recommended_channel !== "email" ? "checked" : ""}> Letter to ${esc(l.filing.address)}, ${esc(l.filing.city)}</label>
        <label><input type="radio" name="ch" value="email" ${o.recommended_channel === "email" ? "checked" : ""} ${l.brief?.contact?.email ? "" : "disabled"}> Email ${l.brief?.contact?.email ? esc(l.brief.contact.email) : "(no public email found)"}</label>
      </div>` : `<p><b>Sent via ${esc(o.sentChannel || "")}</b> · ${esc(o.delivery || "")}</p>`}
      <div class="cols">
        <div>
          <div class="field"><label for="subj">Email subject</label><input id="subj" value="${esc(o.email_subject)}" ${editable ? "" : "readonly"}></div>
          <div class="field"><label for="body">Email</label><textarea id="body" ${editable ? "" : "readonly"}>${esc(o.email_body)}</textarea></div>
        </div>
        <div class="field"><label for="letter">Letter</label><textarea id="letter" readonly>${esc(o.letter_body)}</textarea></div>
      </div>`;
  }

  if (state.tab === "brief" && l.brief) {
    const b = l.brief;
    return `<div class="cols">
      <div class="card"><h3>What the business does</h3><p>${esc(b.one_line)}</p>
        <dl class="kv"><dt>Industry</dt><dd>${esc(b.industry)}</dd><dt>Customers</dt><dd>${esc(b.target_customers)}</dd><dt>Area</dt><dd>${esc(b.service_area)}</dd><dt>Tone</dt><dd>${esc(b.brand_tone)}</dd>
        <dt>Confidence</dt><dd class="conf">${esc(b.confidence)}</dd></dl></div>
      <div class="card"><h3>Likely services <span class="sub">(inferred)</span></h3><ul>${b.likely_services.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
      <div class="card"><h3>Verified facts</h3>${b.verified_facts?.length ? `<ul>${b.verified_facts.map((x) => `<li>${esc(x.fact)} <a href="${esc(x.source_url)}" target="_blank" rel="noopener">source</a></li>`).join("")}</ul>` : `<p class="sub">None found online yet.</p>`}</div>
      <div class="card"><h3>Online presence and contact</h3>
        <dl class="kv"><dt>Found online</dt><dd>${b.online_presence?.found_anything ? "Yes" : "Nothing yet"}</dd>
        ${(b.online_presence?.profiles || []).map((p) => `<dt>Profile</dt><dd><a href="${esc(p)}" target="_blank" rel="noopener">${esc(p)}</a></dd>`).join("")}
        <dt>Email</dt><dd>${esc(b.contact?.email || "—")}</dd><dt>Phone</dt><dd>${esc(b.contact?.phone || "—")}</dd>
        <dt>Possible owner</dt><dd>${esc(b.contact?.possible_owner || "—")}</dd></dl></div>
      <div class="card"><h3>Unknowns</h3><ul>${(b.unknowns || []).map((u) => `<li>${esc(u)}</li>`).join("") || "<li>None listed</li>"}</ul></div>
    </div>`;
  }

  const trace = (l.trace || []).slice().reverse();
  return trace.length ? `<ol class="trace" reversed>${trace.map((t) => `
    <li class="${esc(t.kind)}"><span class="who ${esc(t.agent)}">${esc(t.agent)}<small>${new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</small></span>
    <span class="what"><span class="k">${esc(KIND[t.kind] || t.kind)}${t.tool ? ` ${esc(t.tool)}` : ""}</span>${esc(t.text || "")}</span></li>`).join("")}</ol>`
    : `<p class="empty">No agent activity yet.</p>`;
}

const KIND = { thought: "Thinking", search: "Searched", search_results: "Read", tool: "Called", rejected: "Tool refused", check_failed: "Check failed", check_passed: "Check passed", decision: "Decided", usage: "Usage", error: "Error", human: "You", automation: "Automation" };

function wireDetail() {
  const l = state.lead;
  $("#detail").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderDesk(); }));
  $("#detail").querySelectorAll("[data-vp]").forEach((b) => (b.onclick = () => { state.mobile = b.dataset.vp === "mobile"; renderDesk(); }));
  const frame = $("iframe.site");
  if (frame) api(`leads/${l.id}/preview`, { raw: true }).then((html) => { frame.srcdoc = html; });

  const approve = $("#approve");
  if (approve) approve.onclick = () => confirmDialog({
    title: `Approve ${l.brief?.display_name || l.filing.displayName}?`,
    text: `This publishes the preview site and ${state.status.config.sendMode === "live" ? "sends the outreach" : "queues the outreach (test mode: prospects are never emailed)"}, then schedules a follow-up in ${state.status.config.followupDays} days.`,
    ok: "Approve and send",
    run: async () => {
      const ch = document.querySelector("input[name=ch]:checked")?.value;
      const subj = $("#subj")?.value, body = $("#body")?.value;
      await api(`leads/${l.id}/approve`, { body: { channel: ch, email: subj ? { subject: subj, body } : undefined } });
      toast("Published");
    },
  });
  const reject = $("#reject");
  if (reject) reject.onclick = () => confirmDialog({
    title: "Reject this lead?", text: "It won't be published or contacted.", ok: "Reject", field: "Reason (optional)",
    run: async (reason) => { await api(`leads/${l.id}/reject`, { body: { reason } }); toast("Rejected"); },
  });
  const changes = $("#changes");
  if (changes) changes.onclick = () => confirmDialog({
    title: "Request changes", text: "The Builder agent will revise the site using your note, re-run its honesty check, and send it back for review.", ok: "Send to Builder", field: "What should change?", required: true,
    run: async (feedback) => { await api(`leads/${l.id}/rebuild`, { body: { feedback } }); state.tab = "trace"; toast("Sent to the Builder"); },
  });
  const retry = $("#retry");
  if (retry) retry.onclick = async () => { await api(`leads/${l.id}/retry`, { body: {} }); state.tab = "trace"; toast("Agents started"); load(); };
  $("#detail").querySelectorAll("[data-outcome]").forEach((b) => (b.onclick = async () => { await api(`leads/${l.id}/outcome`, { body: { outcome: b.dataset.outcome } }); toast(b.dataset.outcome === "won" ? "Marked won" : "Marked closed"); load(); }));
}

function confirmDialog({ title, text, ok, field, required, run }) {
  const d = $("#dlg");
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p>
    ${field ? `<div class="field"><label for="dlgf">${esc(field)}</label><textarea id="dlgf" style="min-height:110px" ${required ? "required" : ""}></textarea></div>` : ""}
    <div class="row-btns"><button class="btn quiet" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(ok)}</button></div></form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try { await run($("#dlgf", d)?.value || ""); } catch (e) { toast(e.message); }
    load();
  };
}

// ---------------- automations ----------------
function renderAutomations() {
  const s = state.status;
  $("#main").innerHTML = `<div class="auto">
    <div>
      <h2>Automations</h2>
      <div class="flows">
        <div class="flow"><h3>Daily intake</h3><p>Every morning at 7:00 Mountain time: fetch new state filings, filter out shells and holding companies, dedupe, send the best ${s.config.scoutBatch} to the agents, then notify you.</p><button class="btn" id="run-intake">Run now</button></div>
        <div class="flow"><h3>Approval</h3><p>When you approve a lead: publish its site, send or queue the outreach, schedule a follow-up in ${s.config.followupDays} days, notify you.</p></div>
        <div class="flow"><h3>Follow-up check</h3><p>Daily: find contacted leads past their follow-up date, flag them, and notify you.</p><button class="btn" id="run-fu">Run now</button></div>
      </div>
      <h2>Recent runs</h2>
      ${s.runs.map((r) => `<article class="run">
        <header><h3>${esc(r.type)}</h3><span class="pill ${r.status === "error" ? "error" : r.status === "running" ? "working" : "published"}">${esc(r.status)}</span><span class="when">${esc(r.trigger)} · ${timeAgo(r.startedAt)}</span></header>
        <ol>${(r.steps || []).map((x) => `<li>${esc(x.step)} <span>${esc(x.detail || "")}</span></li>`).join("")}</ol>
        ${r.error ? `<p class="err">${esc(r.error)}</p>` : ""}
        ${r.scoutSummary ? `<p><b>Scout:</b> ${esc(r.scoutSummary)}</p>` : ""}
        ${r.traceCount ? `<details data-run="${esc(r.id)}"><summary>Scout agent trace (${r.traceCount} steps)</summary><div class="rt">Loading…</div></details>` : ""}
      </article>`).join("") || `<p class="empty">No runs yet.</p>`}
    </div>
    <div>
      <h2>Notifications</h2>
      <p class="sub" style="color:var(--muted);margin:-6px 0 12px">${(() => { const ch = [s.config.notifications.email && "email", s.config.notifications.webhook && "Slack/Discord"].filter(Boolean); return ch.length ? `Also delivered by ${ch.join(" and ")}.` : "Shown here only. Set RESEND_API_KEY + OPERATOR_EMAIL or NOTIFY_WEBHOOK_URL to also get them by email or Slack."; })()}</p>
      <ul class="feed">${s.activity.map((a) => `<li><time>${timeAgo(a.at)}</time><b>${esc(a.title)}</b>${a.text ? `<p>${esc(a.text)}</p>` : ""}</li>`).join("") || "<li>No notifications yet.</li>"}</ul>
    </div>
  </div>`;
  $("#run-intake").onclick = pull;
  $("#run-fu").onclick = async () => { await api("followups", { body: {} }); toast("Follow-up check finished"); load(); };
  document.querySelectorAll("details[data-run]").forEach((d) => d.addEventListener("toggle", async () => {
    if (!d.open) return;
    const run = await api(`runs/${d.dataset.run}`);
    $(".rt", d).innerHTML = `<ol class="trace">${(run.trace || []).map((t) => `<li class="${esc(t.kind)}"><span class="who ${esc(t.agent)}">${esc(t.agent)}</span><span class="what"><span class="k">${esc(KIND[t.kind] || t.kind)}${t.tool ? ` ${esc(t.tool)}` : ""}</span>${esc(t.text || "")}</span></li>`).join("")}</ol>`;
  }));
}

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------- boot ----------------
if (state.key) load().catch(() => renderLogin()); else renderLogin();
