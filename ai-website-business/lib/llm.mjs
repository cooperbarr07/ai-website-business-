// Minimal agent runtime on the Anthropic Messages API (no SDK needed).
//
// An agent = system prompt + task + tools. The model decides which tools to
// call and in what order; we execute client tools, feed results back, and stop
// when the agent calls its "finish" tool. Web search runs server-side at
// Anthropic. Every decision is streamed to `onEvent` so the dashboard can show
// the agent's trace.

import { config } from "./config.mjs";

const API = "https://api.anthropic.com/v1/messages";

async function callClaude(body, attempt = 0) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return callClaude(body, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

/**
 * @param {object} o
 * @param {string} o.name            agent name for the trace
 * @param {string} o.system          system prompt
 * @param {string} o.task            the task / input for this run
 * @param {Array}  o.tools           [{name, description, input_schema, handler, finish?}]
 * @param {number} [o.webSearches]   max web searches (0 = no web search)
 * @param {object} [o.location]      approximate user location for search
 * @param {number} [o.maxTurns]
 * @param {Function} [o.onEvent]
 */
export async function runAgent(o) {
  const {
    name, system, task, tools, webSearches = 0, location,
    maxTurns = 14, maxTokens = 4096, model = config.model, onEvent = () => {},
  } = o;

  const apiTools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  if (webSearches > 0) {
    apiTools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: webSearches,
      ...(location ? { user_location: { type: "approximate", ...location } } : {}),
    });
  }

  const messages = [{ role: "user", content: task }];
  let finished = null;
  let nudged = false;
  const usage = { input: 0, output: 0, searches: 0 };

  for (let turn = 0; turn < maxTurns && !finished; turn++) {
    const resp = await callClaude({ model, max_tokens: maxTokens, system, tools: apiTools, messages });
    usage.input += resp.usage?.input_tokens || 0;
    usage.output += resp.usage?.output_tokens || 0;
    usage.searches += resp.usage?.server_tool_use?.web_search_requests || 0;
    messages.push({ role: "assistant", content: resp.content });

    // Record reasoning text and server-side searches for the trace.
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        await onEvent({ agent: name, kind: "thought", text: block.text.trim().slice(0, 1200) });
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        await onEvent({ agent: name, kind: "search", text: block.input?.query || "" });
      } else if (block.type === "web_search_tool_result") {
        const results = Array.isArray(block.content) ? block.content : [];
        await onEvent({
          agent: name, kind: "search_results",
          text: results.slice(0, 5).map((r) => r.url).join("\n") || "(no results)",
        });
      }
    }

    if (resp.stop_reason === "pause_turn") continue; // long search turn; resume

    const calls = resp.content.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      if (nudged) break;
      nudged = true;
      const finishTool = tools.find((t) => t.finish)?.name;
      messages.push({ role: "user", content: `You have not finished. Call the ${finishTool} tool to complete the task.` });
      continue;
    }

    const results = [];
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      let out, isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${call.name}`);
        await onEvent({ agent: name, kind: "tool", tool: call.name, text: summarizeInput(call.input) });
        out = await tool.handler(call.input);
        if (out && out.error) isError = true;
        if (tool.finish && !isError) finished = { tool: call.name, input: call.input, output: out };
      } catch (err) {
        isError = true;
        out = { error: err.message };
      }
      if (isError) await onEvent({ agent: name, kind: "rejected", tool: call.name, text: JSON.stringify(out).slice(0, 600) });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: typeof out === "string" ? out : JSON.stringify(out),
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  await onEvent({ agent: name, kind: "usage", text: `${usage.input} in / ${usage.output} out tokens, ${usage.searches} searches` });
  if (!finished) throw new Error(`${name} stopped without finishing`);
  return { ...finished, usage };
}

function summarizeInput(input) {
  const s = JSON.stringify(input);
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

/** Parse loose JSON safely (used by validators). */
export function asArray(x) { return Array.isArray(x) ? x : x ? [x] : []; }
