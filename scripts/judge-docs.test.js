'use strict';

// Checks of the documents that judges read: the demo address, no other real address
// in the documents, the length of the demo script, the task count and the specification
// folders of the Kiro documents, and the external forbidden-word list.
// The list is never stored in the repository (see scripts/scan-secrets.js). Without a
// list, the check that needs it is skipped with a notice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveForbiddenWordsFile, loadForbiddenWords } = require('./scan-secrets');

const ROOT = path.resolve(__dirname, '..');
const MAX_SCRIPT_SECONDS = 180;

// The public host of the demo. The only web address allowed for it is https, with no port.
// The dotted IP address of this host is not allowed anywhere; the public-IP check flags it.
const DEMO_HOST = '3-139-52-25.sslip.io';
const DEMO_URL = `https://${DEMO_HOST}`;
const DEMO_MARKER = '<DEMO_URL>';
const AVAILABILITY_LINE = 'The demo instance is available until 2027-01-29.';
const HOST_SENTENCE = 'The host `3-139-52-25.sslip.io` is the public host of the demo.';
const JUDGE_DOCS = ['README.md', 'docs/SUBMISSION.md', 'docs/DEMO-SCRIPT.md'];

// Hosts that may appear in a web address of the documents:
//   - names under example.test and the reserved .example, localhost, and loopback;
//   - placeholders such as <host> and <jitsi-host>;
//   - the Jitsi package repository;
//   - the repository site;
//   - the public endpoints of Google that the video documents name as API addresses.
// The demo host is not in this set. It is handled on its own, below.
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'download.jitsi.org',
  'github.com',
  'www.googleapis.com',
  'meet.googleapis.com',
  'meet.google.com',
]);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// README.md, docs/*.md (not nested), and everything under .kiro/.
function judgeFiles() {
  const docs = fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(ROOT, 'docs', name));
  return [path.join(ROOT, 'README.md'), ...docs, ...filesUnder(path.join(ROOT, '.kiro'))];
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// Returns null when the web address is allowed. Otherwise it returns the text that a
// report names: the host as written, with its scheme when the scheme is the problem.
function addressProblem(scheme, rawHost) {
  const host = rawHost.toLowerCase();
  if (host === '' || host.includes('<')) return null; // a bare scheme in prose, or a placeholder
  if (host === DEMO_HOST) return scheme === 'https' ? null : `${scheme}://${host}`;
  const bare = host.replace(/:\d+$/, '');
  if (bare === DEMO_HOST) return host; // the demo host with a port is another address
  if (ALLOWED_HOSTS.has(bare)) return null;
  if (bare === 'example.test' || bare.endsWith('.example.test') || bare.endsWith('.example')) return null;
  return host;
}

