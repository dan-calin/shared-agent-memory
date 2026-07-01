'use strict';

// The official server-memory stores the graph as newline-delimited JSON (NDJSON):
// one {"type":"entity"|"relation", ...} object per line. Agents that hand-edit the
// file without the MCP tool sometimes write a single *pretty-printed*
// {"entities":[...],"relations":[...]} object instead, which makes the server throw
// a JSON parse error on every read. These helpers detect and repair that.

function classify(raw) {
  const text = (raw || '').trim();
  if (!text) return { kind: 'empty' };

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const allLinesOk = lines.every((l) => {
    try {
      const o = JSON.parse(l);
      return o && typeof o === 'object' && typeof o.type === 'string';
    } catch {
      return false;
    }
  });
  if (allLinesOk) return { kind: 'ndjson', count: lines.length };

  // Not NDJSON — is it a single pretty-printed doc we can convert?
  try {
    const doc = JSON.parse(text);
    if (doc && (Array.isArray(doc.entities) || Array.isArray(doc.relations))) {
      return { kind: 'pretty', doc };
    }
    if (Array.isArray(doc)) return { kind: 'pretty', doc: { entities: doc, relations: [] } };
  } catch {
    /* not parseable as a whole either */
  }
  return { kind: 'corrupt' };
}

function toNdjson(doc) {
  const out = [];
  for (const e of doc.entities || []) {
    out.push(JSON.stringify({
      type: 'entity',
      name: e.name,
      entityType: e.entityType || 'entity',
      observations: e.observations || [],
    }));
  }
  for (const r of doc.relations || []) {
    out.push(JSON.stringify({
      type: 'relation',
      from: r.from,
      to: r.to,
      relationType: r.relationType,
    }));
  }
  return out.length ? out.join('\n') + '\n' : '';
}

module.exports = { classify, toNdjson };
