'use strict';

const os = require('os');
const path = require('path');

const isWindows = process.platform === 'win32';

// Allow overriding the home directory (used by tests and power users who keep
// their agent configs somewhere non-standard).
function home() {
  return process.env.SHARED_AGENT_MEMORY_HOME || os.homedir();
}

const serverPackage = '@modelcontextprotocol/server-memory';

// How to launch the memory MCP server on this OS, minus the env block.
// On Windows, npx must be invoked through `cmd /c` for stdio MCP clients.
function serverLaunch() {
  if (isWindows) {
    return { command: 'cmd', args: ['/c', 'npx', '-y', serverPackage] };
  }
  return { command: 'npx', args: ['-y', serverPackage] };
}

module.exports = {
  home,
  serverPackage,
  serverLaunch,
  defaultMemoryDir: () => path.join(home(), '.agent-memory'),
  memoryFile: (memoryDir) => path.join(memoryDir, 'memory.json'),

  // Claude Code
  claudeDir: () => path.join(home(), '.claude'),
  claudeConfigFile: () => path.join(home(), '.claude.json'),
  claudeSettingsFile: () => path.join(home(), '.claude', 'settings.json'),
  claudeInstructionsFile: () => path.join(home(), '.claude', 'CLAUDE.md'),

  // Codex CLI
  codexDir: () => path.join(home(), '.codex'),
  codexConfigFile: () => path.join(home(), '.codex', 'config.toml'),
  codexInstructionsFile: () => path.join(home(), '.codex', 'AGENTS.md'),
};
