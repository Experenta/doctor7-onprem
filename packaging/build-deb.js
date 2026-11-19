#!/usr/bin/env node
'use strict';

// Builds the doctor7 Debian packages.
//
// Usage: node packaging/build-deb.js [api|web|all] [--out DIR] [--version V]
//                                    [--web-dist DIR] [--no-deps]
//
//   api|web|all   Package to build. Default: all.
//   --out DIR     Output directory. Default: packaging/build (git ignores it).
//   --version V   Package version. Default: version of the root package.json plus "-1".
//   --web-dist D  Front-end build output. Default: web/dist (run `npm run build --workspace=web`).
//   --no-deps     Skip `npm ci`. Use it only to check the package layout.
//
// With dpkg-deb on the machine, the builder writes <out>/<name>_<version>_all.deb.
// Without it, the builder validates everything and leaves the assembled tree in
// <out>/<name>_<version>/ so that `dpkg-deb --root-owner-group --build` can run
// on a Debian host. Every missing input stops the build with a message that
// says what is missing and how to fix it.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGES = ['api', 'web'];
const NAMES = { api: 'doctor7-api', web: 'doctor7-web' };
const REQUIRED_CONTROL_FIELDS = ['Package', 'Version', 'Architecture', 'Maintainer', 'Description'];
const MAINTAINER_SCRIPTS = ['postinst', 'prerm', 'postrm'];
const VERSION_PATTERN = /^[0-9][A-Za-z0-9.+~-]*$/;

class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

// Reads the fields of a Debian control file. Continuation lines are joined.
function parseControl(text) {
  const fields = {};
  let current = null;
  for (const line of text.split('\n')) {
    if (/^[ \t]/.test(line) && current !== null) {
      fields[current] += `\n${line.trim()}`;
    } else {
      const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
      if (match) {
        current = match[1];
        fields[current] = match[2];
      }
    }
  }
  return fields;
}

function parseArgs(argv) {
  const options = { packages: [...PACKAGES], installDeps: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new BuildError(`${arg} needs a value.`);
      return argv[i];
    };
    if (arg === 'all') options.packages = [...PACKAGES];
    else if (PACKAGES.includes(arg)) options.packages = [arg];
    else if (arg === '--out') options.out = value();
    else if (arg === '--version') options.version = value();
    else if (arg === '--web-dist') options.webDist = value();
    else if (arg === '--no-deps') options.installDeps = false;
    else throw new BuildError(`Unknown argument: ${arg}. See the usage at the top of build-deb.js.`);
  }
  return options;
}

function exists(file) {
  return fs.existsSync(file);
}

// Returns a list of problems. An empty list means the build can start.
function checkInputs({ root, packages, webDist, installDeps }) {
  const problems = [];
  const missing = (file, hint) => {
    if (!exists(file)) problems.push(`Missing ${path.relative(root, file) || file}. ${hint}`);
  };

  for (const pkg of packages) {
    const source = path.join(root, 'packaging', pkg);
    const control = path.join(source, 'DEBIAN', 'control');
    missing(control, `The package sources are incomplete: restore packaging/${pkg}/DEBIAN.`);
    for (const script of MAINTAINER_SCRIPTS.slice(0, 2)) {
      missing(path.join(source, 'DEBIAN', script), `Every package needs a ${script} script.`);
    }
    if (exists(control)) {
      const fields = parseControl(fs.readFileSync(control, 'utf8').replace(/\r\n/g, '\n'));
      for (const field of REQUIRED_CONTROL_FIELDS) {
        if (!fields[field]) problems.push(`packaging/${pkg}/DEBIAN/control has no ${field} field.`);
      }
      if (fields.Package && fields.Package !== NAMES[pkg]) {
        problems.push(`packaging/${pkg}/DEBIAN/control names the package ${fields.Package}, expected ${NAMES[pkg]}.`);
      }
    }
  }

  if (packages.includes('api')) {
    missing(path.join(root, 'api', 'src', 'server.js'), 'The API sources are missing.');
    missing(path.join(root, 'api', 'migrations'), 'The API migrations are missing.');
    missing(path.join(root, 'api', 'package.json'), 'The API manifest is missing.');
    if (installDeps) {
      missing(path.join(root, 'package.json'), 'The workspace manifest is missing.');
      missing(path.join(root, 'package-lock.json'), 'Run `npm install` once and commit the lockfile, or use --no-deps to check the layout only.');
      missing(path.join(root, 'web', 'package.json'), 'The lockfile lists the web workspace, so its manifest must exist.');
    }
  }
  if (packages.includes('web')) {
    const index = path.join(webDist, 'index.html');
    if (!exists(index)) {
      problems.push(`Missing ${index}. Build the front end first: npm run build --workspace=web (or pass --web-dist).`);
    }
  }
  return problems;
}

function isText(buffer) {
  return !buffer.includes(0);
}

// Copies a directory tree. Text files lose carriage returns, so a checkout with
// CRLF line endings cannot break a maintainer script.
function copyTree(from, to, { filter = () => true, normalize = false } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (!filter(source, entry)) continue;
    if (entry.isDirectory()) {
      copyTree(source, target, { filter, normalize });
    } else if (entry.isFile()) {
      const data = fs.readFileSync(source);
      if (normalize && isText(data)) {
        fs.writeFileSync(target, data.toString('utf8').replace(/\r\n/g, '\n'));
      } else {
        fs.writeFileSync(target, data);
      }
    }
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? [full, ...walk(full)] : [full];
  });
}

