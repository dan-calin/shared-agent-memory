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

Think of it as the shared **episodic memory** layer for your agents — what they
learn as they work — complementing your committed docs and code, not replacing them.

## Why

If you run multiple agents, you've felt this: each one starts blind, so you
hand-write context files and paste them around. This replaces that with a shared,
*searchable* memory. Agents look up the few facts they need (`search_nodes`)
instead of re-reading a growing document — which keeps it fast and cheap even
after months of use.

## Install

**Requires Node 18+** (the same runtime your agents already use for `npx`).

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
- adds a tiny instruction block so the agent knows to use it.

Then **restart your agents** (they read MCP config + instructions at startup).

## Usage

Mostly you do nothing — agents use the memory automatically:

- **Task start** → they `search_nodes` for relevant prior context.
- **Task end** → they save a one-line note about what changed.

You step in only to:

- **Force a save:** *"remember that we're using Postgres, not SQLite."*
- **Ask what's known:** *"what do you know about the billing module?"*

### Example: the handoff

1. Codex refactors your payment retry logic and saves — under entity
   `tradebot/billing.py` — the note `retry → exponential backoff (codex, 2026-07-01 14:32)`.
2. Tomorrow, a fresh **Claude Code** session is asked to extend billing. It
   searches memory first, sees Codex's note, and builds on it — no re-explaining.

## Commands

```
shared-agent-memory install       Configure detected agents to share memory
shared-agent-memory instructions  Print the instruction block(s) to paste in yourself
shared-agent-memory coordination  Turn optional edit coordination on/off/status
shared-agent-memory claim         Claim files on the shared coordination board
shared-agent-memory release       Release this agent's active coordination claim
shared-agent-memory board         Show active coordination claims
shared-agent-memory doctor        Check / repair the memory file's format
shared-agent-memory status        Show what is currently configured
shared-agent-memory uninstall     Remove the server + instruction blocks
shared-agent-memory help          Full help
```

Options: `--claude-only`, `--codex-only`, `--manual`, `--memory-dir <path>`,
`--as <agent>`, `--note <text>`, `--mode <warn|block>`, `--dry-run`, and
`--purge` (uninstall: also delete the memory store).

## Optional edit coordination

Shared memory handles durable knowledge. Edit coordination is a separate opt-in
layer for moments when you run multiple agents in the same repo and want a
lightweight heads-up before they touch the same files.

```bash
shared-agent-memory coordination on
shared-agent-memory claim lib/board.js bin/cli.js --as codex --note "wire CLI"
shared-agent-memory board
shared-agent-memory release --as codex
```

`coordination on` adds a separate marker-wrapped instruction block to
`~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, so the normal memory instructions
stay small. The block tells Claude to claim files as `claude` and Codex to claim
files as `codex`.

It also installs an idempotent Claude Code `PreToolUse` hook in
`~/.claude/settings.json` for `Edit|Write|MultiEdit`:

```bash
node <absolute path to bin/cli.js> hook pre-edit --mode warn
```

The hook reads Claude's pre-edit JSON from stdin, checks the shared board, and
adds warning context when another agent has an active claim on the same path.
Warnings are advisory by default; they do not block edits. Existing Claude hooks
are preserved, and `coordination off` removes only this project's hook and
coordination instruction block.

### Where the instructions go (and how to keep control)

By default, `install` writes a **marker-wrapped** block into your **global**
instruction files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`). It only ever adds
or updates *its own* block — the rest of those files is never touched, so your
personal instructions are safe.

Prefer to place them yourself? Two options:

- **`install --manual`** — configures the MCP server but **prints** the block
  instead of writing it, so you can paste it wherever you like.
- **`instructions`** — reprints the block(s) any time, with placement guidance.

Paste the block into a **global** file (applies to every project) or a
**project-scoped** `CLAUDE.md` / `AGENTS.md` (applies to just that repo).

## How it works

- **Storage:** `@modelcontextprotocol/server-memory`, a knowledge graph of
  *entities* (named `project/file-or-feature`) with short *observations*, plus
  *relations* between them (`serviceA --depends-on--> db`) so recall is
  relationship-aware, not just keyword matching.
