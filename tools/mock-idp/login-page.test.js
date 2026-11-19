'use strict';

// The sign-in page of the mock identity provider is a design of its own: it has no access to
// the web client, so it repeats the palette. These tests check what the web tests check for the
// client: contrast, the palette against tokens.css, no outside resource, and the size of the
// targets. They also hold the markup that other code reads.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createMockIdp } = require('./server');

const PUBLIC = 'https://demo.example.test/idp';
const CALLBACK = 'https://demo.example.test/api/auth/callback';
const CLIENT_ID = 'doctor7-demo';
const TOKENS = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'styles', 'tokens.css'), 'utf8');

const verifier = () => crypto.randomBytes(32).toString('base64url');
const challenge = (value) => crypto.createHash('sha256').update(value, 'ascii').digest('base64url');

function authorizeParams() {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    scope: 'openid email profile',
    state: 'state-value-123',
    nonce: 'nonce-value-123',
    code_challenge: challenge(verifier()),
    code_challenge_method: 'S256',
  });
}

// Loads the page the way a browser does. Returns the HTML and the headers.
async function loadPage(options = {}) {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [CALLBACK], publicUrl: PUBLIC, ...options }).start();
  try {
    const res = await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`);
    return { status: res.status, html: await res.text(), headers: res.headers };
  } finally {
    await idp.close();
  }
}

// ---------- Reading the style of the page ----------

function styleOf(html) {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(match, 'the page has a style block');
  return match[1];
}

function variables(css) {
  const root = /:root\{([^}]*)\}/.exec(css);
  assert.ok(root, 'the style has a :root block');
  const found = {};
  for (const [, name, value] of root[1].matchAll(/--([\w-]+):([^;]+)(?:;|$)/g)) found[name] = value.trim();
  return found;
}

// The declarations of every rule whose selector list holds `selector`. The style is written without
// nested blocks except @media, which this reads too, so a selector may have several bodies.
function bodiesOf(css, selector) {
  const out = [];
  for (const [, list, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (list.split(',').map((part) => part.trim()).includes(selector)) out.push(body);
  }
  return out;
}

// ---------- Contrast ----------

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

function mix(a, b) {
  const part = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const channels = [0, 1, 2].map((i) => Math.round((part(a, i) + part(b, i)) / 2));
  return `#${channels.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const tokenValue = (name) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6});`).exec(TOKENS);
  assert.ok(match, `tokens.css has ${name}`);
  return match[1].toUpperCase();
};

// ---------- Tests ----------

