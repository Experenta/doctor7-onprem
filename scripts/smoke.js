#!/usr/bin/env node
'use strict';

// End-to-end smoke for doctor7-onprem. Two modes:
//   node scripts/smoke.js                 in process: starts the API, the mock identity
//                                         provider, and the mock Google here, with
//                                         synthetic seed data in memory.
//   SMOKE_BASE_URL=https://<host> node scripts/smoke.js --remote
//                                         against a deployed instance. Write runs create
//                                         records whose text starts with smoke-.
// Exit codes: 0 every step that ran passed, 1 a step failed or was blocked,
// 2 the smoke could not run. See docs/SMOKE.md.

const { resolveConfig, ConfigError } = require('./lib/config');
const { STEPS, newRunTag } = require('./lib/steps');
const { startStack } = require('./lib/stack');
const { SmokeFailure } = require('./lib/http');

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, NOT_RUN: 2 });

// The context the steps use. `api` builds the address of an API route.
function contextFor({ origin, apiPrefix, readOnly }) {
  return {
    origin,
    readOnly,
    wsBase: origin.replace(/^http/, 'ws'),
    tag: newRunTag(),
    people: {},
    api: (route) => `${origin}${apiPrefix}${route}`,
  };
}

// The text printed for a failed step. A SmokeFailure message is safe by design.
// Any other error prints only its name, because its message can hold details.
function describe(err) {
  if (err instanceof SmokeFailure) return err.message;
  return `unexpected error (${err && err.name ? err.name : 'unknown'})`;
}

// Runs the steps in order. A step whose required step failed is reported as FAIL
// and is not run. In read-only mode, write steps print SKIP, which is not a failure.
async function runSteps(ctx, out) {
  const failed = new Set();
  let passed = 0;
  let skipped = 0;
  const total = STEPS.length;

  for (let index = 0; index < total; index += 1) {
    const number = index + 1;
    const step = STEPS[index];
    const label = `${number}/${total} ${step.name}`;

    const blocker = step.requires.find((dependency) => failed.has(dependency));
    if (blocker !== undefined) {
      failed.add(number);
      out(`FAIL ${label}: not run, step ${blocker} failed`);
      continue;
    }
    if (ctx.readOnly && step.writeOnly) {
      skipped += 1;
      out(`SKIP ${label}: write step, skipped in read-only mode`);
      continue;
    }

    const run = ctx.readOnly && step.readOnlyRun ? step.readOnlyRun : step.run;
    try {
      const detail = await run(ctx);
      passed += 1;
      out(`OK   ${label}: ${detail}`);
    } catch (err) {
      failed.add(number);
      out(`FAIL ${label}: ${describe(err)}`);
    }
  }

  const ran = total - skipped;
  const suffix = skipped > 0 ? `; ${skipped} skipped in read-only mode` : '';
  const ok = failed.size === 0;
  const summary = ok
    ? `Result: PASS (${passed} of ${ran} steps run passed${suffix})`
    : `Result: FAIL (${passed} of ${ran} steps run passed${suffix})`;
  return { ok, summary };
}

function defaultIo() {
  return { out: process.stdout, err: process.stderr };
}

// Runs the smoke with the given arguments and environment. Returns the exit code.
// `env` is never read from process.env here, so tests can pass their own values.
async function main(argv = [], env = process.env, io = defaultIo()) {
  const out = (line) => io.out.write(`${line}\n`);

  let config;
  try {
    config = resolveConfig(argv, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.err.write(`smoke: configuration error: ${err.message}\n`);
      return EXIT.NOT_RUN;
    }
    throw err;
  }

  let stack = null;
  try {
    let target = config;
    if (config.mode === 'process') {
      try {
        stack = await startStack({
          googleMode: config.googleMode,
          videoProvider: !config.noVideoProvider,
        });
      } catch {
        io.err.write('smoke: the local stack did not start.\n');
        return EXIT.NOT_RUN;
      }
      target = stack;
    }

    const ctx = contextFor({ origin: target.origin, apiPrefix: target.apiPrefix, readOnly: config.readOnly });
    const where = config.mode === 'remote' ? `remote, host ${new URL(ctx.origin).host}` : 'in process';
    out(`doctor7 smoke: ${where}, ${config.readOnly ? 'read-only' : 'write run'}`);
    if (!config.readOnly) {
      out('Records created by this run have text that starts with smoke-.');
    }

    const result = await runSteps(ctx, out);
    out(result.summary);
    return result.ok ? EXIT.PASS : EXIT.FAIL;
  } finally {
    if (stack) {
      await stack.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('smoke: unexpected failure.\n');
      process.exitCode = EXIT.NOT_RUN;
    }
  );
}

module.exports = { main, EXIT };
