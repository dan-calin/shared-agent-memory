'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fsx');

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
  writeFileAtomic(
    boardFile(memoryDir),
    claims.map((c) => JSON.stringify(c)).join('\n') + (claims.length ? '\n' : '')
  );
}

// Drop expired lines from the board file (readClaims already ignores them; this
// just keeps the NDJSON small and its git diffs clean).
function compact(memoryDir) {
  const f = boardFile(memoryDir);
  if (!fs.existsSync(f)) return;
  const live = readClaims(memoryDir);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length !== live.length) writeClaims(memoryDir, live);
}

function norm(p) {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

function isAbsolute(np) {
  return np.startsWith('/') || /^[a-z]:\//.test(np);
}

// Resolve a (possibly relative) claimed path against the project it was
// claimed from, so claims from different projects can't collide by accident.
function expand(file, project) {
  const nf = norm(file);
  if (project && !isAbsolute(nf)) return norm(path.posix.join(norm(project), nf));
  return nf;
}

// A claim is "self" (not a conflict) when it was made by the same agent label —
// unless both sides carry a session id and they differ, which means two
// parallel sessions of the same tool (e.g. two Claude Code windows). Those must
// still warn each other.
function isSelf(claimRecord, agent, session) {
  if (claimRecord.agent !== agent) return false;
  if (session && claimRecord.session && claimRecord.session !== session) return false;
  return true;
}

// Two expanded paths conflict if they are identical or one is a path-suffix of
// the other (handles relative vs absolute forms of the same file). Sharing only
// a basename (src/index.js vs lib/index.js) is NOT a conflict.
function filesConflict(a, b) {
  if (a === b) return true;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

function conflictsFor(claims, agent, files, session, queryProject) {
  const hits = [];
  const queryPaths = files.map((f) => expand(f, queryProject));
  for (const c of claims) {
    if (isSelf(c, agent, session)) continue;
    for (const qp of queryPaths) {
      for (const cf of c.files || []) {
        if (filesConflict(qp, expand(cf, c.project))) {
          hits.push({ agent: c.agent, file: cf, note: c.note || '', ageMin: Math.round((Date.now() - c.ts) / 60000) });
        }
      }
    }
  }
  return hits;
}

// Post/refresh this agent's claim. By default new files MERGE into the agent's
// existing claim (claiming b.js must not silently release a.js you're still
// editing); pass replace=true to start over. Returns conflicting active claims
// by other agents/sessions on the same files.
function claim(memoryDir, agent, files, note, project, session, replace) {
  const all = readClaims(memoryDir);
  const others = all.filter((c) => !isSelf(c, agent, session));
  const mine = all.filter((c) => isSelf(c, agent, session));
  const conflicts = conflictsFor(others, agent, files, session, project);

  const prevFiles = replace ? [] : mine.flatMap((c) => c.files || []);
  const merged = [...new Set([...prevFiles, ...files.map(String)])];
  const record = {
    agent,
    files: merged,
    note: note || (mine[0] && mine[0].note) || '',
    project: project || '',
    ts: Date.now(),
  };
  if (session) record.session = session;
  others.push(record);
  writeClaims(memoryDir, others);
  return conflicts;
}

function release(memoryDir, agent, session) {
  const claims = readClaims(memoryDir);
  const remaining = claims.filter((c) => !isSelf(c, agent, session));
  writeClaims(memoryDir, remaining);
  return claims.length - remaining.length;
}

// Conflicts on a single file, by agents/sessions other than the caller (used by
// the pre-edit hook). `queryProject` is the editing session's cwd.
function checkFile(memoryDir, agent, file, session, queryProject) {
  return conflictsFor(readClaims(memoryDir), agent, [file], session, queryProject);
}

module.exports = { TTL_MS, boardFile, readClaims, compact, claim, release, checkFile };