// Web addresses that are not allowed. The path after the host is not checked.
function foreignHosts(text) {
  return [...text.matchAll(/\b(https?):\/\/([^\s/?#`'")\]\\]*)/gi)]
    .map((m) => addressProblem(m[1].toLowerCase(), m[2]))
    .filter((problem) => problem !== null);
}

// An IPv4 address that is not private, loopback, link-local, or reserved for documentation.
function isPublicIpv4(parts) {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv4(text) {
  const found = [];
  for (const match of text.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.]*\d)/g)) {
    const parts = match.slice(1, 5).map(Number);
    if (parts.every((part) => part <= 255) && isPublicIpv4(parts)) found.push(match[0]);
  }
  return found;
}

// ---- The checks, applied to the real files ----

test('the three judge documents hold the exact demo address and no placeholder', () => {
  for (const file of JUDGE_DOCS) {
    const text = read(file);
    assert.ok(text.includes(DEMO_URL), `${file} must contain ${DEMO_URL}`);
    assert.ok(!text.includes(DEMO_MARKER), `${file} still contains ${DEMO_MARKER}`);
  }
});

test('README gives the availability line and the public-host sentence', () => {
  const text = read('README.md');
  assert.ok(text.split(/\r?\n/).includes(AVAILABILITY_LINE), `README.md must have the line "${AVAILABILITY_LINE}"`);
  assert.ok(text.includes(HOST_SENTENCE), `README.md must state "${HOST_SENTENCE}"`);
});

test('the documents and .kiro/ hold no public IP address', () => {
  const findings = [];
  for (const file of judgeFiles()) {
    read(relative(file))
      .split(/\r?\n/)
      .forEach((line, index) => {
        for (const ip of publicIpv4(line)) findings.push(`${relative(file)}:${index + 1}: ${ip}`);
      });
  }
  assert.deepEqual(findings, []);
});

test('the documents and .kiro/ hold no web address of a real demo', () => {
  const findings = [];
  for (const file of judgeFiles()) {
    read(relative(file))
      .split(/\r?\n/)
      .forEach((line, index) => {
        for (const host of foreignHosts(line)) findings.push(`${relative(file)}:${index + 1}: ${host}`);
      });
  }
  assert.deepEqual(findings, []);
});

// Segment lines look like: ### 01:10 to 01:35 (25 s): Start the video meeting
function scriptSegments(text) {
  return [...text.matchAll(/^### (\d\d):(\d\d) to (\d\d):(\d\d) \((\d+) s\): (.+)$/gm)].map((m) => ({
    title: m[6].trim(),
    start: Number(m[1]) * 60 + Number(m[2]),
    end: Number(m[3]) * 60 + Number(m[4]),
    length: Number(m[5]),
  }));
}

test('the demo script adds up to 180 seconds or less, and its own numbers agree', () => {
  const text = read('docs/DEMO-SCRIPT.md');
  const segments = scriptSegments(text);
  assert.ok(segments.length >= 5, 'the script has its segments');

  for (const segment of segments) {
    assert.equal(segment.end - segment.start, segment.length, `${segment.title}: the clock times and the length differ`);
  }
  segments.slice(1).forEach((segment, index) => {
    assert.equal(segment.start, segments[index].end, `${segment.title} does not start where the previous segment ends`);
  });

  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  assert.ok(total <= MAX_SCRIPT_SECONDS, `the script is ${total} s, the limit is ${MAX_SCRIPT_SECONDS} s`);

  assert.match(text, new RegExp(`add up to ${total} seconds`), 'the introduction states the real total');
  assert.match(text, new RegExp(`\\*\\*Total\\*\\* \\| \\*\\*${total} s\\*\\*`), 'the table states the real total');
  for (const segment of segments) {
    assert.ok(
      new RegExp(`\\| ${segment.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| ${segment.length} s \\|`).test(text),
      `the table row of "${segment.title}" is missing or differs`
    );
  }
});

// ---- The task count and the specification folders of the Kiro documents ----

const TASK_COUNT = 30;
const TASK_SENTENCE =
  '30 tasks were given to Kiro agents: K-01 to K-30 except K-15 (an internal document kept outside this repository), plus K-19b, a follow-up to K-19.';
const SPEC_SENTENCE =
  'From K-06 on, every task began with a specification in `.kiro/specs/<task>/`, except K-11, K-19b, K-25, and K-27, which have none.';
// Phrases that the documents must no longer contain.
const OLD_PHRASES = ['numbered tasks', 'each task began by writing a specification', 'each task also began with a specification'];
const KIRO_DOCS = [
  { file: 'docs/HOW-WE-USED-KIRO.md', list: /holds specifications for ([^.]+)\./ },
  { file: 'docs/SUBMISSION.md', list: /specifications in `\.kiro\/specs\/` are for ([^.]+)\./ },
];

// The folders of .kiro/specs/ whose names are k-NN, sorted.
function specFolders() {
  return fs
    .readdirSync(path.join(ROOT, '.kiro', 'specs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^k-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

test('the Kiro documents state the task count and the exceptions, and no old phrase', () => {
  for (const { file } of KIRO_DOCS) {
    const text = read(file);
    assert.ok(text.includes(TASK_SENTENCE), `${file} must state "${TASK_SENTENCE}"`);
    assert.ok(text.includes(SPEC_SENTENCE), `${file} must state "${SPEC_SENTENCE}"`);
    const counts = [...text.matchAll(/(\d+) tasks were given to Kiro agents/g)].map((m) => Number(m[1]));
    assert.deepEqual(counts, [TASK_COUNT], `${file} states another task count`);
    for (const old of OLD_PHRASES) {
      assert.ok(!text.includes(old), `${file} still states the old phrase "${old}"`);
    }
  }
});

test('the Kiro documents list the specification folders that exist in .kiro/specs/', () => {
  const folders = specFolders();
  assert.ok(folders.length > 0, 'the specification folders are present');
  for (const { file, list } of KIRO_DOCS) {
    const match = read(file).match(list);
    assert.ok(match, `${file} must list the specification folders`);
    const listed = match[1].match(/k-\d{2}/g) || [];
    assert.deepEqual([...listed].sort(), folders, `${file} differs from the folders in .kiro/specs/`);
  }
});

// ---- The external forbidden-word list ----

const LIST_FILE = resolveForbiddenWordsFile();
const LISTED = loadForbiddenWords(LIST_FILE);
const NO_LIST = LISTED.length === 0;
if (NO_LIST) {
  console.warn(
    'judge-docs: no forbidden-word list configured, so the term check is skipped. ' +
      'Set FORBIDDEN_WORDS_FILE or create scripts/forbidden-words.local.txt.'
  );
}

test('the documents and .kiro/ hold no term of the external list', { skip: NO_LIST ? 'no forbidden-word list configured' : false }, () => {
  // The report names the file and the line, never the term.
  const findings = [];
  for (const file of judgeFiles()) {
    termLines(read(relative(file)), LISTED).forEach((line) => findings.push(`${relative(file)}:${line}`));
  }
  assert.deepEqual(findings, []);
});

// Line numbers (1-based) of the lines that hold a term. Matching ignores case.
function termLines(text, terms) {
  return text
    .split(/\r?\n/)
    .map((line, index) => (terms.some((term) => line.toLowerCase().includes(term)) ? index + 1 : 0))
    .filter(Boolean);
}

test('the term check finds a term in any letter case and reports line numbers only', () => {
  assert.deepEqual(termLines('fine\nan Invented-Term here\nfine', ['invented-term']), [2]);
  assert.deepEqual(termLines('fine\nstill fine', ['invented-term']), []);
});

// ---- The checkers themselves ----

test('the address checks flag a real-looking host and a public IP, and allow the agreed ones', () => {
  const web = (host, rest = '/') => `${['https', ''].join(':')}//${host}${rest}`;
  const plain = (host) => `${['http', ''].join(':')}//${host}`;
  // The demo host: the exact address passes, and so does a path on it. A port, http, another
  // host, another sslip.io name, and the dotted IP address of the host fail.
  assert.deepEqual(foreignHosts(`open ${web(DEMO_HOST)} now`), []);
  assert.deepEqual(foreignHosts(`open ${web(DEMO_HOST, '/some/path?x=1')} now`), []);
  assert.deepEqual(foreignHosts(`open ${web(`${DEMO_HOST}:8443`)} now`), [`${DEMO_HOST}:8443`]);
  assert.deepEqual(foreignHosts(`open ${plain(DEMO_HOST)} now`), [`http://${DEMO_HOST}`]);
  assert.deepEqual(foreignHosts(`open ${web('4-5-6-7.sslip.io')} now`), ['4-5-6-7.sslip.io']);
  assert.deepEqual(foreignHosts(`open ${web(`x${DEMO_HOST}`)} now`), [`x${DEMO_HOST}`]);
  assert.deepEqual(foreignHosts(`open ${plain('3.139.52.25')} now`), ['3.139.52.25']);
  assert.deepEqual(publicIpv4('the server is 3.139.52.25'), ['3.139.52.25']);
  assert.deepEqual(foreignHosts(`see ${web('demo.some-clinic.org', '/app')}`), ['demo.some-clinic.org']);
  assert.deepEqual(foreignHosts(`see ${plain('203.0.115.9:8080')}`), ['203.0.115.9:8080']);
  assert.deepEqual(
    foreignHosts(
      [
        web('demo.example.test'),
        web('meet.demo.example.test', '/x'),
        web('jitsi.clinic.example'),
        plain('127.0.0.1:3000'),
        plain('localhost'),
        web('<host>', '/api'),
        web('download.jitsi.org'),
        'a bare `http://` or `https://` address',
      ].join(' ')
    ),
    []
  );

  assert.deepEqual(publicIpv4('server at 8.8.8.8 and 1.1.1.1'), ['8.8.8.8', '1.1.1.1']);
  assert.deepEqual(publicIpv4('local 10.0.0.5 127.0.0.1 192.168.1.4 172.16.0.1 172.31.255.1 0.0.0.0'), []);
  assert.deepEqual(publicIpv4('documentation 192.0.2.10 198.51.100.7 203.0.113.9 169.254.1.1'), []);
  assert.deepEqual(publicIpv4('172.32.0.1'), ['172.32.0.1']);
  assert.deepEqual(publicIpv4('version 1.2.3 and 1.2.3.4.5 and 999.1.1.1'), []);
});

test('the script reader finds the segments and their lengths', () => {
  const sample = '### 00:00 to 00:10 (10 s): Title\n\ntext\n\n### 00:10 to 00:25 (15 s): The idea\n';
  assert.deepEqual(scriptSegments(sample), [
    { title: 'Title', start: 0, end: 10, length: 10 },
    { title: 'The idea', start: 10, end: 25, length: 15 },
  ]);
});
