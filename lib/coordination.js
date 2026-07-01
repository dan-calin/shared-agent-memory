'use strict';

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- BEGIN shared-agent-memory-coordination -->';
const END = '<!-- END shared-agent-memory-coordination -->';
const HOOK_EVENT = 'PreToolUse';
const HOOK_MATCHER = 'Edit|Write|MultiEdit';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteCommandPath(file) {
  return `"${file.replace(/"/g, '\\"')}"`;
}

function hookCommand(cliFile) {
  return `node ${quoteCommandPath(path.resolve(cliFile))} hook pre-edit --mode warn`;
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
    content = content.replace(re, block);
    if (!dry) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return 'updated';
  }

  const sep = content ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
  if (!dry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content + sep + block);
  }
  return content ? 'appended' : 'created';
}

function removeInstructions(file, dry) {
  if (!fs.existsSync(file)) return 'no file';
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes(BEGIN)) return 'not present';
  const re = new RegExp('\\n?' + escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END) + '\\n?');
  content = content.replace(re, '');
  if (!dry) fs.writeFileSync(file, content);
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

function isOurCommand(command, expected) {
  if (command === expected) return true;
  return (
    typeof command === 'string' &&
    command.includes('hook pre-edit') &&
    command.includes('shared-agent-memory')
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
  const exists = entry.hooks.some((h) => h && h.type === 'command' && h.command === command);
  if (exists) return 'already installed';

  entry.hooks.push({ type: 'command', command });
  if (!dry) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(cfg, null, 2) + '\n');
  }
  return 'installed';
}

function removeClaudeHook(settingsFile, command, dry) {
  if (!fs.existsSync(settingsFile)) return 'no file';
  const cfg = readJsonFile(settingsFile);
  if (!cfg.hooks || !Array.isArray(cfg.hooks[HOOK_EVENT])) return 'not present';

  let removed = false;
  cfg.hooks[HOOK_EVENT] = cfg.hooks[HOOK_EVENT]
    .map((entry) => {
      if (!entry || !Array.isArray(entry.hooks)) return entry;
      const nextHooks = entry.hooks.filter((h) => {
        const keep = !(h && h.type === 'command' && isOurCommand(h.command, command));
        if (!keep) removed = true;
        return keep;
      });
      return { ...entry, hooks: nextHooks };
    })
    .filter((entry) => !(entry && entry.matcher === HOOK_MATCHER && Array.isArray(entry.hooks) && entry.hooks.length === 0));

  if (!removed) return 'not present';
  if (!dry) fs.writeFileSync(settingsFile, JSON.stringify(cfg, null, 2) + '\n');
  return 'removed';
}

function claudeHookInstalled(settingsFile, command) {
  if (!fs.existsSync(settingsFile)) return false;
  const cfg = readJsonFile(settingsFile);
  const hooks = cfg.hooks && cfg.hooks[HOOK_EVENT];
  if (!Array.isArray(hooks)) return false;
  return hooks.some((entry) =>
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => h && h.type === 'command' && isOurCommand(h.command, command))
  );
}

module.exports = {
  BEGIN,
  END,
  HOOK_EVENT,
  HOOK_MATCHER,
  hookCommand,
  blockFor,
  installInstructions,
  removeInstructions,
  instructionsInstalled,
  installClaudeHook,
  removeClaudeHook,
  claudeHookInstalled,
};
