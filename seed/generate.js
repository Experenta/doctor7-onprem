'use strict';

// Writes the synthetic seed as six JSON files, one per source collection. Usage:
//   node seed/generate.js --out <directory> [--now <ISO 8601 instant>]
// The output is generated data. Write it outside the repository and do not commit it.

const fs = require('node:fs');
const path = require('node:path');
const { generateSeed } = require('./lib/generator');
const { parseInstant, InstantError } = require('./lib/instant');
const { parseOptions, UsageError } = require('./lib/cli');
const { COLLECTIONS } = require('./lib/collections');

const USAGE = 'Usage: node seed/generate.js --out <directory> [--now <ISO 8601 instant>]\n';

function main(argv, io, { nowMs = Date.now() } = {}) {
  let options;
  try {
    options = parseOptions(argv, ['--out', '--now']);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n${USAGE}`);
      return 1;
    }
    throw error;
  }
  if (!options.out) {
    io.stderr(USAGE);
    return 1;
  }

  let now = nowMs;
  if (options.now !== undefined) {
    try {
      now = parseInstant(options.now);
    } catch (error) {
      if (error instanceof InstantError) {
        io.stderr(`--now is not a valid instant (${error.code}).\n`);
        return 1;
      }
      throw error;
    }
  }

  const seed = generateSeed(now);
  fs.mkdirSync(options.out, { recursive: true });
  const counts = {};
  for (const def of COLLECTIONS) {
    const rows = seed[def.name];
    fs.writeFileSync(path.join(options.out, `${def.name}.json`), `${JSON.stringify(rows, null, 2)}\n`);
    counts[def.name] = rows.length;
  }
  io.stdout(`${JSON.stringify({ written: counts }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

module.exports = { main };
