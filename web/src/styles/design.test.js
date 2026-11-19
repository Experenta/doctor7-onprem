import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');
const mainSource = readFileSync(join(import.meta.dirname, '..', 'main.jsx'), 'utf8');

function token(name) {
  const match = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token ${name}`);
  return match[1].trim();
}

function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const c = (name) => token(`color-${name}`);

describe('theme tokens', () => {
  it('holds the brief palette', () => {
    expect(c('heading').toLowerCase()).toBe('#5e60ce');
    expect(c('primary')).toBe('#7400b8');
    expect(c('primary-border')).toBe('#bca5eb');
    expect(c('secondary')).toBe('#9278c5');
    expect(c('secondary-surface')).toBe('#7f45d9');
    expect(c('now')).toBe('#7a5cff');
    expect(token('gradient-main')).toBe('linear-gradient(49deg, #7400b8 33%, #33bfe9 100%)');
    expect(token('gradient-button')).toBe('linear-gradient(90deg, #8161f3, #4da4ff)');
    expect(token('stat-1')).toContain('#fe69a5');
    expect(token('stat-1')).toContain('#ff875e');
    expect(token('stat-2')).toContain('#5e72e4');
    expect(token('stat-2')).toContain('#8e70ee');
    expect(token('stat-3')).toContain('#119bd2');
    expect(token('stat-3')).toContain('#3ad0bf');
    expect(token('stat-4')).toContain('#8362f7');
    expect(token('stat-4')).toContain('#ee70e9');
  });

  it('keeps every color in tokens.css', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);
  });
});

describe('text contrast (4.5:1)', () => {
  const pairs = [
    ['ink', 'bg'],
    ['ink', 'surface'],
    ['ink', 'surface-muted'],
    ['ink-muted', 'bg'],
    ['ink-muted', 'surface'],
    ['ink-muted', 'surface-muted'],
    ['heading', 'surface'],
    ['heading', 'bg'],
    ['primary', 'surface'],
    ['primary', 'bg'],
    ['primary', 'surface-muted'],
    ['primary', 'line'],
    ['on-primary', 'primary'],
    ['on-primary-muted', 'primary'],
    ['on-primary', 'secondary-surface'],
    ['danger', 'surface'],
    ['danger', 'danger-surface'],
    ['success', 'success-surface'],
    ['ink', 'success-surface'],
    ['selection-text', 'selection-bg'],
  ];
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('graphics contrast (3:1)', () => {
  it('keeps stat icons readable on every stop of the four pairs', () => {
    for (const name of ['stat-1', 'stat-2', 'stat-3', 'stat-4']) {
      const stops = token(name).match(/#[0-9a-fA-F]{6}/g);
      expect(stops).toHaveLength(2);
      for (const stop of stops) expect(contrast(c('on-stat'), stop)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps focus rings and control borders visible', () => {
    expect(contrast(c('focus'), c('surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('focus'), c('bg'))).toBeGreaterThanOrEqual(3);
    expect(contrast(c('secondary'), c('surface'))).toBeGreaterThanOrEqual(3);
  });
});

describe('css rules', () => {
  it('has no gradient text, glass, or wide colored side borders', () => {
    expect(css).not.toMatch(/background-clip:\s*text/);
    expect(css).not.toMatch(/text-fill-color/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/filter:\s*blur/);
    expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/);
  });

  it('uses soft shadows with a blur', () => {
    const shadows = [...tokens.matchAll(/--shadow-[a-z]+:\s*(-?\d+)(?:px)?\s+(-?\d+)px\s+(\d+)px/g)];
    expect(shadows.length).toBeGreaterThanOrEqual(2);
    for (const [, , , blur] of shadows) expect(Number(blur)).toBeGreaterThanOrEqual(8);
    expect(css).not.toMatch(/box-shadow:\s*-?\d+px\s+-?\d+px\s+0/);
  });

  it('uses a fixed rem type scale and 44px targets', () => {
    expect(css).not.toMatch(/clamp\(/);
    expect(css).not.toMatch(/font-size:[^;]*v[wh]/);
    expect(token('target')).toBe('2.75rem');
    expect(token('measure')).toBe('70ch');
    const sizes = ['text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl'].map((n) => parseFloat(token(n)));
    for (let i = 1; i < sizes.length; i += 1) {
      const ratio = sizes[i] / sizes[i - 1];
      expect(ratio).toBeGreaterThan(1.1);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it('keeps motion between 150 and 250 ms and respects reduced motion', () => {
    const ms = parseInt(token('motion'), 10);
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(250);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).not.toMatch(/@keyframes/);
  });

  it('styles what the browser draws', () => {
    expect(css).toMatch(/::selection/);
    expect(css).toMatch(/caret-color/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/tabular-nums/);
  });

  it('has hover, active, disabled, busy, and invalid states on controls', () => {
    expect(css).toMatch(/\.btn-primary:hover/);
    expect(css).toMatch(/\.btn-primary:active/);
    expect(css).toMatch(/\.btn:disabled/);
    expect(css).toMatch(/\.btn\[aria-busy='true'\]/);
    expect(css).toMatch(/\[aria-invalid='true'\]/);
  });

  it('stacks tables and collapses navigation on narrow screens', () => {
    expect(css).toMatch(/max-width:\s*719px/);
    expect(css).toMatch(/attr\(data-label\)/);
    expect(css).toMatch(/\.nav-toggle/);
  });
});

describe('fonts', () => {
  it('come from @fontsource latin subsets', () => {
    expect(mainSource).toMatch(/@fontsource\/lato\/latin-400\.css/);
    expect(mainSource).toMatch(/@fontsource\/montserrat\/latin-400\.css/);
    expect(mainSource).toMatch(/@fontsource\/montserrat\/latin-800\.css/);
    expect(token('font-heading')).toMatch(/^'Montserrat'/);
    expect(token('font-body')).toMatch(/^'Lato'/);
  });
});
