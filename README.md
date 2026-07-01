# shared-agent-memory

**One shared memory for all your AI coding agents.** Claude Code sessions, Codex,
and any MCP-capable tool read and write the same knowledge graph — so what one
agent learns, the others know. No more "write a handoff `.md` and make the next
agent read the whole thing."

```
            ~/.agent-memory/memory.json   ← one shared brain
                   ▲          ▲
            memory MCP server (one per tool)
                   ▲          ▲
             Claude Code     Codex     (+ any MCP client)
```

It's a thin, careful **integration layer** on top of the official
[`@modelcontextprotocol/server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory).
That server does the storage; this project wires every agent to the *same* store
and adds tiny, token-efficient instructions so they actually use it well.

## Why

If you run multiple agents, you've felt this: each one starts blind, so you
hand-write context files and paste them around. This replaces that with a shared,
*searchable* memory. Agents look up the few facts they need (`search_nodes`)
instead of re-reading a growing document — which keeps it fast and cheap even
after months of use.

## Install

You don't need to publish anything — it runs straight from GitHub.

```bash
# one-liner
npx github:dan-calin/shared-agent-memory install

# or clone and run
git clone https://github.com/dan-calin/shared-agent-memory
cd shared-agent-memory
node bin/cli.js install
```

The installer **auto-detects** which agents you have and, for each one:

- registers the shared `memory` MCP server,
- points it at one shared file (`~/.agent-memory/memory.json`),
- adds a ~6-line instruction block so the agent knows to use it.

Then **restart your agents** (they read MCP config + instructions at startup).

## Usage

Mostly you do nothing — agents use the memory automatically:

- **Task start** → they `search_nodes` for relevant prior context.
- **Task end** → they save a one-line note about what changed.

You step in only to:

- **Force a save:** *"remember that we're using Postgres, not SQLite."*
- **Ask what's known:** *"what do you know about the billing module?"*

### Example: the handoff

1. Codex refactors your payment retry logic and saves
   `billing.py: retry → exponential backoff (codex, 2026-07-01 14:32)`.
2. Tomorrow, a fresh **Claude Code** session is asked to extend billing. It
   searches memory first, sees Codex's note, and builds on it — no re-explaining.

## Commands

```
shared-agent-memory install      Configure detected agents to share memory
shared-agent-memory status       Show what is currently configured
shared-agent-memory uninstall    Remove the server + instruction blocks
shared-agent-memory help         Full help
```

Options: `--claude-only`, `--codex-only`, `--memory-dir <path>`, `--dry-run`,
and `--purge` (uninstall: also delete the memory store).

## How it works

- **Storage:** `@modelcontextprotocol/server-memory`, a knowledge graph of
  *entities* (a file or feature) with short *observations* attached.
- **Sharing:** every agent's MCP config launches that server with the same
  `MEMORY_FILE_PATH`, so they all read/write one JSON file.
- **Discipline:** the installed instructions enforce token efficiency — search
  with a few keywords (never dump the whole graph), and save one terse line per
  unit of work.

See [`templates/memory-readme.md`](templates/memory-readme.md) for the data model
and [`examples/manual-agent-instructions.md`](examples/manual-agent-instructions.md)
for copy-paste snippets to wire up other tools by hand.

## Supported agents

| Agent | Config written |
| --- | --- |
| Claude Code | `~/.claude.json` (MCP server) + `~/.claude/CLAUDE.md` (instructions) |
| Codex CLI | `~/.codex/config.toml` (MCP server) + `~/.codex/AGENTS.md` (instructions) |
| Anything else | Point its MCP config at the same `MEMORY_FILE_PATH` (see examples) |

Want another agent supported out of the box? PRs welcome — add a module under
`lib/` mirroring `lib/claude.js`.

## Uninstall

```bash
shared-agent-memory uninstall          # remove server + instructions, keep memory
shared-agent-memory uninstall --purge  # also delete ~/.agent-memory
```

## FAQ

**Is my memory sent anywhere?** No. It's a local JSON file. Nothing leaves your
machine unless you sync that file yourself.

**Does the auto-save always fire?** It's instruction-driven (the agent decides),
so it's reliable but not guaranteed. The manual *"remember X"* command is the
always-there backstop.

**Windows?** Yes — Windows, macOS, and Linux. On Windows the server is launched
via `cmd /c npx` automatically.

## Credits

Built on the official
[`@modelcontextprotocol/server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory).
This project just makes it shared across agents and easy to install.

## License

[MIT](LICENSE)
