'use strict';

const fs = require('fs');
const paths = require('./paths');

// Codex CLI stores MCP servers in ~/.codex/config.toml as [mcp_servers.<name>]
// tables. We add/remove the block textually so we don't need a TOML dependency
// (and so we never reformat the rest of the user's config).

const MARKER = '[mcp_servers.memory]';

function detect() {
  return fs.existsSync(paths.codexDir());
}

function blockText(memoryFile) {
  const launch = paths.serverLaunch();
  const argsToml = launch.args.map((a) => `"${a}"`).join(', ');
  return [
    MARKER,
    `command = "${launch.command}"`,
    `args = [${argsToml}]`,
    '',
    '[mcp_servers.memory.env]',
    // single-quoted TOML literal string: backslashes in Windows paths stay literal
    `MEMORY_FILE_PATH = '${memoryFile}'`,
    '',
  ].join('\n');
}

function install({ memoryFile, dry }) {
  const file = paths.codexConfigFile();
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (content.includes(MARKER)) {
    return { serverMsg: 'memory server already configured (left as-is)' };
  }
  const sep = content ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
  if (!dry) {
    fs.mkdirSync(paths.codexDir(), { recursive: true });
    fs.writeFileSync(file, content + sep + blockText(memoryFile));
  }
  return { serverMsg: 'memory server added' };
}

function uninstall({ dry }) {
  const file = paths.codexConfigFile();
  if (!fs.existsSync(file)) return { msg: 'no config found' };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === MARKER);
  if (start === -1) return { msg: 'memory server not present' };

  // Remove the [mcp_servers.memory] table and its [mcp_servers.memory.env]
  // sub-table, stopping at the next unrelated top-level table or EOF.
  let end = start + 1;
  while (end < lines.length) {
    const t = lines[end].trim();
    if (t.startsWith('[') && t !== '[mcp_servers.memory.env]') break;
    end++;
  }
  lines.splice(start, end - start);
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (!dry) fs.writeFileSync(file, out);
  return { msg: 'memory server removed' };
}

function status() {
  if (!fs.existsSync(paths.codexConfigFile())) return { present: false, configured: false };
  const content = fs.readFileSync(paths.codexConfigFile(), 'utf8');
  return { present: true, configured: content.includes(MARKER) };
}

module.exports = { detect, install, uninstall, status };
