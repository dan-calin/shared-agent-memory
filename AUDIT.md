# Code Audit — shared-agent-memory v0.4.0

Audit date: 2026-07-03 (claude / Opus 4.8). Scope: `bin/`, `lib/`, `test/`, templates.

> **Status: ALL findings below were fixed in v0.5.0 (2026-07-03).** Bugs #1–#13,
> dead code D1–D3, and improvements I1–I5 are implemented; the smoke test now
> covers each fix. This document is kept as the record of what was found and why
> each change was made.

Each finding lists **what it affects**, **why it matters**, and **why fixing it helps**.
Severity: 🔴 high · 🟡 medium · 🟢 low.

---

## Bugs

### 1. 🔴 `uninstall` leaves the coordination hook and instruction block behind
**Where:** `bin/cli.js` → `cmdUninstall()` (lines 134–153)

**What it affects:** Anyone who ran `coordination on` and later runs `uninstall`.
`cmdUninstall` removes the MCP server and the *memory* instruction block, but never
calls `coordination.removeInstructions()` or `coordination.removeClaudeHook()`.

**Why it matters:** After uninstall (especially with `--purge` or if the repo folder
is deleted), `~/.claude/settings.json` still contains a `PreToolUse` hook pointing at
`node <path>/cli.js`. If that path no longer exists, **every single Edit/Write in
Claude Code triggers a failing hook** — constant error noise, and the stale
coordination block stays in `CLAUDE.md`/`AGENTS.md` telling agents to run a command
that no longer exists (wasting tokens and causing failed shell calls every session).

**Fix:** In `cmdUninstall`, also run the three `coordination off` steps.
README promises "Remove the server + instruction blocks" — this makes that true.

---

### 2. 🔴 Two Claude Code sessions can't warn each other
**Where:** `bin/cli.js` → `cmdHook()` line 295 (`board.checkFile(..., 'claude', file)`) and `lib/board.js` → `conflictsFor()` (`if (c.agent === agent) continue;`)

