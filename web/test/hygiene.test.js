import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The terms are built from parts so this file does not hold them as plain text.
const FORBIDDEN = [['fire', 'base'], ['twi', 'lio'], ['doctor', '-7'], ['un', 'ad']].map((parts) => parts.join(''));

const SRC = join(import.meta.dirname, '..', 'src');
const WEB = join(import.meta.dirname, '..');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const sources = files(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('web/src hygiene', () => {
  it('finds source files to scan', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN.map((term) => [term]))('does not mention a forbidden term (%#)', (term) => {
    const hits = sources.filter(({ text }) => text.toLowerCase().includes(term)).map(({ path }) => path);
    expect(hits).toEqual([]);
  });

  it('has no external http or https address', () => {
    const hits = sources.filter(({ text }) => /https?:\/\//i.test(text)).map(({ path }) => path);
    expect(hits).toEqual([]);
  });

  it('has no xmlns attribute, remote font, or key-like value', () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/xmlns/);
      expect(text, path).not.toMatch(/googleapis|gstatic|cdn\./i);
      expect(text, path).not.toMatch(/AKIA[0-9A-Z]{16}|api[_-]?key|secret/i);
    }
  });

  it('uses no emoji or pictographs as icons', () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('puts an iframe only in the video panel', () => {
    const hits = sources
      .filter(({ path, text }) => /<iframe/.test(text) && !/\.test\./.test(path))
      .map(({ path }) => path.split(/[\\/]/).pop());
    expect(hits).toEqual(['VideoPanel.jsx']);
  });

  it('opens Meet links with noopener noreferrer in a new tab', () => {
    const video = sources.find(({ path }) => path.endsWith('VideoPanel.jsx')).text;
    expect(video).toMatch(/target="_blank"/);
    expect(video).toMatch(/rel="noopener noreferrer"/);
  });

  it('imports no icon library and no vendor SDK', () => {
    for (const { path, text } of sources) {
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      for (const name of imports.filter((value) => !value.startsWith('.') && !value.startsWith('node:'))) {
        expect(
          ['react', 'react-dom/client', 'react-router-dom', 'vitest', '@testing-library/react', '@testing-library/user-event', '@testing-library/jest-dom/vitest'],
          `${path} imports ${name}`,
        ).toContain(name);
      }
    }
  });

  it('declares no forbidden dependency', () => {
    const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'));
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    for (const term of FORBIDDEN) expect(names.filter((name) => name.includes(term))).toEqual([]);
    expect(names).toContain('@fontsource/lato');
    expect(names).toContain('@fontsource/montserrat');
  });
});
