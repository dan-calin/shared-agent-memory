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
const board = require('../lib/board');
const coordination = require('../lib/coordination');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  const valueFlags = new Set(['memory-dir', 'as', 'note', 'mode']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const key = a.slice(2, eq);
      const value = a.slice(eq + 1);
      out.flags[key === 'memory-dir' ? 'memoryDir' : key] = value;
    } else if (valueFlags.has(a.slice(2))) {
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

function mark(ok) {
  return ok ? '\x1b[32m✓\x1b[0m' : '\x1b[2m–\x1b[0m';
}

function cmdStatus() {
  log.title('shared-agent-memory status');

  const memoryDir = paths.defaultMemoryDir();
  const memoryFile = paths.memoryFile(memoryDir);
  log.info(`Memory store: ${memoryDir}`);
  log.info(`Memory file:  ${fs.existsSync(memoryFile) ? memoryFile + '  (exists)' : memoryFile + '  (missing)'}`);
  log.plain('');

  const rows = [
    ['Claude Code', claude.status(), paths.claudeInstructionsFile()],
    ['Codex', codex.status(), paths.codexInstructionsFile()],
  ];
  for (const [name, st, instrFile] of rows) {
    if (!st.present) {
      log.plain(`  ${name.padEnd(12)} ${mark(false)} not installed on this machine`);
      continue;
    }
    const instrOk = instructions.isInstalled(instrFile);
    log.plain(
      `  ${name.padEnd(12)} server ${mark(st.configured)}   instructions ${mark(instrOk)}`
    );
  }
}

function cmdDoctor(flags) {
  const dry = Boolean(flags['dry-run']);
  const file = paths.memoryFile(resolveMemoryDir(flags));
  log.title('shared-agent-memory doctor');
  log.info(`Memory file: ${file}`);

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
    fs.writeFileSync(file, store.toNdjson(result.doc));
    log.ok(`Repaired → NDJSON. Original backed up to ${file}.bak`);
    return log.info('Restart your agents; memory search/read will work again.');
  }
  log.warn('Store is not parseable JSON (corrupt).');
  if (!dry) {
    fs.writeFileSync(file + '.bak', raw);
    log.info(`Backed up to ${file}.bak — inspect it by hand, or delete the store to reset.`);
  }
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

function formatConflict(conflict) {
  const note = conflict.note ? ` - ${conflict.note}` : '';
  return `${conflict.agent} claims ${conflict.file} (${conflict.ageMin}m old)${note}`;
}

function cmdClaim(args, flags) {
  const agent = requireAgent(flags);
  const files = args.slice(1);
  if (files.length === 0) throw new Error('claim requires at least one file');
  const memoryDir = resolveMemoryDir(flags);
  const conflicts = board.claim(memoryDir, agent, files, flags.note || '', process.cwd());
  log.ok(`Claimed ${files.length} file${files.length === 1 ? '' : 's'} as ${agent}.`);
  if (conflicts.length) {
    log.warn('Active conflict warning:');
    for (const c of conflicts) log.info(formatConflict(c));
  }
}

function cmdRelease(flags) {
  const agent = requireAgent(flags);
  const count = board.release(resolveMemoryDir(flags), agent);
  log.ok(`Released ${count} claim${count === 1 ? '' : 's'} for ${agent}.`);
}

function cmdBoard(flags) {
  const claims = board.readClaims(resolveMemoryDir(flags));
  log.title('shared-agent-memory board');
  if (claims.length === 0) {
    log.info('No active claims.');
    return;
  }
  for (const c of claims) {
    const ageMin = Math.round((Date.now() - c.ts) / 60000);
    const note = c.note ? ` - ${c.note}` : '';
    log.plain(`  ${c.agent} (${ageMin}m)${note}`);
    for (const file of c.files || []) log.plain(`    - ${file}`);
  }
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
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

  const mode = flags.mode || 'warn';
  const raw = readStdin().trim();
  const payload = raw ? JSON.parse(raw) : {};
  const input = payload.tool_input || payload.toolInput || payload.input || {};
  const file = input.file_path || input.filePath || input.path;
  if (!file) return;

  const conflicts = board.checkFile(resolveMemoryDir(flags), 'claude', file);
  if (conflicts.length === 0) return;

  const warning = conflictWarning(file, conflicts);
  if (mode === 'block') {
    console.error(warning);
    process.exitCode = 2;
    return;
  }
  if (mode !== 'warn') throw new Error('--mode must be warn or block');
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
  const hookCmd = coordination.hookCommand(cliFile);

  if (action === 'on') {
    log.title('Turning shared-agent-memory coordination on' + (dry ? ' (dry run)' : ''));
    log.step(`Claude Code instructions: ${coordination.installInstructions(paths.claudeInstructionsFile(), 'claude', dry)} (${paths.claudeInstructionsFile()})`);
    log.step(`Codex instructions: ${coordination.installInstructions(paths.codexInstructionsFile(), 'codex', dry)} (${paths.codexInstructionsFile()})`);
    log.step(`Claude Code PreToolUse hook: ${coordination.installClaudeHook(paths.claudeSettingsFile(), hookCmd, dry)} (${paths.claudeSettingsFile()})`);
    log.done();
    log.info('Coordination uses advisory file-path claims and warnings; it does not block edits by default.');
    return;
  }

  if (action === 'off') {
    log.title('Turning shared-agent-memory coordination off' + (dry ? ' (dry run)' : ''));
    log.step(`Claude Code instructions: ${coordination.removeInstructions(paths.claudeInstructionsFile(), dry)}`);
    log.step(`Codex instructions: ${coordination.removeInstructions(paths.codexInstructionsFile(), dry)}`);
    log.step(`Claude Code PreToolUse hook: ${coordination.removeClaudeHook(paths.claudeSettingsFile(), hookCmd, dry)}`);
    log.done();
    return;
  }

  if (action === 'status') {
    log.title('shared-agent-memory coordination status');
    log.plain(`  Claude instructions ${mark(coordination.instructionsInstalled(paths.claudeInstructionsFile()))}`);
    log.plain(`  Codex instructions  ${mark(coordination.instructionsInstalled(paths.codexInstructionsFile()))}`);
    log.plain(`  Claude hook         ${mark(coordination.claudeHookInstalled(paths.claudeSettingsFile(), hookCmd))}`);
    return;
  }

  throw new Error('coordination supports: on, off, status');
}

const HELP = `
shared-agent-memory — one shared memory for all your AI coding agents

Usage:
  shared-agent-memory <command> [options]

Commands:
  install       Configure detected agents (Claude Code, Codex) to share memory
  instructions  Print the instruction block(s) to paste into a .md yourself
  claim         Claim files on the shared coordination board
  release       Release this agent's active coordination claim
  board         Show active coordination claims
  coordination  Turn advisory coordination instructions/hooks on or off
  hook          Internal hook entrypoints for supported agents
  doctor        Check the memory file's format and repair it if corrupted
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
  --mode <warn|block>  Hook behavior (default: warn)
  --memory-dir <path>  Use a custom shared memory directory
                       (default: ~/.agent-memory)
  --dry-run            Print what would change without writing anything
  --purge              (uninstall only) also delete the memory store

Examples:
  npx github:dan-calin/shared-agent-memory install
  shared-agent-memory install --manual
  shared-agent-memory instructions --codex-only
  shared-agent-memory coordination on
  shared-agent-memory claim lib/cli.js --as codex --note "wire CLI"
  shared-agent-memory board
  shared-agent-memory release --as codex
  shared-agent-memory status
  shared-agent-memory uninstall --purge
`;

function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0] || (flags.help ? 'help' : 'help');
  try {
    switch (cmd) {
      case 'install':
        return cmdInstall(flags);
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
