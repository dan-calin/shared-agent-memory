# Shared Agent Memory (data store)

This folder is the shared "brain" for all your AI coding agents (Claude Code,
Codex, any MCP client). They read and write the same file so what one agent
learns, the others know.

- **Data file:** `{{MEMORY_DIR}}/memory.json`
- **Server:** `@modelcontextprotocol/server-memory` (run automatically by each agent)

## Data model (keep it tiny)

- **Entity** — a thing you work on. Name it after a **file or feature**:
  `billing.py`, `auth`, `deploy`.
- **Observation** — one short fact attached to an entity:
  `"retry -> exponential backoff (codex, 2026-07-01 14:32)"`.
- **Relation** (optional) — a link between entities: `auth --uses--> billing.py`.

Searches stay predictable only if entities are named consistently.

## What agents do

1. **Task start** — `search_nodes("billing")` to load relevant facts.
   Never `read_graph` (it dumps everything = expensive).
2. **Task end, or on "remember X"** — save one terse line via
   `add_observations` (or `create_entities` for a new file/feature).

## Token-efficiency rules

- Search with **1-3 keywords**, one search per task.
- **Never `read_graph`** unless auditing the whole store.
- Observations are **one line**: `file: what changed (agent, YYYY-MM-DD HH:MM)`. No prose.
- Save **once** per unit of work, not per edit. Don't create duplicate entities.

## Maintenance

- **Inspect:** open `memory.json`, or ask any agent to `read_graph` once.
- **Reset:** delete `memory.json` (it is recreated empty).
- **Back up / history:** it is just JSON — copy it, or put this folder under git.

## Connecting another tool

Point its MCP config at the same command + file:

```
command: npx -y @modelcontextprotocol/server-memory
env:     MEMORY_FILE_PATH = {{MEMORY_DIR}}/memory.json
```

Same file = same shared brain.
