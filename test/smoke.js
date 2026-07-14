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

function run(args, input, cwd) {
  const env = { ...process.env, SHARED_AGENT_MEMORY_HOME: tmpHome, NO_COLOR: '1' };
  delete env.CLAUDE_SESSION_ID; // keep session behavior deterministic in tests
  return execFileSync('node', [cli, ...args], { env, encoding: 'utf8', input, cwd });
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

  // Replacing an unrelated "memory" server must be called out loudly.
  const cfgClobber = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf8'));
  cfgClobber.mcpServers.memory = { type: 'stdio', command: 'my-own-memory-server', args: [] };
  fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify(cfgClobber, null, 2) + '\n');
  const clobberOut = run(['install']);
  assert(clobberOut.includes('REPLACED'), 'install warns when replacing an unrelated memory server');

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

  // Project init: creates .shared-memory plus selected agent instruction files.
  const tmpProject = fs.mkdtempSync(path.join(tmpHome, 'project-'));
  fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# Existing Claude notes\n\nDo not remove me.\n');
  const initOut = run(['init', '--agents', 'all'], undefined, tmpProject);
  assert(initOut.includes('Project shared memory init'), 'init reports project setup');
  assert(fs.existsSync(path.join(tmpProject, '.shared-memory', 'memory.json')), 'init creates project memory');
  assert(fs.existsSync(path.join(tmpProject, '.shared-memory', 'activity.jsonl')), 'init creates project board');
  assert(fs.existsSync(path.join(tmpProject, '.shared-memory', 'manifest.json')), 'init creates project manifest');
  assert(fs.existsSync(path.join(tmpProject, '.shared-memory', 'INSTRUCTIONS.md')), 'init creates manual instructions');
  assert(fs.readFileSync(path.join(tmpProject, 'AGENTS.md'), 'utf8').includes('shared-agent-memory-project'), 'init writes Codex instructions');
  const claudeProjectMd = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf8');
  assert(claudeProjectMd.includes('Do not remove me.') && claudeProjectMd.includes('shared-agent-memory-project'), 'init preserves existing Claude instructions');
  assert(fs.existsSync(path.join(tmpProject, '.cursor', 'rules', 'shared-agent-memory.mdc')), 'init writes Cursor rule');
  assert(fs.existsSync(path.join(tmpProject, '.windsurf', 'rules', 'shared-agent-memory.md')), 'init writes Windsurf rule');
  assert(fs.existsSync(path.join(tmpProject, 'GEMINI.md')), 'init writes Gemini instructions');
  assert(fs.existsSync(path.join(tmpProject, 'CONVENTIONS.md')), 'init writes Aider conventions');

  const projectClaim = run(['claim', 'project.js', '--as', 'codex'], undefined, tmpProject);
  assert(projectClaim.includes('Claimed 1 file as codex'), 'claim works inside initialized project');
  const projectActivity = fs.readFileSync(path.join(tmpProject, '.shared-memory', 'activity.jsonl'), 'utf8');
  assert(projectActivity.includes('project.js'), 'project claim uses project-local board');
  const projectStatus = run(['status'], undefined, tmpProject);
  assert(projectStatus.includes('Active scope: PROJECT'), 'status detects project scope');
  run(['release', '--as', 'codex'], undefined, tmpProject);

  run(['init', '--agents', 'all'], undefined, tmpProject);
  const claudeMarkers = (fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf8').match(/BEGIN shared-agent-memory-project/g) || []).length;
  assert(claudeMarkers === 1, 'init updates its marker block instead of duplicating it');
  const cursorRule = fs.readFileSync(path.join(tmpProject, '.cursor', 'rules', 'shared-agent-memory.mdc'), 'utf8');
  const cursorFrontmatterCount = (cursorRule.match(/alwaysApply: true/g) || []).length;
  assert(cursorFrontmatterCount === 1, 'init does not duplicate Cursor rule frontmatter');

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
  assert(statusOut.includes('(warn)'), 'coordination status reports hook mode');

  // --mode block updates the installed hook in place instead of stacking a duplicate.
  run(['coordination', 'on', '--mode', 'block']);
  const settingsBlockCfg = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const blockCmds = settingsBlockCfg.hooks.PreToolUse.flatMap((e) => e.hooks || []).map((h) => h.command);
  const oursBlock = blockCmds.filter((c) => c && c.includes('hook pre-edit'));
  assert(oursBlock.length === 1 && oursBlock[0].includes('--mode block'), 'coordination on --mode block takes effect');
  assert((run(['coordination', 'status'])).includes('(block)'), 'status reflects block mode');
  run(['coordination', 'on']); // back to warn for the rest of the test

  // Board: claim, detect conflict, warn from the hook, release, and ignore expired claims.
  const claimOut = run(['claim', 'src/a.js', '--as', 'codex', '--note', 'touching src']);
  assert(claimOut.includes('Claimed 1 file as codex'), 'claim command records a file claim');
  const boardOut = run(['board']);
  assert(boardOut.includes('codex') && boardOut.includes('src/a.js'), 'board shows active claims');

  // Relative vs absolute forms of the SAME file conflict…
  const conflictOut = run(['claim', path.resolve('src/a.js'), '--as', 'claude', '--note', 'same file, absolute']);
  assert(conflictOut.includes('Active conflict warning') && conflictOut.includes('codex'), 'claim warns on conflicting file');
  // …but merely sharing a basename in different directories does NOT.
  const noConfOut = run(['claim', 'other/dir/a.js', '--as', 'claude']);
  assert(!noConfOut.includes('Active conflict warning'), 'same basename in a different directory is not a conflict');

  const hookOut = run(
    ['hook', 'pre-edit', '--mode', 'warn'],
    JSON.stringify({ cwd: process.cwd(), tool_input: { file_path: path.resolve('src/a.js') } })
  );
  const hookJson = JSON.parse(hookOut);
  assert(
    hookJson.hookSpecificOutput &&
      hookJson.hookSpecificOutput.hookEventName === 'PreToolUse' &&
      hookJson.hookSpecificOutput.additionalContext.includes('codex'),
    'pre-edit hook emits Claude warning context'
  );

  // Block mode refuses the edit with exit code 2 and a reason on stderr.
  let blocked = null;
  try {
    run(
      ['hook', 'pre-edit', '--mode', 'block'],
      JSON.stringify({ cwd: process.cwd(), tool_input: { file_path: path.resolve('src/a.js') } })
    );
  } catch (e) {
    blocked = e;
  }
  assert(blocked && blocked.status === 2 && String(blocked.stderr).includes('Heads-up'), 'block mode exits 2 with a reason');

  const releaseOut = run(['release', '--as', 'codex']);
  assert(releaseOut.includes('Released 1 claim for codex'), 'release removes this agent claim');
  run(['release', '--as', 'claude']);

  // parseArgs: a bare positional that *ends like* a value flag stays positional.
  const biasOut = run(['claim', 'bias', '--as', 'codex']);
  assert(biasOut.includes('Claimed 1 file as codex'), 'positional arg is not eaten as a value flag');
  assert(run(['board']).includes('bias'), 'board shows the oddly-named file');
  run(['release', '--as', 'codex']);

  // Claims merge by default; --replace starts over; merged set is one claim.
  run(['claim', 'a1.js', '--as', 'codex']);
  run(['claim', 'a2.js', '--as', 'codex']);
  const mergedBoard = run(['board']);
  assert(mergedBoard.includes('a1.js') && mergedBoard.includes('a2.js'), 'a second claim merges instead of dropping the first');
  run(['claim', 'b1.js', '--as', 'codex', '--replace']);
  const replacedBoard = run(['board']);
  assert(replacedBoard.includes('b1.js') && !replacedBoard.includes('a1.js'), '--replace starts a fresh claim');
  assert(run(['release', '--as', 'codex']).includes('Released 1 claim'), 'merged claims stay a single claim');

  // Sessions: two parallel Claude Code sessions warn each other; a session
  // never warns about its own claim.
  run(['claim', 'x.js', '--as', 'claude', '--session', 'AAA']);
  const otherSession = run(
    ['hook', 'pre-edit'],
    JSON.stringify({ session_id: 'BBB', cwd: process.cwd(), tool_input: { file_path: path.resolve('x.js') } })
  );
  assert(otherSession.includes('claude'), 'hook warns a different Claude session about the claim');
  const sameSession = run(
    ['hook', 'pre-edit'],
    JSON.stringify({ session_id: 'AAA', cwd: process.cwd(), tool_input: { file_path: path.resolve('x.js') } })
  );
  assert(sameSession.trim() === '', 'hook stays quiet for the session that made the claim');
  assert(run(['release', '--as', 'claude', '--session', 'AAA']).includes('Released 1 claim'), 'session-scoped release works');

  // Hook robustness: bad stdin must never break the user's edit; a bad mode must.
  assert(run(['hook', 'pre-edit'], '').trim() === '', 'hook tolerates empty stdin');
  assert(run(['hook', 'pre-edit'], 'not json').trim() === '', 'hook tolerates malformed stdin');
  let badMode = false;
  try {
    run(['hook', 'pre-edit', '--mode', 'blokc'], '{}');
  } catch {
    badMode = true;
  }
  assert(badMode, 'hook rejects an invalid --mode up front');

  const activityFile = path.join(tmpHome, '.agent-memory', 'activity.jsonl');
  fs.writeFileSync(activityFile, JSON.stringify({
    agent: 'old-agent',
    files: ['expired.js'],
    note: 'old claim',
    ts: Date.now() - board.TTL_MS - 1000,
  }) + '\n');
  const ttlOut = run(['board']);
  assert(ttlOut.includes('No active claims'), 'board hides expired claims');
  assert(fs.readFileSync(activityFile, 'utf8').trim() === '', 'board compacts expired lines from the file');

  // doctor: repairs a board with unparseable lines (backs it up first).
  fs.writeFileSync(
    activityFile,
    'this is not json\n' + JSON.stringify({ agent: 'codex', files: ['ok.js'], ts: Date.now() }) + '\n'
  );
  run(['doctor']);
  assert(fs.existsSync(activityFile + '.bak'), 'doctor backs up the broken board');
  const fixedLines = fs.readFileSync(activityFile, 'utf8').trim().split('\n');
  assert(fixedLines.length === 1 && fixedLines[0].includes('ok.js'), 'doctor drops unparseable board lines');
  fs.unlinkSync(activityFile);

  run(['coordination', 'off']);
  const claudeCoordOff = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(!claudeCoordOff.includes('BEGIN shared-agent-memory-coordination'), 'coordination off removes Claude block');
  const settingsOff = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const commandsOff = settingsOff.hooks.PreToolUse.flatMap((entry) => entry.hooks || []).map((h) => h.command);
  assert(commandsOff.includes('echo keep-me'), 'coordination off preserves unrelated hook');
  assert(!commandsOff.some((c) => c && c.includes('hook pre-edit')), 'coordination off removes only its hook');

  // uninstall must also tear coordination down — a stale hook would fail on
  // every edit in Claude Code.
  run(['coordination', 'on']);
  run(['uninstall']);
  const settingsUn = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const commandsUn = settingsUn.hooks.PreToolUse.flatMap((entry) => entry.hooks || []).map((h) => h.command);
  assert(!commandsUn.some((c) => c && c.includes('hook pre-edit')), 'uninstall removes the coordination hook');
  assert(commandsUn.includes('echo keep-me'), 'uninstall preserves unrelated hooks');
  const mdUn = fs.readFileSync(path.join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
  assert(!mdUn.includes('shared-agent-memory-coordination'), 'uninstall removes the coordination block');

  console.log('\nAll smoke tests passed.');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
