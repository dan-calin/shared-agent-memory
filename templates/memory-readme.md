# Shared Agent Memory (data store)

This folder is the shared "brain" for all your AI coding agents (Claude Code,
Codex, any MCP client). They read and write the same file so what one agent
learns, the others know. Think of it as shared **episodic memory** — what your
agents learn as they work — complementing your committed docs, not replacing them.

- **Data file:** `{{MEMORY_DIR}}/memory.json` — newline-delimited JSON (NDJSON),
  one record per line; readable, diffable, git-able
- **Server:** `@modelcontextprotocol/server-memory` (launched on demand by each agent; no daemon)

## Data model (keep it tiny)

- **Entity** — a thing you work on. Name it `project/file-or-feature`
  (e.g. `tradebot/billing.py`, `tradebot/auth`) so multiple projects sharing
  this one store don't bleed together.
- **Observation** — one short fact attached to an entity:
  `"retry -> exponential backoff (codex, 2026-07-01 14:32)"`.
- **Relation** — a link between entities: `tradebot/auth --depends-on--> tradebot/db`.
  Worth recording — it makes retrieval relationship-aware, not just keyword search.

Searches stay predictable only if entities are named consistently.

## What agents do

1. **Task start** — `search_nodes("tradebot billing")` to load relevant facts.
   Never `read_graph` (it dumps everything = expensive).
2. **Task end, or on "remember X"** — save one terse line via `add_observations`
   (or `create_entities`, named `project/file-or-feature`). Link related entities
   with `create_relations` when it helps future recall.

## Token-efficiency rules

- Search with **1-3 keywords**, one search per task.
- Prefix entities with the **project** so a search returns only that project's facts.
- **Never `read_graph`** unless auditing the whole store.
- Observations are **one line**: `what changed (agent, YYYY-MM-DD HH:MM)`
  (the entity name already says which file/feature). No prose.
- Save **once** per unit of work, not per edit. Don't create duplicate entities.

## Maintenance

- **Inspect:** open `memory.json`, or ask any agent to `read_graph` once.
- **Format:** it is **NDJSON — one JSON object per line.** If you hand-edit, keep
  that shape; do **not** pretty-print it, or the server will fail to load it.
- **Broken?** If the server throws a JSON parse error, run
  `shared-agent-memory doctor` — it detects a pretty-printed file and rewrites it
  as NDJSON (backing up the original first).
- **Reset:** delete `memory.json` (it is recreated empty).
- **Version / roll back:** put this folder under git for full history and easy
  rollback if an agent writes something wrong.

## Connecting another tool

Point its MCP config at the same command + file:

```
command: npx -y @modelcontextprotocol/server-memory
env:     MEMORY_FILE_PATH = {{MEMORY_DIR}}/memory.json
```

Same file = same shared brain.
