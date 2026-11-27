# cc-plugin-agy

Antigravity (`agy`) native plugin (`v0.3.0`) for symmetric delegation, cold/adversarial code review, test-verified handoff, session transfer, background jobs, and shared 5h/7d quota-aware routing with Claude Code CLI (`claude -p`).

## Features

- **`ask_claude` MCP tool** (`mcp_config.json` + `scripts/ask-claude-mcp.mjs`): zero-dependency stdio MCP server calling `claude -p --output-format json --strict-mcp-config` via stdin, with multi-turn `persist` / `resume` (`session_id`) and `usage.jsonl` logging.
- **Read-only by default:** defaults to `Read,Grep,Glob` (or `--no-tools` for diff-only reviews). Requires explicit `edit: true` / `--edit` to modify files.
- **Reviews (`review`, `adversarial-review`):** supports `--staged`, `--base <ref>`, `--deep`, and `--background`.
- **Test-Verified Handoff (`handoff`):** refuses `main`/`master` and dirty trees, hashes `--tests` with SHA-256 to detect test tampering, runs `--verify` + `--fixups N` via `--resume`.
- **Interactive Transfer (`transfer`):** writes `.tmp/claude-transfer-<ts>.md` and prints a ready-to-run `claude` command.
- **Background Jobs & Usage Ledger:** `status`, `result`, `cancel`, and `usage.jsonl` per workspace (`$PLUGIN_DATA`).
- **Loop guard:** sets `CC_PLUGIN_AGY_ACTIVE=1` to block recursive `agy -> claude -> agy` calls.
- **Shared Quota Hooks (`hooks.json`):** `PreInvocation` nudge when `agy` 5h quota < 15% and `Stop` reactive cooldown writer.

## Validate & Install

```bash
npm test
agy plugin validate . --strict
agy plugin install .
```

## Contributors

Developed and maintained by **Vit129** and **Antigravity** (Google).
