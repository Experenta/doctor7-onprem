import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

// Builds the client into a temporary folder and checks the output against the
// content policy that the server sends: no outside server, no inline script, no
// inline style. The policy is `default-src 'self'` without 'unsafe-inline'.

const WEB = join(import.meta.dirname, '..');

// Absolute addresses that library code carries as plain strings. None of them is
// requested: they are XML namespace names, documentation links inside warning
// and error messages, or the base of a URL parser. A new host here must be
// reviewed by a person.
const INERT_HOSTS = new Set([
  'www.w3.org', // SVG, MathML, and XHTML namespace names
  'react.dev', // links inside React error messages
  'reactjs.org', // links inside React warnings
  'reactrouter.com', // links inside React Router warnings
  'developer.mozilla.org', // links inside library warnings
  'github.com', // links inside library warnings
  'bugs.webkit.org', // browser bug references in library comments and messages
  'localhost', // base address for the URL parser in the router
]);

let outDir;
let files;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const read = (suffix) =>
  files.filter((path) => path.endsWith(suffix)).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'doctor7-web-'));
  await build({
    root: WEB,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });
  files = listFiles(outDir);
}, 120000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('built client', () => {
  it('has an HTML file, a script, and a stylesheet', () => {
    expect(read('index.html')).toHaveLength(1);
    expect(read('.js').length).toBeGreaterThan(0);
    expect(read('.css').length).toBeGreaterThan(0);
  });

  it('has no http or https address in the HTML', () => {
    for (const { path, text } of read('.html')) {
      expect(text, path).not.toMatch(/https?:\/\//i);
      expect(text, path).not.toMatch(/(?:src|href)\s*=\s*["']?\/\//i);
    }
  });

  it('has no inline script in the HTML', () => {
    for (const { path, text } of read('.html')) {
      const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      expect(scripts.length, path).toBeGreaterThan(0);
      for (const [, attributes, body] of scripts) {
        expect(attributes, path).toMatch(/\ssrc\s*=\s*"\/assets\//);
        expect(body.trim(), path).toBe('');
      }
      expect(text, path).not.toMatch(/\son[a-z]+\s*=/i);
      expect(text, path).not.toMatch(/javascript:/i);
    }
  });

  it('has no inline style in the HTML', () => {
    for (const { path, text } of read('.html')) {
      expect(text, path).not.toMatch(/\sstyle\s*=/i);
      expect(text, path).not.toMatch(/<style\b/i);
    }
  });

  it('loads its stylesheets and scripts from its own origin', () => {
    for (const { path, text } of read('.html')) {
      for (const [, url] of text.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/gi)) {
        expect(url, path).toMatch(/^\/assets\//);
      }
    }
  });

  it('has no external address, import, or font request in the CSS', () => {
    for (const { path, text } of read('.css')) {
      expect(text, path).not.toMatch(/https?:\/\//i);
      expect(text, path).not.toMatch(/@import/i);
      for (const [, url] of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        expect(url, path).toMatch(/^(\/assets\/|\.\/|data:)/);
      }
    }
  });

  it('names no outside host in the scripts, except inert library strings', () => {
    const hosts = new Set();
    for (const { text } of read('.js')) {
      for (const [, host] of text.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)) {
        hosts.add(host);
      }
    }
    expect([...hosts].filter((host) => !INERT_HOSTS.has(host)).sort()).toEqual([]);
  });

  it('keeps the client on /api and /ws', () => {
    const text = read('.js')
      .map((entry) => entry.text)
      .join('\n');
    expect(text).toContain('/api');
    expect(text).toContain('/ws');
  });
});
