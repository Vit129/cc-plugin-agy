import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildClaudeArgs, parseClaudeJsonOutput, RECURSION_GUARD_ENV, runClaudePrompt } from "../scripts/lib/claude.mjs";
import { handlePreInvocation, handleStop } from "../scripts/quota-hook.mjs";
import { readAllQuota } from "../scripts/lib/quota-state.mjs";

test("buildClaudeArgs supports default no-persistence, persist, resume, noTools, and edit", () => {
  const args = buildClaudeArgs({});
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Grep,Glob");

  const persistArgs = buildClaudeArgs({ persist: true });
  assert.equal(persistArgs.includes("--no-session-persistence"), false);

  const resumeArgs = buildClaudeArgs({ resume: "sess-123", model: "sonnet" });
  assert.equal(resumeArgs.includes("--no-session-persistence"), false);
  assert.equal(resumeArgs[resumeArgs.indexOf("--resume") + 1], "sess-123");
  assert.equal(resumeArgs[resumeArgs.indexOf("--model") + 1], "sonnet");

  const noToolArgs = buildClaudeArgs({ noTools: true });
  assert.equal(noToolArgs[noToolArgs.indexOf("--tools") + 1], "");

  const editArgs = buildClaudeArgs({ edit: true });
  assert.equal(editArgs[editArgs.indexOf("--permission-mode") + 1], "acceptEdits");
});

test("parseClaudeJsonOutput extracts result, sessionId, and normalized usage", () => {
  const parsed = parseClaudeJsonOutput(
    JSON.stringify({
      result: "LGTM",
      is_error: false,
      session_id: "sess-abc",
      duration_ms: 1500,
      num_turns: 2,
      total_cost_usd: 0.012,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 }
    }),
    { model: "sonnet" }
  );
  assert.equal(parsed.result, "LGTM");
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sessionId, "sess-abc");
  assert.equal(parsed.usage.model, "sonnet");
  assert.equal(parsed.usage.durationSeconds, 1.5);
  assert.equal(parsed.usage.tokens.total_tokens, 170);
});

test("runClaudePrompt blocks recursive calls when CC_PLUGIN_AGY_ACTIVE=1", async () => {
  await assert.rejects(
    () => runClaudePrompt("hello", { env: { ...process.env, [RECURSION_GUARD_ENV]: "1" } }),
    /Blocked recursive/
  );
});

test("quota-hook PreInvocation nudges once when agy is low and claude has headroom, Stop records cooldown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-agy-hook-"));
  const env = { AI_QUOTA_DIR: dir };
  const now = 1_800_000_000;

  try {
    fs.writeFileSync(
      path.join(dir, "agy.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "agy",
        captured_at: now - 10,
        active_pool: "gemini",
        pools: { gemini: { "5h": { used_pct: 90, remaining_pct: 10, resets_at: now + 1000 } } }
      })
    );
    fs.writeFileSync(
      path.join(dir, "claude.json"),
      JSON.stringify({
        schema_version: 1,
        provider: "claude",
        captured_at: now - 10,
        pools: { default: { "5h": { used_pct: 20, remaining_pct: 80, resets_at: now + 1000 } } }
      })
    );

    const first = handlePreInvocation({ conversationId: "conv-1" }, { env, nowSec: now });
    assert.equal(first.injectSteps?.length, 1);
    const second = handlePreInvocation({ conversationId: "conv-1" }, { env, nowSec: now + 5 });
    assert.deepEqual(second, {});

    handleStop({ terminationReason: "ERROR", error: "429 quota exhausted" }, { env, nowSec: now + 10 });
    const quota = readAllQuota({ env, nowSec: now + 15 });
    assert.equal(quota.agy.pools.gemini["5h"].state, "exhausted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ask-claude-mcp responds to initialize and tools/list including resume and persist", async () => {
  const mcpPath = path.resolve("scripts/ask-claude-mcp.mjs");
  const child = spawn(process.execPath, [mcpPath], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => {
    out += d.toString();
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result.serverInfo.name, "cc-plugin-agy");
  const tool = lines[1].result.tools[0];
  assert.equal(tool.name, "ask_claude");
  assert.ok(tool.inputSchema.properties.resume);
  assert.ok(tool.inputSchema.properties.persist);
});
