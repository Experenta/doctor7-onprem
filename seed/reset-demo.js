'use strict';

// Resets the demo database to the synthetic seed. Demo only, never production. Usage:
//   DEMO_MODE=1 DEMO_RESET_CONFIRM=erase-demo-data DEMO_RESET_DATABASE_URL=<url> node seed/reset-demo.js
// The audit log and schema_migrations are never touched. The script refuses (exit code 1, no
// change) unless all three variables are set and the database name ends in _demo.
// Exit codes: 0 done, 1 refused or failed, 2 done but some seed rows were rejected.
// The URL is never printed.

const { createMariaDbPool, createMariaDbStore } = require('./lib/mariadb-store');
const { StoreError } = require('./lib/collections');
const { ResetRefused, checkEnvironment, resetDemo } = require('./lib/reset');

const USAGE =
  'Usage: DEMO_MODE=1 DEMO_RESET_CONFIRM=erase-demo-data DEMO_RESET_DATABASE_URL=<url> node seed/reset-demo.js\n';

// Only a short identifier is printed. Driver messages can echo the URL or row values.
function safeCode(error) {
  if (error instanceof ResetRefused) return error.code;
  if (error instanceof StoreError) return error.kind;
  const code = error && error.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'reset_failed';
}

// `deps` is for tests: createPool, createStore, now, isDemoMarker. The command line cannot set it.
async function main(argv, env, io, deps = {}) {
  if (argv.length > 0) {
    io.stderr(`Reset stopped: no arguments are accepted.\n${USAGE}`);
    return 1;
  }
  const refusal = checkEnvironment(env);
  if (refusal) {
    io.stderr(`Reset refused: ${refusal}. Nothing was changed.\n${USAGE}`);
    return 1;
  }

  const createPool = deps.createPool || createMariaDbPool;
  const createStore = deps.createStore || createMariaDbStore;
  let pool;
  try {
    pool = createPool(env.DEMO_RESET_DATABASE_URL);
  } catch {
    io.stderr('Reset stopped: invalid_database_url.\n');
    return 1;
  }
  try {
    const options = { store: createStore(pool) };
    if (deps.now !== undefined) options.now = deps.now;
    if (deps.isDemoMarker !== undefined) options.isDemoMarker = deps.isDemoMarker;
    const result = await resetDemo(pool, options);
    const { rejected, ...report } = result;
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    if (rejected > 0) {
      io.stderr(`Reset finished, but ${rejected} seed rows were rejected.\n`);
      return 2;
    }
    return 0;
  } catch (error) {
    const code = safeCode(error);
    io.stderr(error instanceof ResetRefused ? `Reset refused: ${code}. Nothing was changed.\n` : `Reset stopped: ${code}.\n`);
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
