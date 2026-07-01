'use strict';

// Minimal smoke test: run the installer against a throwaway HOME and assert it
// writes the expected config + instruction files, then that uninstall removes
// them. No real agent configs are touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-test-'));

function run(args) {
  return execFileSync('node', [cli, ...args], {
    env: { ...process.env, SHARED_AGENT_MEMORY_HOME: tmpHome, NO_COLOR: '1' },
    encoding: 'utf8',
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('ok - ' + msg);
}

try {
  // Pretend both agents exist on this machine.
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude.json'), '{}\n');
  fs.mkdirSync(path.join(tmpHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'model = "x"\n');

  run(['install']);

  const claudeCfg = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf8'));
  assert(claudeCfg.mcpServers && claudeCfg.mcpServers.memory, 'claude.json has memory server');
  assert(
    claudeCfg.mcpServers.memory.env.MEMORY_FILE_PATH.includes('.agent-memory'),
    'claude memory points at shared store'
  );

  const codexToml = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf8');
  assert(codexToml.includes('[mcp_servers.memory]'), 'codex config has memory server');
  assert(codexToml.includes('model = "x"'), 'codex existing config preserved');

  const claudeMd = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(claudeMd.includes('Shared agent memory'), 'CLAUDE.md has instruction block');

  const agentsMd = fs.readFileSync(path.join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');
  assert(agentsMd.includes('Shared agent memory'), 'AGENTS.md has instruction block');

  assert(
    fs.existsSync(path.join(tmpHome, '.agent-memory', 'README.md')),
    'memory store README written'
  );

  // Idempotency: a second install must not duplicate the codex block.
  run(['install']);
  const codexToml2 = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf8');
  const count = (codexToml2.match(/\[mcp_servers\.memory\]/g) || []).length;
  assert(count === 1, 'codex memory block not duplicated on re-install');

  // Uninstall removes everything it added.
  run(['uninstall']);
  const claudeCfg2 = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf8'));
  assert(!(claudeCfg2.mcpServers && claudeCfg2.mcpServers.memory), 'claude memory removed');
  const codexToml3 = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf8');
  assert(!codexToml3.includes('[mcp_servers.memory]'), 'codex memory removed');
  assert(codexToml3.includes('model = "x"'), 'codex unrelated config still intact');

  // Manual mode: configures the server but prints the block instead of writing it.
  const manualOut = run(['install', '--manual']);
  const claudeCfg3 = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf8'));
  assert(claudeCfg3.mcpServers && claudeCfg3.mcpServers.memory, 'manual mode still configures the MCP server');
  const claudeMd2 = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(!claudeMd2.includes('Shared agent memory'), 'manual mode does NOT write the instruction block');
  assert(manualOut.includes('BEGIN shared-agent-memory'), 'manual mode prints the block for pasting');

  console.log('\nAll smoke tests passed.');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
