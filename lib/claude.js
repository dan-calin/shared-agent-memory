'use strict';

const fs = require('fs');
const paths = require('./paths');

// Claude Code stores user-scoped MCP servers in ~/.claude.json under the
// top-level "mcpServers" key.

function detect() {
  return fs.existsSync(paths.claudeConfigFile()) || fs.existsSync(paths.claudeDir());
}

function readConfig() {
  const file = paths.claudeConfigFile();
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function install({ memoryFile, dry }) {
  const file = paths.claudeConfigFile();
  const cfg = readConfig();
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};

  const existed = Boolean(cfg.mcpServers.memory);
  const launch = paths.serverLaunch();
  cfg.mcpServers.memory = {
    type: 'stdio',
    command: launch.command,
    args: launch.args,
    env: { MEMORY_FILE_PATH: memoryFile },
  };

  if (!dry) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { serverMsg: existed ? 'memory server updated' : 'memory server added' };
}

function uninstall({ dry }) {
  const file = paths.claudeConfigFile();
  if (!fs.existsSync(file)) return { msg: 'no config found' };
  const cfg = readConfig();
  if (cfg.mcpServers && cfg.mcpServers.memory) {
    delete cfg.mcpServers.memory;
    if (!dry) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    return { msg: 'memory server removed' };
  }
  return { msg: 'memory server not present' };
}

function status() {
  if (!fs.existsSync(paths.claudeConfigFile())) return { present: false, configured: false };
  const cfg = readConfig();
  return { present: true, configured: Boolean(cfg.mcpServers && cfg.mcpServers.memory) };
}

module.exports = { detect, install, uninstall, status };
