'use strict';

const fs = require('fs');
const paths = require('./paths');
const { writeFileAtomic } = require('./fsx');

// Codex CLI stores MCP servers in ~/.codex/config.toml as [mcp_servers.<name>]
// tables. We add/remove the block textually so we don't need a TOML dependency
// (and so we never reformat the rest of the user's config).

const MARKER = '[mcp_servers.memory]';

function detect() {
  return fs.existsSync(paths.codexDir());
}

// TOML literal (single-quoted) strings keep Windows backslashes readable, but
// cannot contain a single quote (e.g. C:\Users\O'Brien) — fall back to a basic
// double-quoted string with escapes in that case, or the whole config breaks.
function tomlString(s) {
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function blockText(memoryFile) {
  const launch = paths.serverLaunch();
  const argsToml = launch.args.map((a) => `"${a}"`).join(', ');
  return [
    MARKER,
    `command = "${launch.command}"`,
    `args = [${argsToml}]`,
    // give a cold `npx` fetch time to start, so the tool is reliably exposed
    'startup_timeout_sec = 60',
    '',
    '[mcp_servers.memory.env]',
    `MEMORY_FILE_PATH = ${tomlString(memoryFile)}`,
    '',
  ].join('\n');
}

// Remove the [mcp_servers.memory] table and its [mcp_servers.memory.env] sub-table,
// stopping at the next unrelated top-level table or EOF. Returns the new content and
// whether a block was found.
function stripBlock(content) {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l.trim() === MARKER);
  if (start === -1) return { content, found: false };
  let end = start + 1;
  while (end < lines.length) {
    const t = lines[end].trim();
    if (t.startsWith('[') && t !== '[mcp_servers.memory.env]') break;
    end++;
  }
  lines.splice(start, end - start);
  return { content: lines.join('\n').replace(/\n{3,}/g, '\n\n'), found: true };
}

function install({ memoryFile, dry }) {
  const file = paths.codexConfigFile();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // Strip any prior block first so re-installs pick up config changes (idempotent update).
  const { content, found } = stripBlock(existing);
  const sep = content ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
  if (!dry) {
    fs.mkdirSync(paths.codexDir(), { recursive: true });
    writeFileAtomic(file, content + sep + blockText(memoryFile));
  }
  return { serverMsg: found ? 'memory server updated' : 'memory server added' };
}

function uninstall({ dry }) {
  const file = paths.codexConfigFile();
  if (!fs.existsSync(file)) return { msg: 'no config found' };
  const { content, found } = stripBlock(fs.readFileSync(file, 'utf8'));
  if (!found) return { msg: 'memory server not present' };
  if (!dry) writeFileAtomic(file, content);
  return { msg: 'memory server removed' };
}

function status() {
  if (!fs.existsSync(paths.codexConfigFile())) return { present: false, configured: false };
  const content = fs.readFileSync(paths.codexConfigFile(), 'utf8');
  return { present: true, configured: content.includes(MARKER) };
}

module.exports = { detect, install, uninstall, status };
