# Day One Sites: AI Website Business

**Every weekday about 700 new businesses register in Colorado. Most don't have a website yet.**
Day One Sites finds them the morning after they file. Its agents build each promising one a preview website and draft a personal pitch. Nothing goes out until a person approves it.

- **User:** the owner of a small web-design or marketing agency.
- **Problem:** finding brand-new businesses before competitors do, and making a custom pitch for each, takes hours of research and design per lead.

## How it works

```
 ┌──────────── AUTOMATION: Daily intake (schedule 7am MT, or "Pull new filings") ────────────┐
 │ 1 Fetch new filings  →  2 Rule filter  →  3 Dedupe + store  →  4 Start agents  →  5 Notify │
 └──────────────────────────────────────────────┬────────────────────────────────────────────┘
                                                ▼
   AGENT 1 Scout ─────── screens the whole batch, web-searches the promising ones,
   (batch)               qualifies/rejects every lead with a score + reason
                                                ▼  best N
   AGENT 2 Researcher ── searches for the business, infers services/customers/area,
                         separates verified facts (with sources) from inferences
                                                ▼
   AGENT 3 Builder ───── picks theme + palette, writes the site, runs the honesty
                         check, fixes what fails, re-checks, submits
                                                ▼
   AGENT 4 Outreach ──── picks email vs. mailed letter, writes it, passes a
                         CAN-SPAM compliance check
                                                ▼
                  HUMAN REVIEW (dashboard): approve · request changes · reject
                                                ▼
 ┌──────────── AUTOMATION: Approval (event: operator approves) ──────────────────────────────┐
 │ 1 Publish site at /s/<slug>  →  2 Send / queue outreach  →  3 Schedule follow-up  →  4 Notify │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
 ┌──────────── AUTOMATION: Follow-up check (daily) ──────────────────────────────────────────┐
 │ 1 Scan contacted leads  →  2 Flag ones past their date  →  3 Notify                       │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

Each agent is an LLM tool-use loop (Anthropic Messages API with server-side web search). The agent decides which tools to call and when, and finishes by calling its own "finish" tool. The tools enforce guardrails. For example, the Builder can't submit a site that claims reviews, licenses, years in business, prices, or contact details that the research didn't verify.

**Data source:** the Colorado Secretary of State's business registry, published daily as open data at [data.colorado.gov (dataset 4ykn-tg5h)](https://data.colorado.gov/Business/Colorado-Business-Entities/4ykn-tg5h). It's free and needs no API key.

## Deploy (Netlify)

1. Push this repo to GitHub, then in Netlify choose **Add new project → Import from Git** and pick the repo. The build settings come from `netlify.toml`.
2. In **Project configuration → Environment variables**, add:

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Runs the agents. Without it the app runs in **demo mode** with stand-in agents. |
| `ADMIN_PASSWORD` | yes | Password for the dashboard |
| `AGENCY_NAME`, `AGENCY_EMAIL`, `AGENCY_ADDRESS`, `AGENCY_SENDER` | yes | Appear on preview sites and outreach. The address is required by CAN-SPAM. |
| `MODEL` | no | Defaults to `claude-sonnet-5-5` |
| `OPERATOR_EMAIL` + `RESEND_API_KEY` (+ `RESEND_FROM`) | no | Email notifications to you |
| `NOTIFY_WEBHOOK_URL` | no | Slack or Discord incoming webhook for notifications |
| `SEND_MODE` | no | `test` (default) never contacts prospects. Use `live` to email prospects that have a public email. |
| `SCOUT_BATCH` / `MAX_BUILDS` / `LOOKBACK_DAYS` / `FOLLOWUP_DAYS` / `TARGET_CITIES` | no | Tuning: 12 / 3 / 2 / 5 / (all cities). Example: `TARGET_CITIES=Boulder,Longmont,Louisville` |

3. Redeploy. Open the site, sign in, and click **Pull new filings**.

## Run locally

No dependencies are needed for local development. It uses file storage in `.data/` and demo agents unless `ANTHROPIC_API_KEY` is set.

```bash
ADMIN_PASSWORD=demo npm run dev        # http://localhost:8888
FIXTURE_FILINGS=test/fixture-filings.json ADMIN_PASSWORD=demo npm run dev   # offline sample data
npm test                               # end-to-end smoke test in demo mode
```

## Project layout

```
lib/agents/        scout.mjs · researcher.mjs · builder.mjs · outreach.mjs
lib/llm.mjs        agent loop (tool use + web search + trace events)
lib/automations.mjs  intake · approval · follow-up workflows
lib/colorado.mjs   state registry client       lib/filters.mjs   rule pre-filter
lib/validate.mjs   honesty guardrails          lib/render.mjs    site renderer + 3 themes
netlify/functions/ api · pipeline-background · intake-daily · followups-daily · site
public/            operator dashboard (vanilla JS)
```

## Where a human must review

Every site and every message goes through the **Needs review** queue. Publishing and sending only happen when the operator clicks *Approve and send*. *Request changes* sends written feedback back to the Builder agent.
