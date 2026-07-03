'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fsx');

const BEGIN = '<!-- BEGIN shared-agent-memory-coordination -->';
const END = '<!-- END shared-agent-memory-coordination -->';
const HOOK_EVENT = 'PreToolUse';
const HOOK_MATCHER = 'Edit|Write|MultiEdit';
const NPX_SPEC = 'github:dan-calin/shared-agent-memory';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteCommandPath(file) {
  return `"${file.replace(/"/g, '\\"')}"`;
}

// Build the hook command Claude Code will run before each edit.
// - When this CLI lives inside an npx cache (`npx github:...` install), that
//   path is ephemeral — the cache gets pruned and the hook would silently die.
//   Re-resolve through npx instead.
// - Otherwise pin the exact node binary (process.execPath): Claude Code
//   launched from a GUI may not have `node` on PATH.
function hookCommand(cliFile, opts = {}) {
  const mode = opts.mode || 'warn';
  const resolved = path.resolve(cliFile);
  const base = /[\\/]_npx[\\/]/i.test(resolved)
    ? `npx -y ${NPX_SPEC}`
    : `${quoteCommandPath(process.execPath)} ${quoteCommandPath(resolved)}`;
  const memFlag = opts.memoryDir ? ` --memory-dir ${quoteCommandPath(opts.memoryDir)}` : '';
  return `${base} hook pre-edit --mode ${mode}${memFlag}`;
}

function blockFor(agentLabel) {
  return [
    BEGIN,
    '## Shared agent coordination',
    '',
    'Use the shared work board when edits may overlap with another coding agent.',
    '',
    `- **Before editing:** run \`shared-agent-memory claim <files> --as ${agentLabel} --note "<task>"\` for the files you expect to touch, then check \`shared-agent-memory board\` for active claims.`,
    '- **If warned about a conflict:** coordinate in chat before editing the same file. Warnings are advisory; do not treat them as hard locks.',
    `- **When done:** run \`shared-agent-memory release --as ${agentLabel}\` so other agents know the files are free.`,
    '',
    END,
    '',
  ].join('\n');
}

function installInstructions(file, agentLabel, dry) {
  const block = blockFor(agentLabel);
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  if (content.includes(BEGIN)) {
    const re = new RegExp(escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END) + '\\n?');
    // function form: block content is inserted literally ($ sequences inert)
    content = content.replace(re, () => block);
    if (!dry) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic(file, content);
    }
    return 'updated';
  }

  const sep = content ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
  if (!dry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, content + sep + block);
  }
  return content ? 'appended' : 'created';
}

function removeInstructions(file, dry) {
  if (!fs.existsSync(file)) return 'no file';
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes(BEGIN)) return 'not present';
  const re = new RegExp('\\n?' + escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END) + '\\n?');
  content = content.replace(re, '');
  if (!dry) writeFileAtomic(file, content);
  return 'removed';
}

function instructionsInstalled(file) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(BEGIN);
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function ensureHookContainer(cfg) {
  if (!cfg.hooks || typeof cfg.hooks !== 'object' || Array.isArray(cfg.hooks)) cfg.hooks = {};
  if (!Array.isArray(cfg.hooks[HOOK_EVENT])) cfg.hooks[HOOK_EVENT] = [];
  return cfg.hooks[HOOK_EVENT];
}

// Recognize our hook regardless of how a previous version formatted the
// command (bare `node`, process.execPath, npx, different mode/dir flags).
function isOurCommand(command) {
  return (
    typeof command === 'string' &&
    command.includes('hook pre-edit') &&
    (command.includes('shared-agent-memory') || command.includes('cli.js'))
  );
}

function installClaudeHook(settingsFile, command, dry) {
  const cfg = readJsonFile(settingsFile);
  const hooks = ensureHookContainer(cfg);
  let entry = hooks.find((h) => h && h.matcher === HOOK_MATCHER);
  if (!entry) {
    entry = { matcher: HOOK_MATCHER, hooks: [] };
    hooks.push(entry);
  }
  if (!Array.isArray(entry.hooks)) entry.hooks = [];

  const ours = entry.hooks.find((h) => h && h.type === 'command' && isOurCommand(h.command));
  let result;
  if (ours && ours.command === command) return 'already installed';
  if (ours) {
    // update in place (mode/path changed) instead of stacking a duplicate
    ours.command = command;
    result = 'updated';
  } else {
    entry.hooks.push({ type: 'command', command });
    result = 'installed';
  }
  if (!dry) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileAtomic(settingsFile, JSON.stringify(cfg, null, 2) + '\n');
  }
  return result;
}

function removeClaudeHook(settingsFile, dry) {
  if (!fs.existsSync(settingsFile)) return 'no file';
  const cfg = readJsonFile(settingsFile);
  if (!cfg.hooks || !Array.isArray(cfg.hooks[HOOK_EVENT])) return 'not present';

  let removed = false;
  cfg.hooks[HOOK_EVENT] = cfg.hooks[HOOK_EVENT]
    .map((entry) => {
      if (!entry || !Array.isArray(entry.hooks)) return entry;
      const nextHooks = entry.hooks.filter((h) => {
        const keep = !(h && h.type === 'command' && isOurCommand(h.command));
        if (!keep) removed = true;
        return keep;
      });
      return { ...entry, hooks: nextHooks };
    })
    .filter((entry) => !(entry && entry.matcher === HOOK_MATCHER && Array.isArray(entry.hooks) && entry.hooks.length === 0));

  if (!removed) return 'not present';
  if (!dry) writeFileAtomic(settingsFile, JSON.stringify(cfg, null, 2) + '\n');
  return 'removed';
}

function findClaudeHookCommand(settingsFile) {
  if (!fs.existsSync(settingsFile)) return null;
  const cfg = readJsonFile(settingsFile);
  const hooks = cfg.hooks && cfg.hooks[HOOK_EVENT];
  if (!Array.isArray(hooks)) return null;
  for (const entry of hooks) {
    if (!entry || !Array.isArray(entry.hooks)) continue;
    const h = entry.hooks.find((x) => x && x.type === 'command' && isOurCommand(x.command));
    if (h) return h.command;
  }
  return null;
}

// 'warn' | 'block' | null (not installed)
function claudeHookMode(settingsFile) {
  const cmd = findClaudeHookCommand(settingsFile);
  if (!cmd) return null;
  return cmd.includes('--mode block') ? 'block' : 'warn';
}

module.exports = {
  HOOK_EVENT,
  hookCommand,
  blockFor,
  installInstructions,
  removeInstructions,
  instructionsInstalled,
  installClaudeHook,
  removeClaudeHook,
  claudeHookMode,
};
