#!/usr/bin/env node
'use strict';

// Scans the files that would enter a commit (tracked plus untracked, minus
// ignored) for cloud and token key patterns and, when a list is configured,
// for forbidden words.
// Usage: node scripts/scan-secrets.js [repoRoot]
// Exit code 0: no findings. Exit code 1: findings or error.
//
// The forbidden-word list lives outside the repository. The scanner uses the
// first of these that exists:
//   1. the file named by the FORBIDDEN_WORDS_FILE environment variable
//      (absolute, or relative to the directory the scanner runs from);
//   2. scripts/forbidden-words.local.txt (ignored by git).
// With neither, the scanner checks key patterns only and prints a warning.
// Format: one term per line, case-insensitive. Lines starting with # are comments.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOCAL_FORBIDDEN_WORDS_FILE = path.join(__dirname, 'forbidden-words.local.txt');
const EXAMPLE_FORBIDDEN_WORDS_FILE = path.join(__dirname, 'forbidden-words.example.txt');

const SECRET_PATTERNS = [
  { name: 'AWS access key ID', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', regex: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Private key block', regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
];

// Absolute path named by FORBIDDEN_WORDS_FILE, or null when the variable is unset or empty.
function listFromEnv(env = process.env) {
  const value = (env.FORBIDDEN_WORDS_FILE || '').trim();
  return value === '' ? null : path.resolve(value);
}

// Returns the absolute path of the list to use, or null when none exists.
// A variable that names a missing file is ignored, and the local file is tried next.
function resolveForbiddenWordsFile(env = process.env) {
  const fromEnv = listFromEnv(env);
  if (fromEnv !== null && fs.existsSync(fromEnv)) return fromEnv;
  if (fs.existsSync(LOCAL_FORBIDDEN_WORDS_FILE)) return LOCAL_FORBIDDEN_WORDS_FILE;
  return null;
}

function loadForbiddenWords(file = resolveForbiddenWordsFile()) {
  if (file === null) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// Word lists are never scanned: the local list, the list named by the variable, and the example.
function listFilesToSkip(env = process.env) {
  const skip = new Set(
    [LOCAL_FORBIDDEN_WORDS_FILE, EXAMPLE_FORBIDDEN_WORDS_FILE].map((file) => path.resolve(file))
  );
  const fromEnv = listFromEnv(env);
  if (fromEnv !== null) skip.add(fromEnv);
  return skip;
}

// Files that would enter a commit: tracked, plus untracked files not ignored.
function listCommitFiles(root) {
  const out = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return out
    .split('\0')
    .filter((rel) => rel.length > 0)
    .filter((rel) => fs.existsSync(path.join(root, rel)));
}

function scanFiles(root, { forbiddenWords = loadForbiddenWords() } = {}) {
  const findings = [];
  const skipped = listFilesToSkip();

  for (const rel of listCommitFiles(root)) {
    const abs = path.resolve(root, rel);
    if (skipped.has(abs)) continue;

    const lowerRel = rel.toLowerCase();
    for (const word of forbiddenWords) {
      if (lowerRel.includes(word)) {
        findings.push({ file: rel, line: 0, rule: `forbidden word in path: ${word}` });
      }
    }

    const buffer = fs.readFileSync(abs);
    if (buffer.includes(0)) continue; // skip binary files

    const lines = buffer.toString('utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const { name, regex } of SECRET_PATTERNS) {
        if (regex.test(text)) {
          findings.push({ file: rel, line: index + 1, rule: name });
        }
      }
      const lowerText = text.toLowerCase();
      for (const word of forbiddenWords) {
        if (lowerText.includes(word)) {
          findings.push({ file: rel, line: index + 1, rule: `forbidden word: ${word}` });
        }
      }
    });
  }
  return findings;
}

module.exports = {
  EXAMPLE_FORBIDDEN_WORDS_FILE,
  SECRET_PATTERNS,
  resolveForbiddenWordsFile,
  loadForbiddenWords,
  listCommitFiles,
  scanFiles,
};

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  try {
    if (resolveForbiddenWordsFile() === null) {
      process.stderr.write(
        'secret scan: no forbidden-word list configured; checking key patterns only. ' +
          'Set FORBIDDEN_WORDS_FILE or create scripts/forbidden-words.local.txt.\n'
      );
    }
    const findings = scanFiles(root);
    for (const f of findings) {
      process.stdout.write(`${f.file}:${f.line}: ${f.rule}\n`);
    }
    if (findings.length > 0) {
      process.stdout.write(`secret scan: ${findings.length} finding(s)\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('secret scan: no findings\n');
    }
  } catch (err) {
    process.stderr.write(`secret scan error: ${err.message}\n`);
    process.exitCode = 1;
  }
}
