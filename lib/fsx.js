'use strict';

const fs = require('fs');

// Write via a temp file + rename so a crash mid-write can never leave a
// truncated config behind. rename() on the same volume is atomic on all
// platforms we support (on Windows it maps to MoveFileEx with replace).
function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };
