'use strict';

// Reads the source files and loads the rows into a store. Each row ends in one of
// four states: inserted, unchanged (already stored with the same content), rejected
// (invalid or conflicting), or a fatal error that stops the load. Rows are never
// updated or deleted, so running the same input again writes nothing.

const fs = require('node:fs');
const path = require('node:path');
const { COLLECTIONS, RowError, StoreError, sameRow, isValidId } = require('./collections');

// A problem with the input directory. `code` never includes file contents.
class InputError extends Error {
  constructor(code, collection) {
    super(code);
    this.name = 'InputError';
    this.code = code;
    this.collection = collection;
  }
}

// A store failure that becomes a row rejection. Other store failures stop the load.
const STORE_REJECTIONS = {
  duplicate: 'conflict',
  missing_reference: 'missing_reference',
  check_violation: 'constraint_violation',
};

function emptyCounts() {
  return { read: 0, inserted: 0, unchanged: 0, rejected: 0 };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Reads <collection>.json for every collection. A missing file counts as zero
// documents. Every file is parsed before the caller writes anything.
function readInputDirectory(dir) {
  const documents = {};
  const absent = [];
  for (const def of COLLECTIONS) {
    const file = path.join(dir, `${def.name}.json`);
    if (!fs.existsSync(file)) {
      documents[def.name] = [];
      absent.push(def.name);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new InputError('input_invalid_json', def.name);
    }
    if (!Array.isArray(parsed)) {
      throw new InputError('input_not_array', def.name);
    }
    documents[def.name] = parsed;
  }
  return { documents, absent };
}

function rejected(code, field, id) {
  return { status: 'rejected', code, field, id };
}

// Loads one document. Returns { status, code?, field?, id? }. Throws only for
// failures that must stop the load.
async function loadRow(def, doc, store, seen) {
  const rawId = isPlainObject(doc) && typeof doc.id === 'string' ? doc.id : null;
  const reportableId = isValidId(rawId) ? rawId : null;

  if (rawId !== null) {
    if (seen.has(rawId)) {
      return rejected('duplicate_id', 'id', reportableId);
    }
    seen.add(rawId);
  }
  if (!isPlainObject(doc)) {
    return rejected('not_object', null, null);
  }

  let row;
  try {
    row = def.map(doc);
  } catch (error) {
    if (error instanceof RowError) {
      return rejected(error.code, error.field, reportableId);
    }
    throw error;
  }

  const stored = await store.get(def, row.id);
  if (stored) {
    return sameRow(def, stored, row)
      ? { status: 'unchanged' }
      : rejected('conflict', null, row.id);
  }

  try {
    if (def.participants) {
      await def.participants(row, store);
    }
    await store.insert(def, row);
    return { status: 'inserted' };
  } catch (error) {
    if (error instanceof RowError) {
      return rejected(error.code, error.field, row.id);
    }
    if (error instanceof StoreError && STORE_REJECTIONS[error.kind]) {
      return rejected(STORE_REJECTIONS[error.kind], null, row.id);
    }
    throw error;
  }
}

// Loads every collection in order and returns the report described in design.md.
async function loadCollections(documents, store) {
  const report = { collections: {}, totals: emptyCounts() };

  for (const def of COLLECTIONS) {
    const docs = documents[def.name] || [];
    if (!Array.isArray(docs)) {
      throw new InputError('input_not_array', def.name);
    }
    const stats = { ...emptyCounts(), rejections: [] };
    const seen = new Set();

    for (let index = 0; index < docs.length; index += 1) {
      const outcome = await loadRow(def, docs[index], store, seen);
      stats.read += 1;
      if (outcome.status === 'rejected') {
        stats.rejected += 1;
        stats.rejections.push({
          index,
          id: outcome.id,
          code: outcome.code,
          field: outcome.field,
        });
      } else {
        stats[outcome.status] += 1;
      }
    }

    report.collections[def.name] = stats;
    for (const key of ['read', 'inserted', 'unchanged', 'rejected']) {
      report.totals[key] += stats[key];
    }
  }

  return report;
}

module.exports = { readInputDirectory, loadCollections, InputError };
