#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const log = require('../lib/log');
const claude = require('../lib/claude');
const codex = require('../lib/codex');
const instructions = require('../lib/instructions');
const store = require('../lib/store');
const fsx = require('../lib/fsx');
const board = require('../lib/board');
const coordination = require('../lib/coordination');
const project = require('../lib/project');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  const valueFlags = new Set(['memory-dir', 'as', 'note', 'mode', 'session', 'agents']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const key = a.slice(2, eq);
      const value = a.slice(eq + 1);
      out.flags[key === 'memory-dir' ? 'memoryDir' : key] = value;
    } else if (a.startsWith('--') && valueFlags.has(a.slice(2))) {
      const key = a.slice(2);
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      out.flags[key === 'memory-dir' ? 'memoryDir' : key] = argv[++i];
    } else if (a.startsWith('--')) {
      out.flags[a.slice(2)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function resolveMemoryDir(flags) {
  return flags.memoryDir ? path.resolve(flags.memoryDir) : paths.defaultMemoryDir();
}

function resolveActiveMemoryDir(flags, cwd) {
  if (flags.memoryDir) return path.resolve(flags.memoryDir);
  return project.findMemoryDir(cwd || process.cwd()) || paths.defaultMemoryDir();
}

function selectTargets(flags) {
  if (flags['claude-only']) return ['claude'];
  if (flags['codex-only']) return ['codex'];
  const t = [];
  if (claude.detect()) t.push('claude');
  if (codex.detect()) t.push('codex');
  return t;
}

const PLACEMENT = {
  claude: { label: 'Claude Code', global: '~/.claude/CLAUDE.md', project: '<project>/CLAUDE.md', agentLabel: 'claude' },
  codex: { label: 'Codex', global: '~/.codex/AGENTS.md', project: '<project>/AGENTS.md', agentLabel: 'codex' },
};

// Print the instruction block(s) plus where-to-paste guidance, for users who
// want to place them by hand instead of letting the installer write the files.
function printInstructions(targets, memoryDir) {
  const list = targets && targets.length ? targets : ['claude', 'codex'];
  log.info('Paste the matching block into ONE file, then restart that agent:');
  log.plain('');
  for (const t of list) {
    const g = PLACEMENT[t];
    if (!g) continue;
    log.plain(`  ${g.label}`);
    log.plain(`    - Global  (every project):  ${g.global}`);
    log.plain(`    - Project (this repo only): ${g.project}`);
    log.plain('');
    log.plain(`  --- copy into a ${g.label} file -----------------------------`);
    log.plain(instructions.blockFor(g.agentLabel, memoryDir));
    log.plain(`  -------------------------------------------------------------`);
    log.plain('');
  }
  log.info('The block is marker-wrapped, so you (or a future run) can update or remove');
  log.info('just that section without touching the rest of your file.');
}

function cmdInstall(flags) {
  const dry = Boolean(flags['dry-run']);
  const manual = Boolean(flags.manual);
  const memoryDir = resolveMemoryDir(flags);
  const memoryFile = paths.memoryFile(memoryDir);

  log.title('Installing shared-agent-memory' + (dry ? ' (dry run)' : ''));

  if (!dry) {
    fs.mkdirSync(memoryDir, { recursive: true });
    if (!fs.existsSync(memoryFile)) fs.writeFileSync(memoryFile, '');
  }
  instructions.writeMemoryReadme(memoryDir, dry);
  log.step(`Shared memory file: ${memoryFile}`);

  const targets = selectTargets(flags);
  if (targets.length === 0) {
    log.warn('No supported agents detected (looked for Claude Code and Codex).');
    log.info('Install one of them, or force with --claude-only / --codex-only.');
    return;
  }

  for (const t of targets) {
    if (t === 'claude') {
      const r = claude.install({ memoryFile, dry });
      log.step(`Claude Code: ${r.serverMsg}`);
      if (!manual) {
        const ir = instructions.installInto(paths.claudeInstructionsFile(), 'claude', memoryDir, dry);
        log.step(`Claude Code instructions: ${ir} (${paths.claudeInstructionsFile()})`);
      }
    } else if (t === 'codex') {
      const r = codex.install({ memoryFile, dry });
      log.step(`Codex: ${r.serverMsg}`);
      if (!manual) {
        const ir = instructions.installInto(paths.codexInstructionsFile(), 'codex', memoryDir, dry);
        log.step(`Codex instructions: ${ir} (${paths.codexInstructionsFile()})`);
      }
    }
  }

  log.done();
  if (manual) {
    log.info('MCP server configured. Instruction blocks were NOT written to any file —');
    log.info('copy the one(s) below into the .md of your choice:');
    log.plain('');
    printInstructions(targets, memoryDir);
  } else {
    log.info('Instructions were written to your global CLAUDE.md / AGENTS.md — only our');
    log.info('marker-wrapped block; the rest of those files is left untouched.');
    log.info('Want to place them yourself (e.g. a project-scoped CLAUDE.md)? Re-run with');
    log.info('--manual, or run:  shared-agent-memory instructions');
  }
  log.info('Then restart your agents so they load the new server + instructions.');
  if (dry) log.warn('Dry run — nothing was written.');
}

function cmdUninstall(flags) {
  const dry = Boolean(flags['dry-run']);
  log.title('Uninstalling shared-agent-memory' + (dry ? ' (dry run)' : ''));

  log.step(`Claude Code: ${claude.uninstall({ dry }).msg}`);
  log.step(`Claude Code instructions: ${instructions.removeFrom(paths.claudeInstructionsFile(), dry)}`);
  log.step(`Codex: ${codex.uninstall({ dry }).msg}`);
  log.step(`Codex instructions: ${instructions.removeFrom(paths.codexInstructionsFile(), dry)}`);

  // Also tear down coordination if it was on — a leftover PreToolUse hook
  // pointing at a deleted CLI would fail on every edit in Claude Code.
  log.step(`Coordination instructions (Claude): ${coordination.removeInstructions(paths.claudeInstructionsFile(), dry)}`);
  log.step(`Coordination instructions (Codex): ${coordination.removeInstructions(paths.codexInstructionsFile(), dry)}`);
  log.step(`Coordination hook (Claude): ${coordination.removeClaudeHook(paths.claudeSettingsFile(), dry)}`);

  const memoryDir = resolveMemoryDir(flags);
  if (flags.purge) {
    if (!dry) fs.rmSync(memoryDir, { recursive: true, force: true });
    log.step(`Removed memory store: ${memoryDir}`);
  } else {
    log.info(`Left memory store intact: ${memoryDir}  (add --purge to delete it)`);
  }

  log.done();
  log.info('Restart your agents so they drop the server + instructions.');
}

function cmdStatus(flags) {
  log.title('shared-agent-memory status');

  const memoryDir = resolveActiveMemoryDir(flags);
  const memoryFile = paths.memoryFile(memoryDir);
  const scope = project.findMemoryDir(process.cwd()) === memoryDir ? 'project' : 'global';
  log.info(`Active scope: ${scope.toUpperCase()}`);
  log.info(`Memory store: ${memoryDir}`);
  log.info(`Memory file:  ${fs.existsSync(memoryFile) ? memoryFile + '  (exists)' : memoryFile + '  (missing)'}`);
  if (scope === 'global') log.info('Tip: run `shared-agent-memory init` inside a repo to enable project-local memory.');
  log.plain('');

  const rows = [
    ['Claude Code', claude.status(), paths.claudeInstructionsFile()],
    ['Codex', codex.status(), paths.codexInstructionsFile()],
  ];
  for (const [name, st, instrFile] of rows) {
    if (!st.present) {
      log.plain(`  ${name.padEnd(12)} ${log.mark(false)} not installed on this machine`);
      continue;
    }
    const instrOk = instructions.isInstalled(instrFile);
    log.plain(
      `  ${name.padEnd(12)} server ${log.mark(st.configured)}   instructions ${log.mark(instrOk)}`
    );
  }
}

function cmdDoctor(flags) {
  const dry = Boolean(flags['dry-run']);
  const memoryDir = resolveActiveMemoryDir(flags);
  const file = paths.memoryFile(memoryDir);
  log.title('shared-agent-memory doctor');
  log.info(`Memory file: ${file}`);
  doctorMemory(file, dry);
  doctorBoard(memoryDir, dry);
}

function doctorMemory(file, dry) {
  if (!fs.existsSync(file)) {
    log.info('No memory file yet — nothing to check.');
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const result = store.classify(raw);

  if (result.kind === 'empty') return log.ok('Store is empty — OK.');
  if (result.kind === 'ndjson') {
    return log.ok(`Store is valid NDJSON (${result.count} record${result.count === 1 ? '' : 's'}) — OK.`);
  }
  if (result.kind === 'pretty') {
    log.warn('Store is pretty-printed JSON — the memory server cannot read this.');
    if (dry) return log.info('Dry run — would back up the file and rewrite it as NDJSON.');
    fs.writeFileSync(file + '.bak', raw);
    fsx.writeFileAtomic(file, store.toNdjson(result.doc));
    log.ok(`Repaired → NDJSON. Original backed up to ${file}.bak`);
    return log.info('Restart your agents; memory search/read will work again.');
  }
  log.warn('Store is not parseable JSON (corrupt).');
  if (!dry) {
    fs.writeFileSync(file + '.bak', raw);
    log.info(`Backed up to ${file}.bak — inspect it by hand, or delete the store to reset.`);
  }
}

// The coordination board is the same hand-editable-NDJSON risk as the memory
// file: report unparseable lines and repair by dropping them (with a backup).
function doctorBoard(memoryDir, dry) {
  const file = board.boardFile(memoryDir);
  if (!fs.existsSync(file)) return log.info('No coordination board file — nothing to check.');
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const bad = lines.filter((l) => {
    try {
      JSON.parse(l);
      return false;
    } catch {
      return true;
    }
  });
  if (bad.length === 0) {
    return log.ok(`Board is valid NDJSON (${lines.length} claim${lines.length === 1 ? '' : 's'} incl. expired) — OK.`);
  }
  log.warn(`Board has ${bad.length} unparseable line${bad.length === 1 ? '' : 's'} (they are being ignored).`);
  if (dry) return log.info('Dry run — would back up the file and drop the bad lines.');
  fs.writeFileSync(file + '.bak', raw);
  board.compact(memoryDir); // rewrites only the valid, unexpired claims
  log.ok(`Repaired board. Original backed up to ${file}.bak`);
}

function cmdInstructions(flags) {
  const memoryDir = resolveMemoryDir(flags);
  let targets = ['claude', 'codex'];
  if (flags['claude-only']) targets = ['claude'];
  else if (flags['codex-only']) targets = ['codex'];
  log.title('shared-agent-memory instructions');
  printInstructions(targets, memoryDir);
}

function requireAgent(flags) {
  if (!flags.as) throw new Error('--as <agent> is required');
  return String(flags.as);
}

// Session id lets two parallel sessions of the SAME tool (e.g. two Claude Code
// windows) coordinate. Explicit --session wins; otherwise picked up from the
// environment when the agent runs this CLI from inside a session.
function sessionOf(flags) {
  return String(flags.session || process.env.CLAUDE_SESSION_ID || '');
}

function formatConflict(conflict) {
  const note = conflict.note ? ` - ${conflict.note}` : '';
  return `${conflict.agent} claims ${conflict.file} (${conflict.ageMin}m old)${note}`;
}

function cmdClaim(args, flags) {
  const agent = requireAgent(flags);
  const files = args.slice(1);
  if (files.length === 0) throw new Error('claim requires at least one file');
  const memoryDir = resolveActiveMemoryDir(flags);
  const conflicts = board.claim(
    memoryDir, agent, files, flags.note || '', process.cwd(), sessionOf(flags), Boolean(flags.replace)
  );
  log.ok(`Claimed ${files.length} file${files.length === 1 ? '' : 's'} as ${agent}.`);
  if (conflicts.length) {
    log.warn('Active conflict warning:');
    for (const c of conflicts) log.info(formatConflict(c));
  }
}

function cmdRelease(flags) {
  const agent = requireAgent(flags);
  const count = board.release(resolveActiveMemoryDir(flags), agent, sessionOf(flags));
  log.ok(`Released ${count} claim${count === 1 ? '' : 's'} for ${agent}.`);
}

function cmdBoard(flags) {
  const memoryDir = resolveActiveMemoryDir(flags);
  board.compact(memoryDir); // drop expired lines while we're here
  const claims = board.readClaims(memoryDir);
  log.title('shared-agent-memory board');
  if (claims.length === 0) {
    log.info('No active claims.');
    if (!project.findMemoryDir(process.cwd()) && !flags.memoryDir) {
      log.info('Tip: run `shared-agent-memory init` inside a repo for a project-local board.');
    }
    return;
  }
  for (const c of claims) {
    const ageMin = Math.round((Date.now() - c.ts) / 60000);
    const note = c.note ? ` - ${c.note}` : '';
    const project = c.project ? `  [${c.project}]` : '';
    log.plain(`  ${c.agent} (${ageMin}m)${note}${project}`);
    for (const file of c.files || []) log.plain(`    - ${file}`);
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return ''; // no stdin (e.g. run by hand from a terminal)
  }
}

function conflictWarning(file, conflicts) {
  const lines = [
    `Heads-up: ${file} overlaps with an active shared-agent-memory claim.`,
    ...conflicts.map((c) => `- ${formatConflict(c)}`),
    'Coordinate before editing if both agents are still working.',
  ];
  return lines.join('\n');
}

function cmdHook(args, flags) {
  const hook = args[1];
  const sub = args[2];
  if (hook !== 'pre-edit') throw new Error('hook only supports: pre-edit');
  if (sub) throw new Error(`unknown hook argument: ${sub}`);

  // Validate up front — a typo'd mode must fail at install/test time, not weeks
  // later on the first real conflict.
  const mode = flags.mode || 'warn';
  if (mode !== 'warn' && mode !== 'block') throw new Error('--mode must be warn or block');

  const raw = readStdin().trim();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return; // malformed hook payload — never break the user's edit over it
  }
  const input = payload.tool_input || payload.toolInput || payload.input || {};
  const file = input.file_path || input.filePath || input.path;
  if (!file) return;

  // session_id distinguishes parallel Claude Code sessions; cwd anchors
  // relative claims to the right project.
  const session = String(payload.session_id || '');
  const conflicts = board.checkFile(
    resolveActiveMemoryDir(flags, payload.cwd || process.cwd()), 'claude', file, session, payload.cwd || process.cwd()
  );
  if (conflicts.length === 0) return;

  const warning = conflictWarning(file, conflicts);
  if (mode === 'block') {
    console.error(warning);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: coordination.HOOK_EVENT,
      additionalContext: warning,
    },
  }));
}

