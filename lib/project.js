'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fsx');

const PROJECT_DIR = '.shared-memory';
const BEGIN = '<!-- BEGIN shared-agent-memory-project -->';
const END = '<!-- END shared-agent-memory-project -->';

const AGENTS = [
  { id: 'codex', label: 'Codex', file: 'AGENTS.md', note: 'Codex reads AGENTS.md' },
  { id: 'claude', label: 'Claude Code', file: 'CLAUDE.md', note: 'Claude Code reads CLAUDE.md' },
  { id: 'cursor', label: 'Cursor', file: path.join('.cursor', 'rules', 'shared-agent-memory.mdc'), note: 'Cursor reads project rules' },
  { id: 'windsurf', label: 'Windsurf', file: path.join('.windsurf', 'rules', 'shared-agent-memory.md'), note: 'Windsurf reads workspace rules' },
  { id: 'gemini', label: 'Gemini CLI', file: 'GEMINI.md', note: 'Gemini CLI reads GEMINI.md' },
  { id: 'aider', label: 'Aider', file: 'CONVENTIONS.md', note: 'Aider can /read CONVENTIONS.md' },
  { id: 'manual', label: 'Manual only', file: null, note: 'Create .shared-memory/INSTRUCTIONS.md for copy/paste' },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function memoryDir(root) {
  return path.join(root, PROJECT_DIR);
}

function findMemoryDir(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    const candidate = memoryDir(dir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function instructionBody() {
  return [
    '## Project shared memory',
    '',
    'This repo has project-local shared memory in `.shared-memory/`.',
    '',
    '- Use project memory for repo-specific facts, TODOs, decisions, and handoffs.',
    '- Use global memory only for user-wide preferences or cross-project context.',
    '- Use the project activity board for edit coordination:',
    '  - `shared-agent-memory claim <files> --as <agent> --note "<task>"`',
    '  - `shared-agent-memory board`',
    '  - `shared-agent-memory release --as <agent>`',
    '- If your AI tool does not automatically read this file, ask it to read `.shared-memory/INSTRUCTIONS.md` before working in this repo.',
  ].join('\n');
}

function genericInstructions() {
  return [
    '# Project shared memory',
    '',
    'This project uses `.shared-memory/` for project-local memory and edit coordination.',
    '',
    instructionBody(),
    '',
  ].join('\n');
}

function blockFor(agentId) {
  const body = instructionBody().replace(/<agent>/g, agentId === 'manual' ? 'your-agent' : agentId);
  return [BEGIN, body, END, ''].join('\n');
}

function cursorRuleFor(agentId) {
  return [
    '---',
    'description: Use project-local shared memory and edit coordination',
    'alwaysApply: true',
    '---',
    '',
    blockFor(agentId),
  ].join('\n');
}

function installBlock(file, block, dry) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (content.includes(BEGIN)) {
    const re = new RegExp(escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END) + '\\n?');
    content = content.replace(re, () => block);
    if (!dry) writeProjectFile(file, content);
    return 'updated';
  }
  const sep = content ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
  if (!dry) writeProjectFile(file, content + sep + block);
  return content ? 'appended' : 'created';
}

function writeProjectFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, content);
}

function normalizeAgentIds(value) {
  if (!value) return [];
  const ids = value === 'all'
    ? AGENTS.map((a) => a.id)
    : String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const known = new Set(AGENTS.map((a) => a.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`unknown agent "${id}" (use: ${AGENTS.map((a) => a.id).join(', ')})`);
  }
  return [...new Set(ids)];
}

function ensureProject(root, agentIds, dry) {
  const dir = memoryDir(root);
  const created = [];
  if (!dry) fs.mkdirSync(dir, { recursive: true });

  const files = [
    ['memory.json', ''],
    ['activity.jsonl', ''],
    ['manifest.json', JSON.stringify({ version: 1, scope: 'project', memoryFile: '.shared-memory/memory.json', activityFile: '.shared-memory/activity.jsonl' }, null, 2) + '\n'],
    ['INSTRUCTIONS.md', genericInstructions()],
  ];

  for (const [name, content] of files) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      if (!dry) writeProjectFile(file, content);
      created.push(path.join(PROJECT_DIR, name));
    }
  }

  const installed = [];
  for (const id of agentIds.filter((x) => x !== 'manual')) {
    const agent = AGENTS.find((a) => a.id === id);
    const file = path.join(root, agent.file);
    const block = id === 'cursor' && !fs.existsSync(file) ? cursorRuleFor(id) : blockFor(id);
    installed.push({ agent, file, result: installBlock(file, block, dry) });
  }

  return { dir, created, installed };
}

async function selectAgentsInteractive(stdin = process.stdin, stdout = process.stdout) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('init needs --agents <list> when not running in an interactive terminal');
  }

  let index = 0;
  const selected = new Set(['codex', 'claude']);
  const rows = [...AGENTS, { id: '__continue', label: 'Continue', note: 'Create project memory with selected tools' }];

  const render = () => {
    stdout.write('\x1b[?25l\x1b[H\x1b[J');
    stdout.write('Which AI coding tools do you use in this project?\n\n');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const pointer = i === index ? '>' : ' ';
      if (row.id === '__continue') {
        stdout.write(`\n${pointer} [ Continue ]\n`);
      } else {
        const mark = selected.has(row.id) ? 'x' : ' ';
        stdout.write(`${pointer} [${mark}] ${row.label.padEnd(12)} ${row.note}\n`);
      }
    }
    stdout.write('\nUse Up/Down arrows, Enter to select, Enter on Continue to finish. Ctrl+C cancels.\n');
  };

  return await new Promise((resolve) => {
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\x1b[?25h');
    };
    const finish = () => {
      cleanup();
      stdout.write('\n');
      resolve([...selected]);
    };
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      if (s === '\u0003') {
        cleanup();
        stdout.write('\n');
        process.exit(130);
      }
      if (s === '\x1b[A') index = (index - 1 + rows.length) % rows.length;
      else if (s === '\x1b[B') index = (index + 1) % rows.length;
      else if (s === '\r' || s === '\n' || s === ' ') {
        const row = rows[index];
        if (row.id === '__continue') return finish();
        if (selected.has(row.id)) selected.delete(row.id);
        else selected.add(row.id);
      }
      render();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    render();
  });
}

module.exports = {
  PROJECT_DIR,
  AGENTS,
  memoryDir,
  findMemoryDir,
  normalizeAgentIds,
  ensureProject,
  selectAgentsInteractive,
};
