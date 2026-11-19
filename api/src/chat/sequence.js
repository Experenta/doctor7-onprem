'use strict';

// Orders the work of one appointment. Tasks with the same key run one after
// another, in the order they were queued. Tasks with different keys do not wait
// for each other. `stamp` gives each message a send time that is later than the
// previous one of the same key, so the order of `sent_at` matches the order of
// storage even when two messages arrive in the same millisecond.

function createSequencer({ now = () => new Date() } = {}) {
  const tails = new Map();
  const lastStamp = new Map();

  // Queues `task` after the work already queued for `key`. Returns its result.
  function run(key, task) {
    const previous = tails.get(key) ?? Promise.resolve();
    const current = previous.then(() => task());
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return current;
  }

  // Returns a Date later than every Date this key returned before.
  function stamp(key) {
    let at = now();
    const last = lastStamp.get(key);
    if (last && at.getTime() <= last.getTime()) {
      at = new Date(last.getTime() + 1);
    }
    lastStamp.set(key, at);
    return at;
  }

  return { run, stamp };
}

module.exports = { createSequencer };
