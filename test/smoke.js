'use strict';

// Minimal smoke test: run the installer against a throwaway HOME and assert it
// writes the expected config + instruction files, then that uninstall removes
// them. No real agent configs are touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const board = require('../lib/board');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-test-'));

function run(args, input) {
  return execFileSync('node', [cli, ...args], {
    env: { ...process.env, SHARED_AGENT_MEMORY_HOME: tmpHome, NO_COLOR: '1' },
    encoding: 'utf8',
    input,
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

  // doctor: repair a pretty-printed store back into NDJSON.
  const memFile = path.join(tmpHome, '.agent-memory', 'memory.json');
  fs.writeFileSync(
    memFile,
    JSON.stringify({ entities: [{ name: 'p/x', entityType: 'feature', observations: ['hi'] }], relations: [] }, null, 2)
  );
  run(['doctor']);
  const repaired = fs.readFileSync(memFile, 'utf8').trim();
  assert(repaired.split('\n').length === 1, 'doctor collapsed pretty JSON to one NDJSON line');
  const rec = JSON.parse(repaired);
  assert(rec.type === 'entity' && rec.name === 'p/x', 'doctor preserved the entity data');
  assert(fs.existsSync(memFile + '.bak'), 'doctor backed up the original');

  // Coordination opt-in: marker block plus Claude PreToolUse hook, preserving unrelated hooks.
  const settingsFile = path.join(tmpHome, '.claude', 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] },
      ],
    },
  }, null, 2));

  run(['coordination', 'on']);
  const claudeCoord = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(claudeCoord.includes('BEGIN shared-agent-memory-coordination'), 'coordination writes Claude block');
  const codexCoord = fs.readFileSync(path.join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');
  assert(codexCoord.includes('BEGIN shared-agent-memory-coordination'), 'coordination writes Codex block');

  run(['coordination', 'on']);
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const commands = settings.hooks.PreToolUse.flatMap((entry) => entry.hooks || []).map((h) => h.command);
  const coordinationHookCount = commands.filter((c) => c && c.includes('hook pre-edit')).length;
  assert(coordinationHookCount === 1, 'coordination hook is idempotent');
  assert(commands.includes('echo keep-me'), 'coordination preserves existing Claude hooks');

  const statusOut = run(['coordination', 'status']);
  assert(statusOut.includes('Claude hook'), 'coordination status reports hook state');

  // Board: claim, detect conflict, warn from the hook, release, and ignore expired claims.
  const claimOut = run(['claim', 'src/a.js', '--as', 'codex', '--note', 'touching src']);
  assert(claimOut.includes('Claimed 1 file as codex'), 'claim command records a file claim');
  const boardOut = run(['board']);
  assert(boardOut.includes('codex') && boardOut.includes('src/a.js'), 'board shows active claims');

  const conflictOut = run(['claim', 'a.js', '--as', 'claude', '--note', 'same basename']);
  assert(conflictOut.includes('Active conflict warning') && conflictOut.includes('codex'), 'claim warns on conflicting file');

  const hookOut = run(
    ['hook', 'pre-edit', '--mode', 'warn'],
    JSON.stringify({ tool_input: { file_path: path.join('repo', 'src', 'a.js') } })
  );
  const hookJson = JSON.parse(hookOut);
  assert(
    hookJson.hookSpecificOutput &&
      hookJson.hookSpecificOutput.hookEventName === 'PreToolUse' &&
      hookJson.hookSpecificOutput.additionalContext.includes('codex'),
    'pre-edit hook emits Claude warning context'
  );

  const releaseOut = run(['release', '--as', 'codex']);
  assert(releaseOut.includes('Released 1 claim for codex'), 'release removes this agent claim');
  run(['release', '--as', 'claude']);

  const activityFile = path.join(tmpHome, '.agent-memory', 'activity.jsonl');
  fs.writeFileSync(activityFile, JSON.stringify({
    agent: 'old-agent',
    files: ['expired.js'],
    note: 'old claim',
    ts: Date.now() - board.TTL_MS - 1000,
  }) + '\n');
  const ttlOut = run(['board']);
  assert(ttlOut.includes('No active claims'), 'board hides expired claims');

  run(['coordination', 'off']);
  const claudeCoordOff = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(!claudeCoordOff.includes('BEGIN shared-agent-memory-coordination'), 'coordination off removes Claude block');
  const settingsOff = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const commandsOff = settingsOff.hooks.PreToolUse.flatMap((entry) => entry.hooks || []).map((h) => h.command);
  assert(commandsOff.includes('echo keep-me'), 'coordination off preserves unrelated hook');
  assert(!commandsOff.some((c) => c && c.includes('hook pre-edit')), 'coordination off removes only its hook');

  console.log('\nAll smoke tests passed.');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
