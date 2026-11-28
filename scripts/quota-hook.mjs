import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { autoRoute, DIVERSION_PREFIX, recordDiversion } from "./lib/delegation-route.mjs";
import { classifyQuotaError, readAllQuota, recordCooldown } from "./lib/quota-state.mjs";

export function handlePreInvocation(payload = {}, options = {}) {
  const env = options.env ?? process.env;
  const input = typeof payload.lastUserInput === "string" ? payload.lastUserInput.trim() : "";
  if (env.CC_PLUGIN_AGY_ROUTE === "off" || !input || input.startsWith("/")) return {};
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const decision = autoRoute("agy", { env, nowSec, model: payload.modelName });
  if (decision.target === "agy") return {};

  const cwd = payload.workspacePaths?.[0] || process.cwd();
  const { message } = recordDiversion(cwd, "hook:PreInvocation", "agy", decision, env);
  return {
    terminationBehavior: "terminate",
    injectSteps: [{ errorMessage: { userMessage: message } }]
  };
}

export function handleStop(payload = {}, options = {}) {
  const env = options.env ?? process.env;
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const error = String(payload.error ?? "");
  if (String(payload.terminationReason).toUpperCase() === "ERROR"
    && !error.includes(DIVERSION_PREFIX) && classifyQuotaError(error)) {
    const quota = readAllQuota({ env, nowSec });
    const pool = quota.agy.activePool || "gemini";
    try {
      recordCooldown("agy", pool, { reason: error, nowSec, env });
    } catch {
      // Non-fatal
    }
  }
  return {};
}

function readStdinSync() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  const payload = readStdinSync();
  const out =
    mode === "pre-invocation"
      ? handlePreInvocation(payload)
      : mode === "stop"
        ? handleStop(payload)
        : {};
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