**What it affects:** The primary use case of running **multiple Claude Code sessions
in parallel** (which is exactly how this project's author works). The hook hardcodes
the agent label `'claude'`, and conflict detection skips claims made by the same
label. So if Claude session A claims `lib/board.js` and Claude session B edits it,
session B gets **no warning at all** — coordination only works Claude↔Codex.

**Why it matters:** The most common overwrite scenario (two Claude sessions in the
same repo) is silently unprotected, while the feature appears to be "on".

**Fix:** Derive a per-session label, e.g. `claude-<pid>` / `claude-<session_id>`
(Claude Code hook payloads include `session_id`; the instruction block could tell
Claude to claim as `claude-$SESSION`). Then the hook passes that label so claims
from *other* Claude sessions still surface as conflicts.

---

### 3. 🔴 Hook path breaks when installed via `npx github:...`
**Where:** `bin/cli.js` → `cmdCoordination()` line 316 (`path.resolve(__dirname, 'cli.js')`), `lib/coordination.js` → `hookCommand()`

**What it affects:** Users following the README's own one-liner
(`npx github:dan-calin/shared-agent-memory install` then `coordination on`).
`__dirname` at that moment is **inside the npx cache** (`~/.npm/_npx/<hash>/...`).
That ephemeral absolute path gets written permanently into `~/.claude/settings.json`.

**Why it matters:** npx prunes/rebuilds its cache; the moment it does, the hook
command starts failing on every edit — silently in warn mode (no more warnings, user
thinks coordination still works) or loudly as hook errors.

**Fix:** When running from an npx cache path, either (a) write the hook as
`npx -y github:dan-calin/shared-agent-memory hook pre-edit` so it self-resolves, or
(b) copy a tiny standalone hook script into `~/.agent-memory/` and point the hook
there. Also prefer `process.execPath` over bare `node` so the hook works when
Claude Code isn't launched from a shell with node on PATH.

---

### 4. 🟡 `parseArgs` eats positional args that *end like* a value flag
**Where:** `bin/cli.js` → `parseArgs()` line 25

**What it affects:** Any command with positional args (`claim <files>`).
`valueFlags.has(a.slice(2))` runs **before** checking that the arg starts with `--`.
Verified live: `claim bias --as codex` parses as
`{_: ["claim","codex"], flags: {as: "--as"}}` — the file `bias` is consumed as the
`--as` flag ("bi**as**".slice(2) === "as") and its "value" becomes the literal
string `--as`. Same trap for any bare arg whose slice(2) equals `as`, `note`,
`mode`, or `memory-dir` (e.g. `denote`).

**Why it matters:** Silently corrupts claims — the claim errors out or is recorded
under the wrong agent, so coordination data can't be trusted for those names.

**Fix:** one line — `else if (a.startsWith('--') && valueFlags.has(a.slice(2)))`.

---

### 5. 🟡 `coordination on --mode block` is silently ignored
**Where:** `bin/cli.js` → `cmdCoordination()` + `lib/coordination.js` → `hookCommand()` (hardcodes `--mode warn`)

**What it affects:** The `--mode <warn|block>` option is documented in `help` and the
README ("By default the hook runs in warn mode" implies you can change it), but
`coordination on` never reads `flags.mode` — the installed hook is always
`--mode warn`. The only way to get block mode is hand-editing settings.json.

**Why it matters:** Documented option that does nothing = user believes edits are
blocked when they aren't. That's a safety-expectation mismatch.

**Fix:** `hookCommand(cliFile, flags.mode)` with validation (`warn`/`block` only),
and record which mode is installed in `coordination status`.

---

### 6. 🟡 The installed hook ignores `--memory-dir`
**Where:** `lib/coordination.js` → `hookCommand()`; `bin/cli.js` → `cmdHook()` → `resolveMemoryDir(flags)`

**What it affects:** Users running everything with a custom `--memory-dir`. Claims
land in the custom dir, but the installed hook command contains no `--memory-dir`
flag, so at edit time it checks the **default** `~/.agent-memory/activity.jsonl` —
which is empty. Result: coordination appears on, never warns.

**Fix:** When `coordination on` is run with `--memory-dir`, bake
`--memory-dir <path>` into the hook command string.

---

### 7. 🟡 Basename-only matching produces false-positive conflicts
**Where:** `lib/board.js` → `filesConflict()` (line 45–52)

**What it affects:** Any repo with common filenames. Two files "conflict" if they
merely **share a basename** — `src/index.js` vs `lib/index.js`, any two `README.md`,
`__init__.py`, `mod.rs`, `config.toml`… even across *different projects*, since the
board is global and claims store no project boundary check.

**Why it matters:** Advisory warnings only work if they're rare and meaningful.
Constant false "Heads-up" context on every `index.js` edit trains agents (and
humans) to ignore the warnings — eroding the whole feature — and injects useless
tokens into every affected edit.

**Fix:** Require at least a one-directory suffix match (`a/index.js` vs `b/index.js`
→ no conflict; `src/index.js` vs `repo/src/index.js` → conflict), and/or compare the
claim's stored `project` (cwd) with the hook's cwd. The `project` field is already
recorded (`board.js` line 74) but **never used** — see Dead code #3.

---

### 8. 🟡 Non-atomic writes to `~/.claude.json` (and the board file)
**Where:** `lib/claude.js` → `install()/uninstall()` (`fs.writeFileSync` directly), `lib/board.js` → `writeClaims()`

**What it affects:** `~/.claude.json` is Claude Code's *main* config — MCP servers,
project state, history. A crash/power-loss mid-`writeFileSync` leaves it truncated
and every Claude Code session broken until hand-repaired. The board file has a
classic read-modify-write race: two agents claiming at the same moment lose one
claim silently (no locking).

**Why it matters:** Config corruption is low-probability but very high-cost; the
whole pitch of this tool is "safe, careful integration".

**Fix:** Write to `<file>.tmp` then `fs.renameSync` (atomic on the same volume) for
all JSON/TOML config writes. Optionally keep a `.bak` of `~/.claude.json`. For the
board, atomic rename also fixes torn reads; the claim race can stay (advisory data,
2h TTL) but is worth a comment.

---

### 9. 🟢 Clobbers a pre-existing, unrelated `memory` MCP server
**Where:** `lib/claude.js` → `install()` (unconditional overwrite of `cfg.mcpServers.memory`)

**What it affects:** A user who already has a *different* server registered under the
name `memory` (e.g. mem0, a custom store). Install silently replaces it — the log
even says "memory server updated" as if that were routine.

**Fix:** Detect that the existing entry isn't `@modelcontextprotocol/server-memory`
(or has a different `MEMORY_FILE_PATH`) and warn / require `--force`.

---

### 10. 🟢 TOML breaks if the memory path contains a single quote
**Where:** `lib/codex.js` → `blockText()` — `MEMORY_FILE_PATH = '${memoryFile}'`

**What it affects:** Windows/macOS usernames like `O'Brien`. TOML literal strings
cannot contain `'`, so the generated `config.toml` is invalid and Codex fails to
load *its whole config*. Same class of issue: `quoteCommandPath()` in
coordination.js escapes `"` but cmd.exe doesn't honor `\"` the way POSIX shells do.

**Fix:** If the path contains `'`, emit a basic double-quoted TOML string with
backslashes escaped (`"C:\\Users\\O'Brien\\..."`).

---

### 11. 🟢 Marker-block regex replacement can mangle content containing `$`
**Where:** `lib/instructions.js` line 45 & `lib/coordination.js` line 45 — `content.replace(re, block)`

**What it affects:** `block` is passed as a replacement *pattern*, so `$&`, `$'`,
`` $` `` sequences in it are substituted. Today's block text contains no `$`, but a
memory dir path or future block edit containing one (e.g. `$HOME`, a PowerShell
example) would silently corrupt the user's CLAUDE.md/AGENTS.md on update.

**Fix:** `content.replace(re, () => block)` — the function form disables pattern
substitution. Two-character change, removes a latent foot-gun.

---

### 12. 🟢 `status` ignores `--memory-dir`; `mark()` ignores `NO_COLOR`
**Where:** `bin/cli.js` — `cmdStatus()` (line 159, takes no flags despite being called with them at line 417) and `mark()` (line 155, raw ANSI codes)

**What it affects:** (a) `status --memory-dir /x` reports on the default store —
misleading for custom-dir users; every other command respects the flag. (b) `mark()`
emits ANSI escapes even with `NO_COLOR=1` or non-TTY output, unlike `lib/log.js`
which gets this right — inconsistent, and pollutes piped/CI output.

**Fix:** `cmdStatus(flags)` → `resolveMemoryDir(flags)`; move `mark()` into
`lib/log.js` next to the existing `paint()` helper.

---

### 13. 🟢 Invalid `--mode` accepted silently when there's no conflict
**Where:** `bin/cli.js` → `cmdHook()` (lines 288–304)

**What it affects:** Mode validation happens *after* the early return on
no-conflicts, so `--mode blokc` (typo) passes silently for weeks until the first
real conflict — then throws instead of warning/blocking. Validate up front.

---

## Dead / unused code

### D1. Dead ternary in `main()`
`bin/cli.js` line 395: `const cmd = _[0] || (flags.help ? 'help' : 'help');` — both
branches are `'help'`. Leftover from an older shape. Replace with `_[0] || 'help'`.

### D2. Unused exports
- `lib/paths.js` → `isWindows` — only used inside `paths.js` itself.
- `lib/board.js` → `boardFile` — only used internally (the test builds the path by hand).
- `lib/coordination.js` → `BEGIN`, `END`, `HOOK_MATCHER` — never imported elsewhere (`HOOK_EVENT` *is* used by cli.js).

Not harmful, but they suggest an external API that doesn't exist; trimming keeps the
module contracts honest.

### D3. `project` field on claims is recorded but never read
`lib/board.js` line 74 stores `project: process.cwd()` with every claim; nothing
ever reads it — not conflict detection, not `board` display. Either use it (it's
the natural fix for bug #7's cross-project false positives, and would be useful in
`board` output) or drop it.

---

## Improvements (design / behavior)

### I1. A new `claim` silently drops the agent's previous claim
`board.claim()` filters out all of the agent's prior claims before writing
(comment: "replaces its previous one"). The instruction block tells agents to claim
"before editing" — an agent that claims incrementally (`claim a.js`, work, then
`claim b.js`) unknowingly releases `a.js` while still editing it.
**Suggestion:** merge files into the existing claim by default, or add `--replace` /
`--add` to make the behavior explicit. Cheap change, prevents a subtle coordination
hole in exactly the workflow the instructions encourage.

### I2. `doctor` should also check `activity.jsonl` and the Codex TOML block
`doctor` only validates `memory.json`. The board file is the same NDJSON-corruption
risk (readClaims silently drops unparseable lines — good resilience, but the user
never learns the file is damaged), and a hand-edited Codex block is a common config
failure. One command that health-checks all three artifacts makes "run doctor" the
universal answer.

### I3. Consider `process.execPath` for the hook command
`hookCommand()` emits bare `node ...`. When Claude Code is launched from a GUI
(Windows shortcut, macOS dock) PATH may not include node's location.
`process.execPath` at install time pins the exact runtime that provably exists.
(Trade-off: breaks if the user upgrades/moves node — mention in README either way.)

### I4. Test gaps worth closing (cheap, high value)
`test/smoke.js` is genuinely good, but doesn't cover:
- `parseArgs` value-flag edge (would have caught bug #4),
- `uninstall` after `coordination on` (would have caught bug #1),
- `--memory-dir` end-to-end with the hook (bug #6),
- `hook pre-edit` with malformed/empty stdin JSON.

### I5. Compact expired claims on read
`readClaims` filters expired entries in memory but only `claim`/`release` rewrite
the file — a board that's only ever *read* keeps stale lines forever. Trivial:
rewrite when expired entries were dropped. Cosmetic, keeps the NDJSON small and
diffs clean for people who git the memory dir.

---

## Suggested fix order

| Order | Items | Rationale |
|---|---|---|
| 1 | #1, #4, #11, D1 | Tiny diffs, real breakage or corruption, zero design work |
| 2 | #2, #3 | Highest-value for the multi-agent use case; needs small design decision (session labels, hook self-resolution) |
| 3 | #5, #6, #7 (+D3), #8 | Makes coordination trustworthy; medium effort |
| 4 | #9, #10, #12, #13, I1–I5 | Polish, robustness, test coverage |
