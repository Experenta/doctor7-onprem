'use strict';

// In-memory implementation of the chat store contract (see store.js). It is a
// test aid. `messages` is exposed so tests can inspect what was stored.

function byTime(a, b) {
  return a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function createMemoryChatStore({ messages = [] } = {}) {
  const stored = messages.map((message) => ({ ...message }));

  return {
    messages: stored,

    async insertMessage(message) {
      stored.push({ ...message });
    },

    async listRecent(appointmentId, limit) {
      return stored
        .filter((message) => message.appointmentId === appointmentId)
        .sort(byTime)
        .slice(-limit)
        .map((message) => ({ ...message }));
    },

    async deleteSentBefore(cutoff) {
      let removed = 0;
      for (let index = stored.length - 1; index >= 0; index -= 1) {
        if (stored[index].sentAt < cutoff) {
          stored.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

module.exports = { createMemoryChatStore };