function cmdCoordination(args, flags) {
  const action = args[1] || 'status';
  const dry = Boolean(flags['dry-run']);
  const cliFile = path.resolve(__dirname, 'cli.js');

  if (action === 'on') {
    const mode = flags.mode || 'warn';
    if (mode !== 'warn' && mode !== 'block') throw new Error('--mode must be warn or block');
    // Bake a custom memory dir into the hook command, or the hook would check
    // the default board while claims land in the custom one.
    const hookCmd = coordination.hookCommand(cliFile, {
      mode,
      memoryDir: flags.memoryDir ? resolveMemoryDir(flags) : null,
    });
    log.title('Turning shared-agent-memory coordination on' + (dry ? ' (dry run)' : ''));
    log.step(`Claude Code instructions: ${coordination.installInstructions(paths.claudeInstructionsFile(), 'claude', dry)} (${paths.claudeInstructionsFile()})`);
    log.step(`Codex instructions: ${coordination.installInstructions(paths.codexInstructionsFile(), 'codex', dry)} (${paths.codexInstructionsFile()})`);
    log.step(`Claude Code PreToolUse hook: ${coordination.installClaudeHook(paths.claudeSettingsFile(), hookCmd, dry)} (${paths.claudeSettingsFile()})`);
    log.done();
    log.info(
      mode === 'block'
        ? 'Coordination hook installed in BLOCK mode — conflicting edits are refused until the claim is released or expires.'
        : 'Coordination uses advisory file-path claims and warnings; it does not block edits by default.'
    );
    return;
  }

  if (action === 'off') {
    log.title('Turning shared-agent-memory coordination off' + (dry ? ' (dry run)' : ''));
    log.step(`Claude Code instructions: ${coordination.removeInstructions(paths.claudeInstructionsFile(), dry)}`);
    log.step(`Codex instructions: ${coordination.removeInstructions(paths.codexInstructionsFile(), dry)}`);
    log.step(`Claude Code PreToolUse hook: ${coordination.removeClaudeHook(paths.claudeSettingsFile(), dry)}`);
    log.done();
    return;
  }

  if (action === 'status') {
    const hookMode = coordination.claudeHookMode(paths.claudeSettingsFile());
    log.title('shared-agent-memory coordination status');
    log.plain(`  Claude instructions ${log.mark(coordination.instructionsInstalled(paths.claudeInstructionsFile()))}`);
    log.plain(`  Codex instructions  ${log.mark(coordination.instructionsInstalled(paths.codexInstructionsFile()))}`);
    log.plain(`  Claude hook         ${log.mark(hookMode !== null)}${hookMode ? ` (${hookMode})` : ''}`);
    return;
  }

  throw new Error('coordination supports: on, off, status');
}

