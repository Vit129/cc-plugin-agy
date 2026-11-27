import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { classifyQuotaError, readAllQuota, recordCooldown, resolveQuotaDir } from "./lib/quota-state.mjs";

const LOW_HEADROOM_PCT = 15;
const CLAUDE_MIN_HEADROOM_PCT = 20;

export function handlePreInvocation(payload = {}, options = {}) {
  const env = options.env ?? process.env;
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const quota = readAllQuota({ env, nowSec });

  const agyPool = quota.agy.activePool || "gemini";
  const agy5h = quota.agy.pools[agyPool]?.["5h"]?.effectiveRemainingPct;
  const claude5h = quota.claude.pools.default["5h"]?.effectiveRemainingPct;

  if (
    typeof agy5h === "number" &&
    agy5h < LOW_HEADROOM_PCT &&
    (claude5h === null || claude5h >= CLAUDE_MIN_HEADROOM_PCT)
  ) {
    // Nudge at most once per conversation
    const convId = String(payload.conversationId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    const markerDir = path.join(resolveQuotaDir(env), "nudged");
    const markerFile = path.join(markerDir, `${convId}.flag`);
    if (fs.existsSync(markerFile)) {
      return {};
    }
    try {
      fs.mkdirSync(markerDir, { recursive: true });
      fs.writeFileSync(markerFile, `${nowSec}\n`, "utf8");
    } catch {
      // Non-fatal
    }
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `Note: agy (${agyPool}) 5h quota is low (${agy5h}% remaining) while Claude has headroom (${claude5h ?? "unknown"}% remaining). Consider delegating cold reviews or bounded sub-tasks to Claude via ask_claude.`
          }
        }
      ]
    };
  }

  return {};
}

export function handleStop(payload = {}, options = {}) {
  const env = options.env ?? process.env;
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (payload.terminationReason === "ERROR" && classifyQuotaError(payload.error || "")) {
    const quota = readAllQuota({ env, nowSec });
    const pool = quota.agy.activePool || "gemini";
    try {
      recordCooldown("agy", pool, { reason: payload.error, nowSec, env });
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
