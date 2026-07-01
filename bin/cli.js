#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../lib/paths');
const log = require('../lib/log');
const claude = require('../lib/claude');
const codex = require('../lib/codex');
const instructions = require('../lib/instructions');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--memory-dir') {
      out.flags.memoryDir = argv[++i];
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

function cmdInstructions(flags) {
  const memoryDir = resolveMemoryDir(flags);
  let targets = ['claude', 'codex'];
  if (flags['claude-only']) targets = ['claude'];
  else if (flags['codex-only']) targets = ['codex'];
  log.title('shared-agent-memory instructions');
  printInstructions(targets, memoryDir);
}

const HELP = `
shared-agent-memory — one shared memory for all your AI coding agents

Usage:
  shared-agent-memory <command> [options]

Commands:
  install       Configure detected agents (Claude Code, Codex) to share memory
  instructions  Print the instruction block(s) to paste into a .md yourself
  uninstall     Remove the memory server + instruction blocks
  status        Show what is currently configured
  help          Show this help

Options:
  --claude-only        Only target Claude Code
  --codex-only         Only target Codex
  --manual             (install) configure the MCP server but DON'T write the
                       instruction block — print it for you to paste instead
  --memory-dir <path>  Use a custom shared memory directory
                       (default: ~/.agent-memory)
  --dry-run            Print what would change without writing anything
  --purge              (uninstall only) also delete the memory store

Examples:
  npx github:dan-calin/shared-agent-memory install
  shared-agent-memory install --manual
  shared-agent-memory instructions --codex-only
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
