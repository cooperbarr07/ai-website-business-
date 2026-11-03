// Central configuration. Everything is read from environment variables so the
// same code runs locally, on Netlify, and later for other agencies/states.

const env = (k, d = "") => {
  const v = typeof process !== "undefined" ? process.env[k] : undefined;
  return v === undefined || v === "" ? d : v;
};
const num = (k, d) => {
  const n = Number(env(k, ""));
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  get anthropicKey() { return env("ANTHROPIC_API_KEY"); },
  get model() { return env("MODEL", "claude-sonnet-5-5"); },
  get scoutModel() { return env("SCOUT_MODEL", env("MODEL", "claude-sonnet-5-5")); },
  // Mock mode runs the whole pipeline with deterministic stand-in agents.
  // It is on automatically when no API key is set, so the app never breaks.
  get mock() { return env("MOCK_LLM") === "1" || !env("ANTHROPIC_API_KEY"); },

  get adminPassword() { return env("ADMIN_PASSWORD", "changeme"); },
  get siteUrl() { return env("URL", env("SITE_URL", "http://localhost:8888")); },

  get agency() {
    return {
      name: env("AGENCY_NAME", "Day One Sites"),
      email: env("AGENCY_EMAIL", "hello@example.com"),
      address: env("AGENCY_ADDRESS", "Boulder, CO 80302"),
      sender: env("AGENCY_SENDER", "Cooper"),
    };
  },

  get operatorEmail() { return env("OPERATOR_EMAIL"); },
  get resendKey() { return env("RESEND_API_KEY"); },
  get resendFrom() { return env("RESEND_FROM", "Day One Sites <onboarding@resend.dev>"); },
  get webhookUrl() { return env("NOTIFY_WEBHOOK_URL"); },
  // "test" never emails a prospect: outreach copies go to the operator only.
  get sendMode() { return env("SEND_MODE", "test") === "live" ? "live" : "test"; },

  get scoutBatch() { return num("SCOUT_BATCH", 12); },
  get maxBuilds() { return num("MAX_BUILDS", 3); },
  get lookbackDays() { return num("LOOKBACK_DAYS", 2); },
  get followupDays() { return num("FOLLOWUP_DAYS", 5); },
  get targetCities() {
    return env("TARGET_CITIES", "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  },
};

export function publicConfig() {
  return {
    model: config.model,
    mock: config.mock,
    agency: config.agency,
    sendMode: config.sendMode,
    scoutBatch: config.scoutBatch,
    maxBuilds: config.maxBuilds,
    lookbackDays: config.lookbackDays,
    followupDays: config.followupDays,
    targetCities: config.targetCities,
    notifications: {
      email: Boolean(config.resendKey && config.operatorEmail),
      webhook: Boolean(config.webhookUrl),
    },
  };
}
