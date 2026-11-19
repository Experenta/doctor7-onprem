'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const {
  EXAMPLE_FORBIDDEN_WORDS_FILE,
  scanFiles,
  loadForbiddenWords,
  resolveForbiddenWordsFile,
} = require('./scan-secrets.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNER_SOURCE = path.join(__dirname, 'scan-secrets.js');

// Test fixtures are assembled at runtime so this file never contains the
// literal patterns it is meant to detect.
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');

// Invented forbidden terms. The repository never holds the real list.
const FAKE_TERM = 'client-name-example';
const FAKE_TERM_2 = 'private-library-example';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function makeTempRepo(files) {
  const dir = makeTempDir('scan-secrets-');
  execFileSync('git', ['-C', dir, 'init', '-q']);
  writeFiles(dir, files);
  return dir;
}

// Creates a temporary list file with the given terms, runs fn with its path, and removes it.
function withTempList(terms, fn) {
  const dir = makeTempDir('scan-list-');
  try {
    const file = path.join(dir, 'words.txt');
    fs.writeFileSync(file, `${terms.join('\n')}\n`);
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Runs fn with FORBIDDEN_WORDS_FILE set to file (or unset when file is undefined).
function withEnvVar(file, fn) {
  const previous = process.env.FORBIDDEN_WORDS_FILE;
  if (file === undefined) delete process.env.FORBIDDEN_WORDS_FILE;
  else process.env.FORBIDDEN_WORDS_FILE = file;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.FORBIDDEN_WORDS_FILE;
    else process.env.FORBIDDEN_WORDS_FILE = previous;
  }
}

// Environment for a child scanner process: the variable is set only when listFile is given.
function scannerEnv(listFile) {
  const env = { ...process.env };
  delete env.FORBIDDEN_WORDS_FILE;
  if (listFile !== undefined) env.FORBIDDEN_WORDS_FILE = listFile;
  return env;
}

function runScanner(scannerPath, root, listFile) {
  return spawnSync(process.execPath, [scannerPath, root], {
    encoding: 'utf8',
    env: scannerEnv(listFile),
    cwd: root,
  });
}

// Copies the scanner into repo/scripts so that its local list path points inside the repo.
function copyScannerInto(repo) {
  const target = path.join(repo, 'scripts', 'scan-secrets.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(SCANNER_SOURCE, target);
  return target;
}

function listFilesRecursive(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(abs) : [abs];
  });
}

test('scanner fails on a file that contains a fake cloud key', () => {
  const dir = makeTempRepo({ 'config.txt': `key = ${FAKE_AWS_KEY}\n` });
  try {
    withTempList([FAKE_TERM, FAKE_TERM_2], (list) =>
      withEnvVar(list, () => {
        const findings = scanFiles(dir);
        assert.ok(findings.length > 0, 'expected at least one finding');
        assert.ok(findings.some((f) => f.rule === 'AWS access key ID' && f.file === 'config.txt'));
      })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with a list, a file containing a forbidden term fails the scan', () => {
  const repo = makeTempRepo({ 'notes.md': `reference ${FAKE_TERM.toUpperCase()} here\n` });
  try {
    withTempList([FAKE_TERM], (list) => {
      const result = runScanner(SCANNER_SOURCE, repo, list);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /notes\.md:1: forbidden word: client-name-example/);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('with a list, a file without a forbidden term passes the scan', () => {
  const repo = makeTempRepo({ 'notes.md': 'nothing to see here\n' });
  try {
    withTempList([FAKE_TERM], (list) => {
      const result = runScanner(SCANNER_SOURCE, repo, list);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /secret scan: no findings/);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('scanner ignores files excluded from the commit by .gitignore', () => {
  const dir = makeTempRepo({
    '.gitignore': 'secret.txt\n',
    'secret.txt': `key = ${FAKE_AWS_KEY}\n`,
    'ok.txt': 'nothing here\n',
  });
  try {
    withTempList([FAKE_TERM], (list) =>
      withEnvVar(list, () => {
        assert.deepEqual(scanFiles(dir), []);
      })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a list the scanner exits 0 and warns on one line', () => {
  const repo = makeTempRepo({ 'ok.txt': 'nothing here\n' });
  try {
    const scanner = copyScannerInto(repo);
    const result = runScanner(scanner, repo, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /no forbidden-word list configured/);
    assert.match(result.stdout, /secret scan: no findings/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the local list file is ignored by git', () => {
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', 'scripts/forbidden-words.local.txt'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  // git check-ignore exits 0 when the path is ignored.
  assert.equal(result.status, 0, 'scripts/forbidden-words.local.txt is not ignored by git');
});

test('the local list file is used as the list and is not scanned', () => {
  const repo = makeTempRepo({ 'notes.md': `reference ${FAKE_TERM} here\n` });
  try {
    writeFiles(repo, { 'scripts/forbidden-words.local.txt': `${FAKE_TERM}\n` });
    const scanner = copyScannerInto(repo);
    const result = runScanner(scanner, repo, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /notes\.md:1: forbidden word: client-name-example/);
    assert.doesNotMatch(result.stdout, /forbidden-words\.local\.txt/);
    assert.doesNotMatch(result.stderr, /no forbidden-word list configured/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the list named by FORBIDDEN_WORDS_FILE is not scanned', () => {
  const repo = makeTempRepo({ 'notes.md': 'nothing to see here\n' });
  try {
    writeFiles(repo, { 'lists/words.txt': `${FAKE_TERM}\n` });
    const listFile = path.join(repo, 'lists', 'words.txt');
    const result = runScanner(SCANNER_SOURCE, repo, listFile);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /words\.txt/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the example list is not scanned', () => {
  const repo = makeTempRepo({ 'notes.md': 'nothing to see here\n' });
  try {
    const exampleContent = fs.readFileSync(EXAMPLE_FORBIDDEN_WORDS_FILE, 'utf8');
    writeFiles(repo, { 'scripts/forbidden-words.example.txt': exampleContent });
    const scanner = copyScannerInto(repo);
    withTempList([FAKE_TERM], (list) => {
      const result = runScanner(scanner, repo, list);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /forbidden-words\.example\.txt/);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the example list loads and has at least two terms', () => {
  const words = loadForbiddenWords(EXAMPLE_FORBIDDEN_WORDS_FILE);
  assert.ok(words.length >= 2, `expected at least 2 terms, found ${words.length}`);
});

test('CLAUDE.md, README.md, .kiro/ and example lists do not contain the configured terms', (t) => {
  const listFile = resolveForbiddenWordsFile();
  if (listFile === null) {
    t.skip('no forbidden-word list configured; documentation check skipped');
    return;
  }
  const words = loadForbiddenWords(listFile);
  const scriptsDir = path.join(REPO_ROOT, 'scripts');
  const files = [
    path.join(REPO_ROOT, 'CLAUDE.md'),
    path.join(REPO_ROOT, 'README.md'),
    ...listFilesRecursive(path.join(REPO_ROOT, '.kiro')),
    ...fs
      .readdirSync(scriptsDir)
      .filter((name) => name.endsWith('.example.txt'))
      .map((name) => path.join(scriptsDir, name)),
  ];
  // Report file names only, so a failure never prints a configured term.
  const hits = files
    .filter((abs) => {
      const text = fs.readFileSync(abs, 'utf8').toLowerCase();
      return words.some((word) => text.includes(word));
    })
    .map((abs) => path.relative(REPO_ROOT, abs));
  assert.deepEqual(hits, [], `configured terms found in: ${hits.join(', ')}`);
});

test('scanner passes on this repository', () => {
  const findings = scanFiles(REPO_ROOT);
  assert.deepEqual(
    findings,
    [],
    `unexpected findings: ${JSON.stringify(findings, null, 2)}`
  );
});

test('.kiro/ is not ignored by .gitignore', () => {
  const paths = [
    '.kiro/steering/product.md',
    '.kiro/hooks/secret-scan-on-save.kiro.hook',
    '.kiro/specs/.gitkeep',
  ];
  for (const p of paths) {
    // git check-ignore exits 0 when ignored and 1 when not ignored.
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', p], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, `${p} is ignored by .gitignore`);
  }
});