// Directories 0755. Files with a shebang line 0755. Other files 0644.
function applyModes(tree) {
  fs.chmodSync(tree, 0o755);
  for (const entry of walk(tree)) {
    if (fs.statSync(entry).isDirectory()) {
      fs.chmodSync(entry, 0o755);
      continue;
    }
    const head = fs.readFileSync(entry).subarray(0, 2).toString('latin1');
    fs.chmodSync(entry, head === '#!' ? 0o755 : 0o644);
  }
}

function installedSizeKiB(tree) {
  let bytes = 0;
  for (const entry of walk(tree)) {
    if (entry.startsWith(path.join(tree, 'DEBIAN'))) continue;
    const stat = fs.statSync(entry);
    if (stat.isFile()) bytes += stat.size;
  }
  return Math.max(1, Math.ceil(bytes / 1024));
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new BuildError(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new BuildError(`${command} ${args.join(' ')} failed (status ${result.status}).\n${result.stderr || ''}`.trim());
  }
  return result;
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

// Production node_modules for the API, installed in a staged copy of the
// workspace root so that `npm ci` uses the committed lockfile. The staged
// root is /usr/lib/doctor7, so Node finds node_modules above the api directory.
function installProductionDeps({ root, out, libDir }) {
  const stage = path.join(out, '.npm-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'api'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'web'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(stage, 'package.json'));
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'));
  fs.copyFileSync(path.join(root, 'api', 'package.json'), path.join(stage, 'api', 'package.json'));
  fs.copyFileSync(path.join(root, 'web', 'package.json'), path.join(stage, 'web', 'package.json'));

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['ci', '--omit=dev', '--workspace=api', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });

  const skip = new Set(['.bin', '.package-lock.json', 'api', 'web']);
  const modules = path.join(stage, 'node_modules');
  if (!exists(modules)) throw new BuildError('npm ci did not create node_modules.');
  copyTree(modules, path.join(libDir, 'node_modules'), {
    filter: (source) => !(path.dirname(source) === modules && skip.has(path.basename(source))),
  });
  const own = path.join(stage, 'api', 'node_modules');
  if (exists(own)) copyTree(own, path.join(libDir, 'api', 'node_modules'));
  fs.rmSync(stage, { recursive: true, force: true });
}

function addApiPayload({ root, tree, out, installDeps }) {
  const libDir = path.join(tree, 'usr', 'lib', 'doctor7');
  const appDir = path.join(libDir, 'api');
  const isTestFile = (source, entry) => entry.isFile() && source.endsWith('.test.js');
  copyTree(path.join(root, 'api', 'src'), path.join(appDir, 'src'), { filter: (s, e) => !isTestFile(s, e) });
  copyTree(path.join(root, 'api', 'migrations'), path.join(appDir, 'migrations'));
  fs.copyFileSync(path.join(root, 'api', 'package.json'), path.join(appDir, 'package.json'));
  if (installDeps) installProductionDeps({ root, out, libDir });
}

function addWebPayload({ tree, webDist }) {
  copyTree(webDist, path.join(tree, 'usr', 'share', 'doctor7', 'web'));
}

function buildOne(pkg, { root, out, version, webDist, installDeps, log }) {
  const name = NAMES[pkg];
  const tree = path.join(out, `${name}_${version}`);
  fs.rmSync(tree, { recursive: true, force: true });
  copyTree(path.join(root, 'packaging', pkg), tree, { normalize: true });

  if (pkg === 'api') addApiPayload({ root, tree, out, installDeps });
  else addWebPayload({ tree, webDist });

  applyModes(tree);

  const controlFile = path.join(tree, 'DEBIAN', 'control');
  const control = fs
    .readFileSync(controlFile, 'utf8')
    .replace('@VERSION@', version)
    .replace('@INSTALLED_SIZE@', String(installedSizeKiB(tree)));
  fs.writeFileSync(controlFile, control);
  fs.chmodSync(controlFile, 0o644);

  const deb = path.join(out, `${name}_${version}_all.deb`);
  if (hasCommand('dpkg-deb')) {
    fs.rmSync(deb, { force: true });
    run('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', tree, deb]);
    log(`${name}: built ${deb}`);
    return { name, tree, deb };
  }
  log(`${name}: dpkg-deb was not found. The tree is ready in ${tree}. On Debian run: dpkg-deb --root-owner-group -Zxz --build "${tree}" "${deb}"`);
  return { name, tree, deb: null };
}

function build(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const packages = options.packages || [...PACKAGES];
  const installDeps = options.installDeps !== false;
  const out = path.resolve(options.out || path.join(root, 'packaging', 'build'));
  const webDist = path.resolve(options.webDist || path.join(root, 'web', 'dist'));
  const log = options.log || ((line) => process.stdout.write(`${line}\n`));

  let version = options.version;
  if (!version) {
    const manifest = path.join(root, 'package.json');
    if (!exists(manifest)) throw new BuildError(`Missing ${manifest}. Pass --version.`);
    version = `${JSON.parse(fs.readFileSync(manifest, 'utf8')).version}-1`;
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new BuildError(`"${version}" is not a valid Debian version. It must start with a digit.`);
  }

  const problems = checkInputs({ root, packages, webDist, installDeps });
  if (problems.length > 0) {
    throw new BuildError(`Cannot build:\n- ${problems.join('\n- ')}`);
  }

  fs.mkdirSync(out, { recursive: true });
  return packages.map((pkg) => buildOne(pkg, { root, out, version, webDist, installDeps, log }));
}

module.exports = { BuildError, build, checkInputs, parseArgs, parseControl };

if (require.main === module) {
  try {
    build(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`build-deb: ${err.message}\n`);
    process.exitCode = 1;
  }
}
