'use strict';

// Loads a source export into MariaDB. Usage:
//   DATABASE_URL=<url> node seed/load.js --input <directory>
// Exit codes: 0 when every row was inserted or was already stored, 2 when some rows
// were rejected (the report still prints), 1 for a fatal error. The URL is never printed.

const fs = require('node:fs');
const { readInputDirectory, loadCollections, InputError } = require('./lib/loader');
const { createMariaDbPool, createMariaDbStore } = require('./lib/mariadb-store');
const { StoreError } = require('./lib/collections');
const { parseOptions, UsageError } = require('./lib/cli');

const USAGE = 'Usage: DATABASE_URL=<url> node seed/load.js --input <directory>\n';
const SCHEMA_HINT = 'Apply the API migrations first: node api/src/db/migrations.js up\n';

async function main(argv, env, io) {
  let options;
  try {
    options = parseOptions(argv, ['--input']);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n${USAGE}`);
      return 1;
    }
    throw error;
  }
  if (!options.input) {
    io.stderr(USAGE);
    return 1;
  }
  if (!env.DATABASE_URL) {
    io.stderr('DATABASE_URL is not set.\n');
    return 1;
  }

  const stat = fs.statSync(options.input, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory()) {
    io.stderr('Input stopped: input_directory_missing.\n');
    return 1;
  }

  let input;
  try {
    input = readInputDirectory(options.input);
  } catch (error) {
    if (error instanceof InputError) {
      io.stderr(`Input stopped: ${error.code} in ${error.collection}.json.\n`);
      return 1;
    }
    throw error;
  }

  let pool;
  try {
    pool = createMariaDbPool(env.DATABASE_URL);
  } catch {
    // The driver message can echo the URL, so only a fixed text is printed.
    io.stderr('Load stopped: invalid_database_url.\n');
    return 1;
  }
  try {
    const report = await loadCollections(input.documents, createMariaDbStore(pool));
    report.absent = input.absent;
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.totals.rejected > 0 ? 2 : 0;
  } catch (error) {
    // Print the error code only. Driver messages can contain row values.
    const code = error instanceof StoreError ? error.kind : (error && error.code) || 'load_failed';
    io.stderr(`Load stopped: ${code}.\n`);
    if (code === 'schema_missing') {
      io.stderr(SCHEMA_HINT);
    }
    return 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main };
