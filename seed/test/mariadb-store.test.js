'use strict';

// Static checks of the loader's SQL. The loader must never update or delete rows,
// because audit_log is append-only (docs/AUDIT.md). Values must travel as bound
// parameters, never as text inside the statement.

const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const LIB = path.join(__dirname, '..', 'lib');
const SOURCES = ['mariadb-store.js', 'loader.js', 'collections.js'].map((name) => ({
  name,
  text: fs.readFileSync(path.join(LIB, name), 'utf8'),
}));

describe('loader SQL', () => {
  test('no source file contains an UPDATE, DELETE, or REPLACE statement', () => {
    for (const { name, text } of SOURCES) {
      assert.doesNotMatch(text, /\bUPDATE\b/, `${name} has UPDATE`);
      assert.doesNotMatch(text, /\bDELETE\b/, `${name} has DELETE`);
      assert.doesNotMatch(text, /\bREPLACE\b/, `${name} has REPLACE`);
    }
  });

  test('the MariaDB store reads and writes through bound parameters only', () => {
    const store = SOURCES.find((source) => source.name === 'mariadb-store.js').text;
    assert.match(store, /WHERE id = \?/);
    assert.match(store, /VALUES \(\$\{placeholders\}\)/);
    assert.match(store, /pool\.execute\(/);
    assert.doesNotMatch(store, /WHERE id = \$\{/);
    assert.doesNotMatch(store, /VALUES \(\$\{values/);
  });

  test('the connection pool does not allow multiple statements per call', () => {
    const store = SOURCES.find((source) => source.name === 'mariadb-store.js').text;
    assert.match(store, /multipleStatements: false/);
    assert.match(store, /timezone: 'Z'/);
  });
});
