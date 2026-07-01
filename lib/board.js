'use strict';

const fs = require('fs');
const path = require('path');

// A lightweight "who is working on what right now" board, separate from the
// durable memory graph. Each claim is one NDJSON line in activity.jsonl. Claims
// auto-expire so a crashed session never locks a file forever.

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function boardFile(memoryDir) {
  return path.join(memoryDir, 'activity.jsonl');
}

function readClaims(memoryDir) {
  const f = boardFile(memoryDir);
  if (!fs.existsSync(f)) return [];
  const now = Date.now();
  return fs
    .readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((c) => c && now - (c.ts || 0) < TTL_MS);
}

function writeClaims(memoryDir, claims) {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(boardFile(memoryDir), claims.map((c) => JSON.stringify(c)).join('\n') + (claims.length ? '\n' : ''));
}

function norm(p) {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

// Two file references conflict if they are the same path, one is a suffix of the
// other (handles relative vs absolute), or they share a basename.
function filesConflict(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (na.endsWith('/' + nb) || nb.endsWith('/' + na)) return true;
  const base = path.posix.basename(na);
  return base !== '' && base === path.posix.basename(nb);
}

function conflictsFor(claims, agent, files) {
  const hits = [];
  for (const c of claims) {
    if (c.agent === agent) continue;
    for (const f of files) {
      for (const cf of c.files || []) {
        if (filesConflict(f, cf)) {
          hits.push({ agent: c.agent, file: cf, note: c.note || '', ageMin: Math.round((Date.now() - c.ts) / 60000) });
        }
      }
    }
  }
  return hits;
}

// Post/refresh this agent's claim (replaces its previous one). Returns any
// conflicting active claims by OTHER agents on the same files.
function claim(memoryDir, agent, files, note, project) {
  const claims = readClaims(memoryDir).filter((c) => c.agent !== agent);
  const conflicts = conflictsFor(claims, agent, files);
  claims.push({ agent, files: files.map(String), note: note || '', project: project || '', ts: Date.now() });
  writeClaims(memoryDir, claims);
  return conflicts;
}

function release(memoryDir, agent) {
  const claims = readClaims(memoryDir);
  const remaining = claims.filter((c) => c.agent !== agent);
  writeClaims(memoryDir, remaining);
  return claims.length - remaining.length;
}

// Conflicts on a single file, by agents other than `agent` (used by the hook).
function checkFile(memoryDir, agent, file) {
  return conflictsFor(readClaims(memoryDir), agent, [file]);
}

module.exports = { TTL_MS, boardFile, readClaims, claim, release, checkFile };