async function cmdInit(flags) {
  const dry = Boolean(flags['dry-run']);
  const root = process.cwd();
  const agentIds = flags.agents
    ? project.normalizeAgentIds(flags.agents)
    : await project.selectAgentsInteractive();
  const result = project.ensureProject(root, agentIds, dry);

  log.title('Project shared memory init' + (dry ? ' (dry run)' : ''));
  log.step(`Project memory: ${result.dir}`);
  for (const f of result.created) log.step(`Created: ${f}`);
  if (result.created.length === 0) log.step('Project memory files already exist');

  if (result.installed.length) {
    log.plain('');
    log.info('Installed instructions:');
    for (const item of result.installed) {
      const rel = path.relative(root, item.file) || item.file;
      log.step(`${item.agent.label}: ${item.result} (${rel})`);
    }
  }

  log.plain('');
  log.info('Manual instructions are always available at .shared-memory/INSTRUCTIONS.md');
  log.info('Restart your AI coding tool, or ask it to read that file before working here.');
  log.done();
}

const HELP = `
shared-agent-memory — one shared memory for all your AI coding agents

Usage:
  shared-agent-memory <command> [options]

Commands:
  install       Configure detected agents (Claude Code, Codex) to share memory
  init          Enable project-local memory and guided agent instructions
  instructions  Print the instruction block(s) to paste into a .md yourself
  claim         Claim files on the shared coordination board
  release       Release this agent's active coordination claim
  board         Show active coordination claims
  coordination  Turn advisory coordination instructions/hooks on or off
  hook          Internal hook entrypoints for supported agents
  doctor        Check/repair the memory file and coordination board formats
  uninstall     Remove the memory server + instruction blocks
  status        Show what is currently configured
  help          Show this help

Options:
  --claude-only        Only target Claude Code
  --codex-only         Only target Codex
  --manual             (install) configure the MCP server but DON'T write the
                       instruction block — print it for you to paste instead
  --as <agent>         Agent label for claim/release (for example codex, claude)
  --note <text>        Short note for a claim
  --session <id>       Session id for claim/release, so two parallel sessions of
                       the same tool coordinate (auto-detected from
                       CLAUDE_SESSION_ID when unset)
  --replace            (claim) start a fresh claim instead of merging files
                       into this agent's existing one
  --mode <warn|block>  (coordination on) hook behavior (default: warn)
  --agents <list|all>  (init) comma-separated agents: codex, claude, cursor,
                       windsurf, gemini, aider, manual
  --memory-dir <path>  Use a custom shared memory directory
                       (default: ~/.agent-memory)
  --dry-run            Print what would change without writing anything
  --purge              (uninstall only) also delete the memory store

Examples:
  npx github:dan-calin/shared-agent-memory install
  shared-agent-memory init
  shared-agent-memory init --agents codex,claude,cursor
  shared-agent-memory install --manual
  shared-agent-memory instructions --codex-only
  shared-agent-memory coordination on
  shared-agent-memory claim lib/cli.js --as codex --note "wire CLI"
  shared-agent-memory board
  shared-agent-memory release --as codex
  shared-agent-memory status
  shared-agent-memory uninstall --purge
`;

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0] || 'help';
  try {
    switch (cmd) {
      case 'install':
        return cmdInstall(flags);
      case 'init':
        return await cmdInit(flags);
      case 'instructions':
        return cmdInstructions(flags);
      case 'claim':
        return cmdClaim(_, flags);
      case 'release':
        return cmdRelease(flags);
      case 'board':
        return cmdBoard(flags);
      case 'hook':
        return cmdHook(_, flags);
      case 'coordination':
        return cmdCoordination(_, flags);
      case 'doctor':
        return cmdDoctor(flags);
      case 'uninstall':
        return cmdUninstall(flags);
      case 'status':
        return cmdStatus(flags);
      case 'help':
        return console.log(HELP);
      default:
        console.log(`Unknown command: ${cmd}`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    log.warn('Error: ' + (err && err.message ? err.message : String(err)));
    process.exitCode = 1;
  }
}

main();
