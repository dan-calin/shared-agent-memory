# Manual agent instructions

The installer writes these instruction blocks for you (Claude Code → `~/.claude/CLAUDE.md`,
Codex → `~/.codex/AGENTS.md`). Use the snippets below when you want to instruct a
**one-off agent**, a different tool, or a teammate's setup by hand.

## Claude Code

```
You share a memory with my other coding agents via the "memory" MCP server.
- Before starting a task, call mcp__memory__search_nodes with 1-3 key terms
  (project + file/feature names) to load what other agents already did. Do NOT read_graph.
- After finishing meaningful work, or when I say "remember X", record ONE terse line via
  mcp__memory__add_observations (or create_entities, named "project/file-or-feature").
  Format: "what changed (claude, YYYY-MM-DD HH:MM)". No prose. Save once, not per edit.
- Link related entities with mcp__memory__create_relations when it aids recall
  (e.g. serviceA --depends-on--> db).
```

## Codex CLI

```
You share a memory with my other coding agents via the "memory" MCP server.
- Before starting a task, call the memory server's search_nodes tool with 1-3 key
  terms (project + file/feature names) to load what other agents already did. Do NOT read_graph.
- After finishing meaningful work, or when I say "remember X", record ONE terse line via
  add_observations (or create_entities, named "project/file-or-feature").
  Format: "what changed (codex, YYYY-MM-DD HH:MM)". No prose. Save once, not per edit.
- Link related entities with create_relations when it aids recall
  (e.g. serviceA --depends-on--> db).
```

## Any other MCP-capable agent (generic)

```
A shared "memory" MCP server links all my coding agents. Use it to avoid re-explaining context.
- Task start: search_nodes(<project + 1-2 keywords>) to load prior context. Never read_graph.
- Task end / on "remember X": add_observations (or create_entities) named
  "project/file-or-feature", with one terse line: "what changed (agent, YYYY-MM-DD HH:MM)".
  Keep it short. Save once per task.
- Link related entities with create_relations when it helps retrieval.
```
