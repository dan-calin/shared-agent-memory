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

function cmdInstall(flags) {
  const dry = Boolean(flags['dry-run']);
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
      const ir = instructions.installInto(paths.claudeInstructionsFile(), 'claude', memoryDir, dry);
      log.step(`Claude Code instructions: ${ir} (${paths.claudeInstructionsFile()})`);
    } else if (t === 'codex') {
      const r = codex.install({ memoryFile, dry });
      log.step(`Codex: ${r.serverMsg}`);
      const ir = instructions.installInto(paths.codexInstructionsFile(), 'codex', memoryDir, dry);
      log.step(`Codex instructions: ${ir} (${paths.codexInstructionsFile()})`);
    }
  }

  log.done();
  log.info('Restart your agents (Claude Code, Codex) so they load the new server + instructions.');
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

const HELP = `
shared-agent-memory — one shared memory for all your AI coding agents

Usage:
  shared-agent-memory <command> [options]

Commands:
  install      Configure detected agents (Claude Code, Codex) to share memory
  uninstall    Remove the memory server + instruction blocks
  status       Show what is currently configured
  help         Show this help

Options:
  --claude-only        Only configure Claude Code
  --codex-only         Only configure Codex
  --memory-dir <path>  Use a custom shared memory directory
                       (default: ~/.agent-memory)
  --dry-run            Print what would change without writing anything
  --purge              (uninstall only) also delete the memory store

Examples:
  npx github:dan-calin/shared-agent-memory install
  shared-agent-memory install --codex-only
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