test('the page answers 200 in English, with the viewport and the policy of the provider', async () => {
  const { status, html, headers } = await loadPage();
  assert.equal(status, 200);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.equal(
    headers.get('content-security-policy'),
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
  );
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

test('the colors of the page are the colors of tokens.css', async () => {
  const { html } = await loadPage();
  const page = variables(styleOf(html));
  const pairs = {
    'purple-950': 'color-purple-950',
    'purple-900': 'color-purple-900',
    'purple-700': 'color-purple-700',
    'purple-500': 'color-purple-500',
    'purple-100': 'color-purple-100',
    'purple-50': 'color-purple-50',
    'turquoise-500': 'color-turquoise-500',
    'on-turquoise': 'color-on-turquoise',
    'magenta-600': 'color-magenta-600',
    'magenta-800': 'color-magenta-800',
    'magenta-100': 'color-magenta-100',
    ink: 'color-ink',
    muted: 'color-ink-muted',
    line: 'color-line',
    white: 'color-white',
    'on-dark-muted': 'color-on-dark-muted',
  };
  for (const [mine, theirs] of Object.entries(pairs)) {
    assert.equal(String(page[mine]).toUpperCase(), tokenValue(theirs), `${mine} differs from ${theirs}`);
  }
  assert.equal(page.gradient, 'linear-gradient(135deg,var(--purple-700),var(--magenta-600))');
});

test('every text pair of the page has a contrast of 4.5:1, and every graphic pair 3:1', async () => {
  const { html } = await loadPage();
  const v = Object.fromEntries(Object.entries(variables(styleOf(html))).map(([k, x]) => [k, x.toUpperCase()]));
  const text = [
    ['ink', 'purple-50'], // body
    ['ink', 'white'], // account name
    ['ink', 'magenta-100'], // the notice
    ['muted', 'white'], // e-mail address of an account
    ['muted', 'purple-50'], // the last paragraph
    ['purple-900', 'purple-50'], // heading
    ['purple-700', 'purple-100'], // role chip
    ['ink', 'line'], // role chip of an account with no access
    ['magenta-800', 'magenta-100'], // "Demonstration only."
    ['white', 'purple-700'], // button, left panel
    ['white', 'purple-900'], // button on hover
    ['white', 'purple-950'], // button when pressed, avatar of the administrator
    ['white', 'purple-500'], // avatar of the auditor
    ['white', 'magenta-600'], // the end of the gradient
    ['on-turquoise', 'turquoise-500'], // avatar of the client
    ['ink', 'purple-100'], // avatar of an account with no access
    ['turquoise-500', 'purple-700'], // the 7 of the logotype
    ['turquoise-500', 'purple-950'], // the dot of the glyph
    ['ink', 'purple-100'], // selected text
  ];
  for (const [fg, bg] of text) {
    assert.ok(contrast(v[fg], v[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(v[fg], v[bg]).toFixed(2)}`);
  }
  const middle = mix(v['purple-700'], v['magenta-600']);
  assert.ok(contrast(v.white, middle) >= 4.5, `white on the middle of the gradient: ${contrast(v.white, middle).toFixed(2)}`);

  const graphics = [
    ['purple-500', 'white'], // focus ring on cards
    ['purple-500', 'purple-50'], // focus ring on the canvas
    ['magenta-600', 'magenta-100'], // border of the notice
    ['magenta-800', 'magenta-100'], // icon of the notice
  ];
  for (const [fg, bg] of graphics) {
    assert.ok(contrast(v[fg], v[bg]) >= 3, `${fg} on ${bg}: ${contrast(v[fg], v[bg]).toFixed(2)}`);
  }
});

test('the page has a left panel with the gradient, and the gradient is used only there', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.ok(bodiesOf(css, '.band')[0].includes('background:var(--gradient)'));
  const users = [...css.matchAll(/([^{}@]+)\{([^{}]*var\(--gradient\)[^{}]*)\}/g)].map(([, list]) => list.trim());
  assert.deepEqual(users, ['.band']);
  assert.doesNotMatch(css, /background-clip\s*:\s*text/);
  assert.doesNotMatch(css, /text-fill-color/);
});

test('the left panel holds the typographic logotype with the 7 in turquoise, the glyph, and a message', async () => {
  const { html } = await loadPage();
  const band = /<div class="band">([\s\S]*?)<\/div>\s*<main/.exec(html);
  assert.ok(band, 'the left panel comes before the main part');
  assert.match(band[1], /<span class="logotype">Doctor<span class="logotype-seven">7<\/span><\/span>/);
  assert.match(band[1], /<svg class="glyph"[^>]*aria-hidden="true"/);
  assert.match(band[1], /Psychological care that your clinic runs on its own server\./);
  assert.ok(bodiesOf(styleOf(html), '.logotype-seven')[0].includes('color:var(--turquoise-500)'));
  assert.doesNotMatch(html, /xmlns/);
});

test('the notice "Demonstration only." is visible, before the accounts, and in the spark color', async () => {
  const { html } = await loadPage();
  const notice = html.indexOf('<div class="notice" role="note">');
  assert.ok(notice > 0, 'the notice exists');
  assert.ok(notice < html.indexOf('<form '), 'the notice comes before the form');
  assert.match(html, /<strong>Demonstration only\.<\/strong> These are synthetic demonstration accounts\./);
  const css = styleOf(html);
  assert.ok(bodiesOf(css, '.notice')[0].includes('background:var(--magenta-100)'));
  assert.ok(bodiesOf(css, '.notice strong')[0].includes('color:var(--magenta-800)'));
  for (const selector of ['.notice', '.notice p', '.notice strong']) {
    for (const body of bodiesOf(css, selector)) assert.doesNotMatch(body, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\b/);
  }
});

test('each account is a card with initials, the name, a role chip, the e-mail address, and the button', async () => {
  const { html } = await loadPage();
  const cards = html.split('<li class="account">').slice(1).map((part) => part.split('</li>')[0]);
  assert.equal(cards.length, 6);
  const ana = cards.find((card) => card.includes('ana.rivera@example.test'));
  assert.match(ana, /<span class="avatar avatar-professional" aria-hidden="true">AR<\/span>/);
  assert.match(ana, /<p class="account-name">Ana Rivera<\/p>/);
  assert.match(ana, /<span class="role">Professional<\/span> <span>ana\.rivera@example\.test<\/span>/);
  assert.match(ana, /<button type="submit" name="user" value="mock-ana">Sign in as Ana Rivera<\/button>/);
  const norole = cards.find((card) => card.includes('no.role@example.test'));
  assert.match(norole, /<span class="avatar avatar-none" aria-hidden="true">NR<\/span>/);
  assert.match(norole, /<span class="role role-none">No access<\/span> <span>no\.role@example\.test<\/span>/);
  // The initials are hidden from assistive technology, and the name carries the meaning.
  for (const card of cards) assert.match(card, /<span class="avatar avatar-\w+" aria-hidden="true">[A-Z0-9?]{1,2}<\/span>/);
});

test('the markup that the smoke script reads is unchanged', async () => {
  const { html } = await loadPage();
  const form = /<form\b[^>]*\baction="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  assert.equal(form[1], `${PUBLIC}/authorize`);
  const fields = [...form[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((match) => match[1]);
  assert.deepEqual(fields, [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
  ]);
  const block = form[2].split('<li class="account">').slice(1).find((item) => item.includes('<span>luis.mora@example.test</span>'));
  assert.match(block, /<button[^>]*\bname="user" value="mock-luis"/);
});

test('the initials come from the first and last word, or from the first two letters', async () => {
  const users = [
    { sub: 'mock-a', name: 'Madonna', email: 'a@example.test', emailVerified: true },
    { sub: 'mock-b', name: 'Mary Ann de la Cruz', email: 'b@example.test', emailVerified: true },
    { sub: 'mock-c', name: '<b>Bold</b>', email: 'c@example.test', emailVerified: true },
    { sub: 'mock-d', name: '   ', email: 'd@example.test', emailVerified: true },
  ];
  const { html } = await loadPage({ users });
  const initials = [...html.matchAll(/<span class="avatar avatar-\w+" aria-hidden="true">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(initials, ['MA', 'MC', 'BB', '?']);
});

test('the page asks for nothing outside itself: no link, script, image, font, frame, or address', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.doesNotMatch(css, /url\(/i);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(css, /@font-face/i);
  assert.doesNotMatch(css, /https?:/i);
  assert.doesNotMatch(html, /<(?:link|script|img|iframe|object|embed|audio|video|source|base|meta http-equiv)\b/i);
  assert.doesNotMatch(html, /\s(?:src|srcset|href|poster|data|ping)\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  // An address may only be the form action or the value of a hidden field. Both are data.
  const withoutData = html.replace(/<form\b[^>]*>/i, '<form>').replace(/<input type="hidden"[^>]*>/g, '');
  assert.doesNotMatch(withoutData, /https?:\/\//i);
  assert.doesNotMatch(withoutData, /(?:^|[^:])\/\/[\w.-]+\.[a-z]{2,}/i);
});

test('the fonts are the fonts of the system, with no named web font', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  const families = [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((match) => match[1]);
  assert.ok(families.length > 0);
  for (const family of families) {
    assert.doesNotMatch(family, /lato|montserrat|google|roboto slab|open sans/i);
    assert.match(family, /system-ui|sans-serif/);
  }
  assert.doesNotMatch(css, /font-weight\s*:\s*(?!400|700|800)\d+/);
});

test('no emoji or pictograph is used as an icon, and the page holds no logo file', async () => {
  const { html } = await loadPage();
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(html, /\.(png|jpe?g|gif|webp|svg|ico|avif)\b/i);
});

test('the button is 44 px high, has hover, pressed, and focus states, and the focus ring is 3 px', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.match(bodiesOf(css, 'button')[0], /min-height:44px/);
  assert.ok(bodiesOf(css, 'button:hover').length > 0);
  assert.ok(bodiesOf(css, 'button:active').length > 0);
  assert.match(bodiesOf(css, 'button:focus-visible')[0], /outline:3px solid var\(--purple-500\)/);
  assert.match(css, /::selection/);
  assert.match(css, /caret-color/);
});

test('motion is short, and it stops under prefers-reduced-motion', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.equal(variables(css).motion, '180ms');
  assert.doesNotMatch(css, /transition\s*:\s*all\b/);
  assert.doesNotMatch(css, /@keyframes/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/);
});

test('the style has no glass, no hard shadow, and no colored side border', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /filter\s*:\s*blur/);
  assert.doesNotMatch(css, /border-(left|right|inline-start|inline-end)\b/);
  for (const [, value] of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
    const first = /^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?/.exec(value.trim());
    if (first) assert.ok(Number(first[3]) >= 8, `a shadow with a blur of at least 8 px: ${value}`);
  }
  // The shadows are variables, so their blur is checked where they are defined.
  const vars = variables(css);
  for (const name of ['shadow', 'shadow-raised']) {
    const parts = /^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(vars[name]);
    assert.ok(parts, `${name} has an offset and a blur`);
    assert.ok(Number(parts[2]) > 0 && Number(parts[3]) >= 8, `${name} is soft: ${vars[name]}`);
  }
  for (const body of bodiesOf(css, '.account')) {
    if (body.includes('box-shadow')) assert.match(body, /box-shadow:var\(--shadow(?:-raised)?\)/);
  }
});

test('the page stacks on a narrow screen: one column, the panel on top, and two columns only from wide widths', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  assert.ok(html.indexOf('<div class="band">') < html.indexOf('<main class="wrap">'));
  assert.match(bodiesOf(css, '.accounts')[0], /grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(bodiesOf(css, '.band')[0], /\bheight\s*:/);
  assert.match(css, /@media \(min-width:860px\)\{\.page\{grid-template-columns:2fr 3fr\}/);
});

test('the page does not mention a scheduled reset, in the visible text or in the style', async () => {
  const { html } = await loadPage();
  assert.doesNotMatch(html, /reset/i);
});


// ---------- The account cards (K-32) ----------

test('every account card has the same header: avatar, name, then the role chip and the e-mail address', async () => {
  const { html } = await loadPage();
  const cards = [...html.matchAll(/<li class="account">([\s\S]*?)<\/li>/g)].map(([, card]) => card);
  assert.equal(cards.length, 6, 'one card for each synthetic account');
  for (const card of cards) {
    assert.match(
      card,
      /^<span class="avatar avatar-[a-z]+" aria-hidden="true">[A-Z0-9?]+<\/span><p class="account-name">[^<]+<\/p><p class="account-meta"><span class="role[^"]*">[^<]+<\/span> <span>[^<]+<\/span><\/p><button /,
    );
  }
});

test('the header of each card starts at the top, and the role chip has a line of its own', async () => {
  const { html } = await loadPage();
  const css = styleOf(html);
  const card = bodiesOf(css, '.account')[0];
  assert.match(card, /align-items:start/, 'the items start at the top, not in the middle of a stretched row');
  assert.match(card, /align-content:start/, 'the rows of a card do not stretch with a taller card');
  assert.match(bodiesOf(css, '.account-meta')[0], /display:grid/, 'the chip and the e-mail address take one line each');
});
