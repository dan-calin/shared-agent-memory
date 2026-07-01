'use strict';

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- BEGIN shared-agent-memory (auto-managed) -->';
const END = '<!-- END shared-agent-memory -->';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The instruction block is loaded into context on every session start, so it is
// kept deliberately tiny. `agentLabel` is used in the save format; Claude Code
// exposes MCP tools as mcp__memory__<tool>, Codex exposes them bare.
function blockFor(agentLabel, memoryDir) {
  const prefix = agentLabel === 'claude' ? 'mcp__memory__' : '';
  const readme = path.join(memoryDir, 'README.md');
  return [
    BEGIN,
    '## Shared agent memory (MCP server: `memory`)',
    '',
    "A knowledge graph shared with my other coding agents. Use it so we don't re-explain context. Keep it terse — every entry costs tokens for every future session.",
    '',
    `- **Task start:** call \`${prefix}search_nodes\` with 1-3 keywords (project + file/feature names) to load prior context. **Never \`read_graph\`** (dumps everything). Skip for trivial/conversational asks.`,
    `- **Task end, or when I say "remember X":** save ONE telegraphic line via \`${prefix}add_observations\` (or \`${prefix}create_entities\` for a new one). Name entities \`project/file-or-feature\` so projects don't bleed together; observation format: \`what changed (${agentLabel}, YYYY-MM-DD HH:MM)\` in local 24h — check the clock if unsure. No prose. Save once per unit of work, not per edit; if the entity exists, add to it, don't duplicate.`,
    `- **Link related entities** with \`${prefix}create_relations\` when it aids recall (e.g. \`serviceA\` --depends-on--> \`db\`), so retrieval is structural, not just keywords.`,
    '',
    `Details: ${readme}`,
    END,
    '',
  ].join('\n');
}

function isInstalled(file) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(BEGIN);
}

function installInto(file, agentLabel, memoryDir, dry) {
  const block = blockFor(agentLabel, memoryDir);
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

function removeFrom(file, dry) {
  if (!fs.existsSync(file)) return 'no file';
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes(BEGIN)) return 'not present';
  const re = new RegExp('\\n?' + escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END) + '\\n?');
  content = content.replace(re, '');
  if (!dry) fs.writeFileSync(file, content);
  return 'removed';
}

function writeMemoryReadme(memoryDir, dry) {
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'memory-readme.md'), 'utf8');
  const out = tpl.split('{{MEMORY_DIR}}').join(memoryDir);
  if (!dry) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'README.md'), out);
  }
}

module.exports = { blockFor, isInstalled, installInto, removeFrom, writeMemoryReadme };
