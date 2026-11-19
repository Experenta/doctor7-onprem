'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSequencer } = require('./sequence');
const { delay } = require('./harness');

test('stamps strictly increase for one appointment, even when the clock repeats', () => {
  const fixed = new Date('2026-12-01T15:00:00.000Z');
  const sequencer = createSequencer({ now: () => fixed });
  const first = sequencer.stamp('a1');
  const second = sequencer.stamp('a1');
  const third = sequencer.stamp('a1');
  assert.equal(first.toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(second.getTime(), first.getTime() + 1);
  assert.equal(third.getTime(), second.getTime() + 1);
});

test('stamps of different appointments do not affect each other', () => {
  const fixed = new Date('2026-12-01T15:00:00.000Z');
  const sequencer = createSequencer({ now: () => fixed });
  sequencer.stamp('a1');
  sequencer.stamp('a1');
  assert.equal(sequencer.stamp('a2').getTime(), fixed.getTime());
});

test('tasks of one appointment run in the order they were queued, even when an earlier one is slower', async () => {
  const sequencer = createSequencer();
  const order = [];
  const slow = sequencer.run('a1', async () => {
    await delay(30);
    order.push('first');
    return 'first';
  });
  const fast = sequencer.run('a1', async () => {
    order.push('second');
    return 'second';
  });
  assert.deepEqual(await Promise.all([slow, fast]), ['first', 'second']);
  assert.deepEqual(order, ['first', 'second']);
});

test('a failing task does not stop the tasks queued after it', async () => {
  const sequencer = createSequencer();
  const failing = sequencer.run('a1', async () => {
    throw new Error('task failed');
  });
  const next = sequencer.run('a1', async () => 'still runs');
  await assert.rejects(failing, /task failed/);
  assert.equal(await next, 'still runs');
});

test('an appointment with a slow task does not hold up another appointment', async () => {
  const sequencer = createSequencer();
  const order = [];
  const slow = sequencer.run('a1', async () => {
    await delay(40);
    order.push('a1');
  });
  const other = sequencer.run('a2', async () => {
    order.push('a2');
  });
  await Promise.all([slow, other]);
  assert.deepEqual(order, ['a2', 'a1']);
});
