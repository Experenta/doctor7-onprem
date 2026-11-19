'use strict';

// Parses `--name value` options. Only the names listed in `allowed` are accepted.
// Throws UsageError for anything else, so a typo never runs with a default value.

class UsageError extends Error {
  constructor(argument) {
    super(`Unknown or incomplete argument: ${argument}`);
    this.name = 'UsageError';
  }
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.includes(name)) {
      throw new UsageError(name);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(name);
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

module.exports = { parseOptions, UsageError };
