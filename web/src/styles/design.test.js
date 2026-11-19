import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const tokens = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');
const mainSource = readFileSync(join(SRC, 'main.jsx'), 'utf8');

// ---------- Reading the tokens ----------

function token(name) {
  const match = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token ${name}`);
  return match[1].trim();
}

// Follows var(--other) until a value that is not a reference.
function resolve(name) {
  const value = token(name);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(ref[1]) : value;
}

const c = (name) => {
  const value = resolve(`color-${name}`).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(value)) throw new Error(`color-${name} is not a six-digit hex: ${value}`);
  return value;
};

function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The color halfway between two hex colors, for the middle of a gradient.
function mix(a, b) {
  const part = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const channels = [0, 1, 2].map((i) => Math.round((part(a, i) + part(b, i)) / 2));
  return `#${channels.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Reading the rules of app.css ----------

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector
    .split(',')
    .map((part) => part.trim().replace(/^@media[^{]*\{\s*/, ''))
    .filter(Boolean),
  body,
}));

const rulesFor = (selector) => rules.filter((rule) => rule.selectors.includes(selector));
const declares = (rule, pattern) => pattern.test(rule.body);

// True when a rule for the selector sets a height of at least 2.75rem.
function hasTouchTarget(selector) {
  return rulesFor(selector).some((rule) => {
    const match = rule.body.match(/(?:min-)?height:\s*([^;]+);/);
    if (!match) return false;
    const value = match[1].trim();
    return value === 'var(--target)' || (value.endsWith('rem') && parseFloat(value) >= 2.75);
  });
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('theme tokens', () => {
  it('holds the palette of the brief', () => {
    expect(c('purple-950')).toBe('#1E0F52');
    expect(c('purple-900')).toBe('#2A1466');
    expect(c('purple-700')).toBe('#482494');
    expect(c('purple-500')).toBe('#6E4FC9');
    expect(c('purple-100')).toBe('#ECE7F8');
    expect(c('purple-50')).toBe('#F6F4FC');
    expect(c('turquoise-500')).toBe('#18E4DC');
    expect(c('turquoise-700')).toBe('#0A8E88');
    expect(c('turquoise-100')).toBe('#DDFBF9');
    expect(c('on-turquoise')).toBe('#0B2A28');
    expect(c('magenta-600')).toBe('#D800B0');
    expect(c('magenta-100')).toBe('#FBE1F6');
    expect(c('ink')).toBe('#1B1535');
    expect(c('ink-muted')).toBe('#5C5778');
    expect(c('line')).toBe('#E4DFF2');
    expect(c('white')).toBe('#FFFFFF');
  });

  it('defines each token once, and each palette color once', () => {
    const definitions = [...tokens.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => ({
      name,
      value: value.trim(),
    }));
    const names = definitions.map((entry) => entry.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    const hexes = definitions.filter((entry) => /^#[0-9A-Fa-f]{6}$/.test(entry.value)).map((entry) => entry.value.toUpperCase());
    expect(hexes.filter((hex, index) => hexes.indexOf(hex) !== index)).toEqual([]);
  });

  it('defines the brand gradient from purple 700 to magenta 600 at 135 degrees', () => {
    expect(token('gradient-brand')).toBe(
      'linear-gradient(135deg, var(--color-purple-700), var(--color-magenta-600))',
    );
  });

  it('keeps every color in tokens.css', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);
    const code = sourceFiles(SRC).filter((path) => /\.(jsx?|html)$/.test(path) && !/\.test\./.test(path));
    for (const path of code) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(text, path).not.toMatch(/\bstyle=\{\{/);
    }
  });

  it('keeps the brand gradient to the welcome band and the sign-in panel', () => {
    const users = rules.filter((rule) => rule.body.includes('--gradient-brand'));
    expect(users.flatMap((rule) => rule.selectors).sort()).toEqual(['.login-band', '.welcome-band']);
    // The only other gradient is the loading shimmer, which has no brand colors.
    const others = rules.filter((rule) => /linear-gradient/.test(rule.body));
    expect(others.flatMap((rule) => rule.selectors)).toEqual(['.skeleton-block']);
  });
});

describe('text contrast (4.5:1)', () => {
  const pairs = [
    ['ink', 'bg'],
    ['ink', 'surface'],
    ['ink', 'surface-muted'],
    ['ink', 'turquoise-100'],
    ['ink', 'magenta-100'],
    ['ink', 'line'],
    ['ink-muted', 'bg'],
    ['ink-muted', 'surface'],
    ['ink-muted', 'surface-muted'],
    ['ink-muted', 'turquoise-100'],
    ['heading', 'bg'],
    ['heading', 'surface'],
    ['heading', 'surface-muted'],
    ['heading', 'line'],
    ['primary', 'bg'],
    ['primary', 'surface'],
    ['primary', 'surface-muted'],
    ['primary-hover', 'surface-muted'],
    ['purple-700', 'white'],
    ['purple-700', 'purple-100'],
    ['purple-900', 'purple-100'],
    ['on-primary', 'primary'],
    ['on-primary', 'primary-hover'],
    ['white', 'purple-950'],
    ['white', 'purple-900'],
    ['white', 'purple-700'],
    ['on-dark-muted', 'purple-950'],
    ['on-dark-muted', 'purple-900'],
    ['turquoise-500', 'purple-950'],
    ['turquoise-500', 'purple-900'],
    ['turquoise-500', 'purple-700'],
    ['on-turquoise', 'turquoise-500'],
    ['turquoise-800', 'surface'],
    ['turquoise-800', 'bg'],
    ['turquoise-800', 'turquoise-100'],
    ['success-text', 'success-surface'],
    ['magenta-800', 'surface'],
    ['magenta-800', 'bg'],
    ['magenta-800', 'magenta-100'],
    ['danger-text', 'danger-surface'],
    ['white', 'magenta-600'],
    ['on-gradient', 'purple-700'],
    ['on-gradient', 'magenta-600'],
    ['selection-text', 'selection-bg'],
    // K-31: the chat bubble of the user, the video stage, and the selected audit row.
    ['on-dark-muted', 'purple-700'],
    ['ink', 'purple-100'],
    ['ink-muted', 'purple-100'],
    ['primary', 'purple-100'],
    ['primary', 'line'],
    ['turquoise-800', 'surface-muted'],
  ];
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text readable on the whole brand gradient', () => {
    const middle = mix(c('purple-700'), c('magenta-600'));
    expect(contrast(c('on-gradient'), middle)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('turquoise rules', () => {
  it('is far too light to be text on a light surface', () => {
    expect(contrast(c('turquoise-500'), c('white'))).toBeLessThan(2);
    expect(contrast(c('turquoise-500'), c('bg'))).toBeLessThan(2);
  });

  it('is text or an icon only on dark purple', () => {
    const asText = rules.filter((rule) => declares(rule, /(?:^|[;\s])color:\s*var\(--color-turquoise-500\)/));
    expect(asText.flatMap((rule) => rule.selectors).sort()).toEqual([
      '.logotype-seven',
      ".side-link[aria-current='page'] .icon",
      '.stage-icon',
    ]);
  });

  it('is a fill with the dark text on turquoise', () => {
    for (const selector of ['.avatar-turquoise', '.stat-icon-turquoise']) {
      const rule = rulesFor(selector)[0];
      expect(rule.body).toMatch(/background:\s*var\(--color-turquoise-500\)/);
      expect(rule.body).toMatch(/color:\s*var\(--color-on-turquoise\)/);
    }
  });

  it('does not carry small text in turquoise 700, which is about 4:1 on white', () => {
    expect(contrast(c('turquoise-700'), c('white'))).toBeLessThan(4.5);
    expect(contrast(c('turquoise-700'), c('white'))).toBeGreaterThanOrEqual(3);
    const asText = rules.filter((rule) => declares(rule, /(?:^|[;\s])color:\s*var\(--color-turquoise-700\)/));
    expect(asText).toEqual([]);
  });
});

describe('graphics contrast (3:1)', () => {
  const pairs = [
    ['focus', 'surface'],
    ['focus', 'bg'],
    ['focus', 'surface-muted'],
    ['focus', 'turquoise-100'],
    ['focus-on-dark', 'purple-950'],
    ['focus-on-dark', 'purple-900'],
    ['white', 'purple-700'],
    ['white', 'magenta-600'],
    ['control-border', 'surface'],
    ['control-border', 'bg'],
    ['turquoise-700', 'surface'],
    ['turquoise-700', 'turquoise-100'],
    ['turquoise-700', 'surface-muted'],
    ['purple-500', 'surface'],
    ['ink-muted', 'surface'],
    ['on-dark-muted', 'purple-950'],
    ['turquoise-500', 'purple-950'],
    ['magenta-600', 'magenta-100'],
    // K-31: the stage icon and the pulse on the video stage, and the connection dots.
    ['turquoise-500', 'purple-900'],
    ['magenta-600', 'surface'],
    ['purple-500', 'bg'],
    ['turquoise-700', 'bg'],
  ];
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('shape, type, and motion tokens', () => {
  it('uses the radii of the brief', () => {
    expect(token('radius-card')).toBe('16px');
    expect(token('radius-control')).toBe('12px');
    expect(token('radius-pill')).toBe('999px');
  });

  it('has two soft shadow levels with offset and blur', () => {
    const shadows = [...tokens.matchAll(/--shadow-([a-z]+):\s*(-?\d+)(?:px)?\s+(-?\d+)px\s+(\d+)px/g)];
    expect(shadows.map((match) => match[1]).sort()).toEqual(['raised', 'soft']);
    for (const [, , , offsetY, blur] of shadows) {
      expect(Number(offsetY)).toBeGreaterThan(0);
      expect(Number(blur)).toBeGreaterThanOrEqual(8);
    }
  });

  it('uses a fixed rem type scale with a ratio of 1.2, and 44px targets', () => {
    expect(css).not.toMatch(/clamp\(/);
    expect(css).not.toMatch(/font-size:[^;]*v[wh]\b/);
    expect(token('target')).toBe('2.75rem');
    expect(token('measure')).toBe('70ch');
    const sizes = ['text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'].map((name) =>
      parseFloat(token(name)),
    );
    for (let i = 1; i < sizes.length; i += 1) {
      const ratio = sizes[i] / sizes[i - 1];
      expect(ratio).toBeGreaterThan(1.15);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it('keeps motion between 150 and 200 ms', () => {
    const ms = parseInt(token('motion'), 10);
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(200);
    expect(css).not.toMatch(/transition:\s*all\b/);
  });
});

describe('css rules', () => {
  it('has no gradient text, glass, or colored side borders', () => {
    expect(css).not.toMatch(/background-clip:\s*text/);
    expect(css).not.toMatch(/text-fill-color/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/filter:\s*blur/);
    expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\b/);
  });

  it('uses soft shadows with a blur, never a hard offset shadow', () => {
    expect(css).not.toMatch(/box-shadow:\s*-?\d+px\s+-?\d+px\s+0\s/);
    expect(css).not.toMatch(/box-shadow:\s*-?\d+px\s+-?\d+px\s+0[;,]/);
  });

  it('animates only the loading shimmer and the waiting pulse, and stops both under reduced motion', () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]).sort();
    expect(names).toEqual(['pulse', 'shimmer']);
    const used = [...css.matchAll(/(?:^|[;\s{])animation:\s*([\w-]+)/g)].map((match) => match[1]);
    for (const name of used.filter((value) => value !== 'none')) expect(['pulse', 'shimmer']).toContain(name);
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*$/);
    expect(reduced).not.toBeNull();
    expect(reduced[0]).toMatch(/animation:\s*none\s*!important/);
    expect(reduced[0]).toMatch(/transition:\s*none\s*!important/);
  });

  it('styles what the browser draws', () => {
    expect(css).toMatch(/::selection/);
    expect(css).toMatch(/caret-color/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/tabular-nums/);
  });

  it('draws a 3px focus ring', () => {
    const ring = rulesFor(':focus-visible')[0];
    expect(ring.body).toMatch(/outline:\s*3px solid/);
  });

  it('has hover, active, disabled, busy, and invalid states on controls', () => {
    expect(css).toMatch(/\.btn-primary:hover/);
    expect(css).toMatch(/\.btn-primary:active/);
    expect(css).toMatch(/\.btn-secondary:hover/);
    expect(css).toMatch(/\.btn:disabled/);
    expect(css).toMatch(/\.btn\[aria-busy='true'\]/);
    expect(css).toMatch(/\[aria-invalid='true'\]/);
    expect(css).toMatch(/\.chip-filter\[aria-pressed='true'\]/);
    expect(css).toMatch(/\.segmented-item\[aria-pressed='true'\]/);
  });

  it('keeps every control at 44px or more', () => {
    const selectors = [
      '.btn',
      '.chip-filter',
      '.segmented-item',
      '.side-link',
      '.signout',
      '.quick-action',
      '.mini-link',
      '.week-item',
      '.input',
      '.brand',
      '.appt-time',
      '.row-open',
      '.icon-btn',
    ];
    for (const selector of selectors) expect(hasTouchTarget(selector), selector).toBe(true);
  });

  it('stacks tables under 720px, and moves the navigation to the bottom under 960px', () => {
    expect(css).toMatch(/max-width:\s*719px/);
    expect(css).toMatch(/attr\(data-label\)/);
    expect(css).toMatch(/min-width:\s*960px/);
    expect(rulesFor('.side-nav')[0].body).toMatch(/position:\s*fixed/);
    expect(rulesFor('.side-nav')[0].body).toMatch(/bottom:\s*0/);
  });

  it('puts the active indicator on the navigation, in turquoise', () => {
    const indicator = rulesFor(".side-link[aria-current='page']::before")[0];
    expect(indicator.body).toMatch(/background:\s*var\(--color-turquoise-500\)/);
  });
});

describe('screens of K-31', () => {
  it('stacks the video above the chat, and makes the chat a rail from 1100px', () => {
    const [base, ...rest] = rulesFor('.appt-workspace');
    expect(base.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(rest).toHaveLength(1);
    expect(rest[0].body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 23rem;/);
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*\.appt-workspace/);
  });

  it('draws the video stage at 16:9 and fills it with the frame', () => {
    expect(rulesFor('.video-stage')[0].body).toMatch(/aspect-ratio:\s*16 \/ 9/);
    const frame = rulesFor('.video-frame')[0].body;
    expect(frame).toMatch(/position:\s*absolute/);
    expect(frame).toMatch(/inset:\s*0/);
    // A box with a preferred ratio can only grow with its content when it does not clip.
    expect(rulesFor('.video-stage')[0].body).not.toMatch(/overflow:\s*hidden/);
  });

  it('keeps the text on the video stage white or tinted, and the turquoise to icons and dots', () => {
    expect(rulesFor('.video-stage')[0].body).toMatch(/background:\s*var\(--color-purple-950\)/);
    expect(rulesFor('.stage-title')[0].body).toMatch(/color:\s*var\(--color-white\)/);
    expect(rulesFor('.stage-text')[0].body).toMatch(/color:\s*var\(--color-on-dark-muted\)/);
    expect(rulesFor('.stage-icon')[0].body).toMatch(/background:\s*var\(--color-purple-900\)/);
    expect(rulesFor('.video-stage .pulse-dot')[0].body).toMatch(/background:\s*var\(--color-turquoise-500\)/);
  });

  it('puts the white controls on the stage and gives them the focus ring of dark surfaces', () => {
    expect(rulesFor('.video-stage :focus-visible')[0].body).toMatch(/outline-color:\s*var\(--color-focus-on-dark\)/);
    expect(rulesFor('.video-stage .alert :focus-visible')[0].body).toMatch(/outline-color:\s*var\(--color-focus\)/);
  });

  it('shows the bubbles of the user on purple 700 with white text and tinted time', () => {
    const own = rulesFor('.chat-item-own .chat-bubble')[0].body;
    expect(own).toMatch(/background:\s*var\(--color-purple-700\)/);
    expect(own).toMatch(/color:\s*var\(--color-white\)/);
    expect(rulesFor('.chat-item-own .chat-meta')[0].body).toMatch(/color:\s*var\(--color-on-dark-muted\)/);
  });

  it('marks the connection with a dot, and pulses only while connecting', () => {
    expect(rulesFor('.conn-connecting')[0].body).toMatch(/animation:\s*pulse\b/);
    for (const selector of ['.conn-open', '.conn-closed', '.conn-dot']) {
      expect(rulesFor(selector)[0].body, selector).not.toMatch(/animation/);
    }
  });

  it('stacks the new appointment form, and puts the summary beside it from 1100px', () => {
    expect(rulesFor('.sched')[0].body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(rulesFor('.sched')[1].body).toMatch(/grid-template-areas/);
    expect(rulesFor('.sched-summary')[0].body).toMatch(/position:\s*sticky/);
    expect(rulesFor('.field-pair')[0].body).toMatch(/minmax\(0, 1fr\);/);
    expect(rulesFor('.field-pair')[1].body).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('keeps the header of the audit table in view and the detail beside it from 1100px', () => {
    const header = rulesFor('.table-scroll thead th')[0].body;
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
    expect(rulesFor('.table-scroll .table')[0].body).toMatch(/border-collapse:\s*separate/);
    expect(rulesFor('.audit-detail')[0].body).toMatch(/position:\s*sticky/);
    expect(rulesFor('.audit-layout.has-detail')[0].body).toMatch(/22rem/);
  });

  it('does not use the brand gradient or a colored border on the new cards', () => {
    for (const selector of ['.appt-head', '.video-card', '.chat-card', '.sched-summary', '.audit-detail', '.sheet']) {
      for (const rule of rulesFor(selector)) {
        expect(rule.body, selector).not.toMatch(/gradient/);
        expect(rule.body, selector).not.toMatch(/border-(left|right)/);
      }
    }
  });
});

describe('fonts', () => {
  it('come from @fontsource latin subsets, in the weights of the brief', () => {
    expect(mainSource).toMatch(/@fontsource\/lato\/latin-400\.css/);
    expect(mainSource).toMatch(/@fontsource\/lato\/latin-700\.css/);
    expect(mainSource).toMatch(/@fontsource\/montserrat\/latin-700\.css/);
    expect(mainSource).toMatch(/@fontsource\/montserrat\/latin-800\.css/);
    expect(mainSource).not.toMatch(/montserrat\/latin-(400|500|600)\.css/);
    expect(token('font-heading')).toMatch(/^'Montserrat'/);
    expect(token('font-body')).toMatch(/^'Lato'/);
  });

  it('use only the weights that are loaded', () => {
    const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map((match) => match[1]);
    for (const weight of weights) expect(['400', '700', '800']).toContain(weight);
  });

  it('never asks a remote server for a font or an image, and holds no logo file', () => {
    expect(css).not.toMatch(/url\(/);
    expect(css).not.toMatch(/@import/);
    const publicDir = join(SRC, '..', 'public');
    const files = [...sourceFiles(SRC), ...(existsSync(publicDir) ? sourceFiles(publicDir) : [])];
    expect(files.filter((path) => /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(path))).toEqual([]);
  });
});


describe('screens of K-32', () => {
  it('shows the short label of the new appointment below 960px, and the full label from 960px', () => {
    expect(css).toMatch(/@media \(max-width: 959px\) \{\s*\.side-link\[data-short\] > span/);
    expect(css).toMatch(/\.side-link\[data-short\]::after \{\s*content: attr\(data-short\)/);
    expect(rulesFor('.side-link[data-short] > span')[0].body).toMatch(/display:\s*none/);
  });

  it('keeps each time of the list on one line', () => {
    expect(rulesFor('.appt-table .appt-time')[0].body).toMatch(/white-space:\s*nowrap/);
    expect(rulesFor('.appt-table .cell-end')[0].body).toMatch(/white-space:\s*nowrap/);
  });

  it('truncates a long identifier in the list with an ellipsis, and keeps the page from widening', () => {
    const body = rulesFor('.appt-table .person-id')[0].body;
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/max-width:\s*8rem/);
  });
});


describe('appointment list of K-33', () => {
  const appointmentsSource = readFileSync(join(SRC, 'pages', 'Appointments.jsx'), 'utf8');
  // The block that applies from 720 to 1099 px. Its closing brace is the first "}" at the start of a line.
  const rangeMatch = css.match(/@media \(min-width: 720px\) and \(max-width: 1099px\) \{([\s\S]*?)\n\}/);
  const range = rangeMatch ? rangeMatch[1] : '';
  const rangeRules = [...range.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
  // The block that hides the Ends column. Since K-34 it applies from 720 to 1199 px.
  const hideMatch = css.match(/@media \(min-width: 720px\) and \(max-width: 1199px\) \{([\s\S]*?)\n\}/);

  it('marks the Ends header and cells with the col-ends class, and keeps the Actions column last', () => {
    expect(appointmentsSource).toMatch(/<th scope="col" className="col-ends">\s*Ends\s*<\/th>/);
    expect(appointmentsSource).toMatch(/<td data-label="Ends" className="cell-end col-ends">/);
    expect(appointmentsSource.match(/col-ends/g)).toHaveLength(2);
    expect(appointmentsSource.indexOf('data-label="Actions"')).toBeGreaterThan(appointmentsSource.indexOf('data-label="Ends"'));
  });

  it('hides the Ends column with CSS, and not with the hidden attribute or an inline style', () => {
    expect(hideMatch, 'the 720 to 1199 px block exists').not.toBeNull();
    expect(hideMatch[1]).toMatch(/\.appt-table \.col-ends\s*\{\s*display:\s*none;\s*\}/);
    expect(appointmentsSource).not.toMatch(/\shidden[\s/>=]/);
    expect(appointmentsSource).not.toMatch(/style=\{\{/);
  });

  it('applies the hiding only from 720 to 1199 px, so the stacked layout keeps every column', () => {
    const outside = css.replace(hideMatch[0], '');
    const hides = [...outside.matchAll(/\.col-ends\s*\{[^}]*display:\s*none/g)];
    expect(hides).toEqual([]);
    expect(css).toMatch(/@media \(max-width: 719px\) \{/);
  });

  it('tightens the horizontal padding of the list cells in the same range', () => {
    const cells = rangeRules.find(
      (rule) => rule.selector.split(',').map((part) => part.trim()).join(',') === '.appt-table th,.appt-table td',
    );
    expect(cells, 'the padding rule is in the range').toBeDefined();
    expect(cells.body).toMatch(/padding-left:\s*var\(--space-2\)/);
    expect(cells.body).toMatch(/padding-right:\s*var\(--space-2\)/);
  });

  it('keeps the wrapper scroll as a fallback; jsdom cannot measure the fit, so the project manager checks it in a browser', () => {
    // jsdom does not lay out tables, so this test checks the rules that make the fit possible.
    // The project manager measures the fit in a real browser.
    expect(rulesFor('.table-wrap')[0].body).toMatch(/overflow-x:\s*auto/);
    expect(range).not.toMatch(/\.table-wrap/);
  });
});



describe('appointment list of K-34', () => {
  // jsdom does not lay out tables, so these tests check the media-query rules only. The
  // widths in the project manager's browser measurements are not tested here.
  const hideMatch = css.match(/@media \(min-width: 720px\) and \(max-width: 1199px\) \{([\s\S]*?)\n\}/);
  const avatarMatch = css.match(/@media \(min-width: 960px\) and \(max-width: 1019px\) \{([\s\S]*?)\n\}/);
  const stackedMatch = css.match(/@media \(max-width: 719px\) \{([\s\S]*?)\n\}/);

  it('hides the Ends column from 720 px to 1199 px, and shows it again from 1200 px', () => {
    expect(hideMatch, 'the 720 to 1199 px block exists').not.toBeNull();
    expect(hideMatch[1]).toMatch(/\.appt-table \.col-ends\s*\{\s*display:\s*none;\s*\}/);
    // No other block hides the column, so from 1200 px nothing removes it.
    expect(css.replace(hideMatch[0], '')).not.toMatch(/\.col-ends\s*\{[^}]*display:\s*none/);
  });

  it('hides the avatars of the Professional and Client cells only from 960 px to 1019 px', () => {
    expect(avatarMatch, 'the 960 to 1019 px block exists').not.toBeNull();
    expect(avatarMatch[1]).toMatch(/\.appt-table \.person \.avatar\s*\{\s*display:\s*none;\s*\}/);
    // The avatar rule appears in no other block.
    expect(css.replace(avatarMatch[0], '')).not.toMatch(/\.person \.avatar/);
  });

  it('keeps the stacked layout under 720 px and the wrapper scroll as a fallback', () => {
    expect(stackedMatch, 'the stacked block exists').not.toBeNull();
    expect(stackedMatch[1]).toMatch(/\.table td::before\s*\{[^}]*attr\(data-label\)/);
    expect(stackedMatch[1]).not.toMatch(/col-ends|avatar/);
    expect(rulesFor('.table-wrap')[0].body).toMatch(/overflow-x:\s*auto/);
  });
});