- **Sharing:** every agent's MCP config launches that server with the same
  `MEMORY_FILE_PATH`, so they all read/write one plain JSON file.
- **Discipline:** the installed instructions enforce token efficiency — search
  with a few keywords (never dump the whole graph), scope entities by project so
  searches stay relevant, and save one terse line per unit of work.

See [`templates/memory-readme.md`](templates/memory-readme.md) for the data model
and [`examples/manual-agent-instructions.md`](examples/manual-agent-instructions.md)
for copy-paste snippets to wire up other tools by hand.

## Why a server instead of plain files?

A fair question — some teams keep memory as plain files grepped at session start
and argue a "memory service" is a fragile dependency. This project splits the
difference:

- **Under the hood it *is* a plain file.** `~/.agent-memory/memory.json` is
  human-readable, diffable, and git-able (NDJSON — one record per line). Even if
  the server never ran you could `cat`, grep, or carefully hand-edit it. If a hand
  edit ever breaks the format, `shared-agent-memory doctor` repairs it.
- **The "server" is not a daemon.** Each agent launches
  `@modelcontextprotocol/server-memory` on demand via `npx`, and it exits with the
  session — nothing to keep running, monitor, or deploy.
- **What you gain over grep:** a structured query interface (`search_nodes`) and
  real relations (`A --depends-on--> B`) that every MCP-speaking tool understands,
  instead of each tool inventing its own file format.
- **Honest cost:** it needs Node, and the first run does an `npx` fetch. On a
  locked-down or offline CI box, read the JSON file directly instead.

## Versioning & governance

Because the store is a single JSON file, you get history and rollback for free:
put `~/.agent-memory/` under git. If an agent writes something wrong, `git revert`
it. Diffs show exactly what each agent learned and when.

## Design goals & non-goals

**Goals:** cross-tool, local, own-your-data, zero standing infrastructure, and
token-efficient by construction.

**Non-goals (by design):**

- **No auto-ingestion** of external sources (Drive, APIs, tickets). Agents record
  what they learn; this isn't a crawler.
- **No belief modeling** — confidence scores, decay, or contradiction resolution.
  Entries are facts you can prune manually. (Possible future work; see roadmap.)
- **No hosted service or team RBAC.** For managed, multi-tenant memory, see the
  alternatives below.

## Alternatives

If your needs outgrow a shared file, heavier memory platforms exist —
[Mem0](https://mem0.ai), [Zep](https://www.getzep.com), and
[Cognee](https://www.cognee.ai) offer hosted stores, scoping, and decay;
[engram](https://github.com/Harshitk-cp/engram) is an open-source "memory as
beliefs" HTTP service. `shared-agent-memory` deliberately stays at the opposite
end: no infra, one file, works across Claude Code and Codex today.

## Roadmap

- Optional pruning / staleness helpers (a `prune` command).
- More agents out of the box (Cursor, Windsurf, …).
- Optional per-project memory stores as a first-class flag.

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

**Does it keep separate projects apart?** One shared store holds everything;
projects are separated by **naming** — entities are `project/file-or-feature`, and
searching by the project name (e.g. `miko`) returns only that project's facts.
Generic terms (e.g. `auth`) can span projects — the trade-off that keeps
cross-project knowledge available when you want it.

**Does the auto-save always fire?** It's instruction-driven (the agent decides),
so it's reliable but not guaranteed. The manual *"remember X"* command is the
always-there backstop.

**Windows?** Yes — Windows, macOS, and Linux. On Windows the server is launched
via `cmd /c npx` automatically.

**Memory server throwing JSON parse errors?** The store is NDJSON (one object per
line); something wrote it pretty-printed. Run `shared-agent-memory doctor` to
repair it — it backs up the original first.

## Credits

Built on the official
[`@modelcontextprotocol/server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory).
This project just makes it shared across agents and easy to install.

## License

[MIT](LICENSE)
