import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// Budget for the files that the first page load needs. Sizes are gzip-compressed,
// the way Apache sends them, and a KiB is 1024 bytes. A change to a budget needs a
// reason in docs/PERFORMANCE.md.
export const BUDGET = Object.freeze({ js: 200 * 1024, css: 50 * 1024 });

// The output of `npm run build --workspace=web`. vite.config.js keeps the default
// output folder, which is web/dist.
const DIST = join(import.meta.dirname, '..', 'dist');
const INDEX = join(DIST, 'index.html');
const NEEDS_BUILD = 'The build output is missing. Run npm run build --workspace=web first.';

// The files that index.html loads before the first screen. Lazy screens are not
// listed there, so they do not count.
export function initialFiles(html) {
  const pick = (pattern) => [...html.matchAll(pattern)].map((match) => match[1]);
  const scripts = pick(/<script\b[^>]*\ssrc="([^"]+)"/g);
  const preloads = pick(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g);
  const styles = pick(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g);
  return { js: [...scripts, ...preloads], css: styles };
}

// Gzip size in bytes of each file, summed per kind. A name is a path under the
// build output, such as /assets/index-abc.js.
export function totals(files) {
  const bytes = (name) => gzipSync(readFileSync(join(DIST, name))).length;
  return {
    js: files.js.reduce((sum, name) => sum + bytes(name), 0),
    css: files.css.reduce((sum, name) => sum + bytes(name), 0),
  };
}

// Returns the kinds whose size is over its budget. An empty list means every size fits.
export function checkBudget(sizes, budget = BUDGET) {
  return Object.keys(budget).filter((kind) => sizes[kind] > budget[kind]);
}

// Reads the build. Fails with the command to run when the build is missing.
function initialFromBuild() {
  expect(existsSync(INDEX), NEEDS_BUILD).toBe(true);
  return initialFiles(readFileSync(INDEX, 'utf8'));
}

describe('bundle budget', () => {
  it('reads the output of the build', () => {
    expect(existsSync(INDEX), NEEDS_BUILD).toBe(true);
  });

  it('keeps the initial JavaScript within its gzip budget', () => {
    const sizes = totals(initialFromBuild());
    console.info(`bundle: initial JavaScript ${sizes.js} bytes gzip (budget ${BUDGET.js}); initial CSS ${sizes.css} bytes gzip (budget ${BUDGET.css})`);
    expect(sizes.js, `initial JavaScript ${sizes.js} bytes gzip, budget ${BUDGET.js}`).toBeLessThanOrEqual(BUDGET.js);
  });

  it('keeps the initial CSS within its gzip budget', () => {
    const sizes = totals(initialFromBuild());
    expect(sizes.css, `initial CSS ${sizes.css} bytes gzip, budget ${BUDGET.css}`).toBeLessThanOrEqual(BUDGET.css);
  });

  it('puts the screens in their own files, outside the initial load', () => {
    const initial = new Set(initialFromBuild().js.map((name) => name.split('/').pop()));
    const assets = readdirSync(join(DIST, 'assets'));
    const lazy = assets.filter((name) => name.endsWith('.js') && !initial.has(name));
    expect(lazy.length, 'no screen is in a file of its own').toBeGreaterThan(0);
  });

  it('fails when a size is over its budget', () => {
    expect(checkBudget({ js: BUDGET.js + 1, css: BUDGET.css })).toEqual(['js']);
    expect(checkBudget({ js: BUDGET.js, css: BUDGET.css + 1 })).toEqual(['css']);
    expect(checkBudget({ js: BUDGET.js, css: BUDGET.css })).toEqual([]);
  });
});
