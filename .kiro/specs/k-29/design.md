# K-29 design: alphanumeric Jitsi room names

## Room name

- `api/src/video/jitsi.js` sets `ROOM_PREFIX` to `doctor7`, with no hyphen. The room is
  `ROOM_PREFIX` followed by 16 random bytes in hexadecimal (32 characters), so every
  name matches `^doctor7[0-9a-f]{32}$`, which is a subset of `^[a-zA-Z0-9]+$`.
- The failover path (`service.js`, the Meet failure with a Jitsi retry) calls the same
  Jitsi provider, so it needs no change. Its tests check the format.
- `meet.js`, `service.js`, `router.js`, `store.js`, `memoryStore.js`, and the migrations
  do not build or check room names. They are not changed.

## Stored meetings

- `GET` and the repeated `POST` return the stored `url` as it is. Nothing parses or checks
  the room name on read, so a row with the old name (`doctor7-<hex>`) keeps working.
- Test fixtures that use old names as stored data (for example `/doctor7-stored` in
  `meeting.store.http.test.js` and `storeContract.js`) stay as they are. They are not
  generated names.

## Tests

- `jitsi.test.js`: the unsigned meeting path matches `^[a-zA-Z0-9]+$` in the room
  segment. Fifty generated names all match the format and differ from each other.
- `meeting.http.test.js` and `meeting.store.http.test.js`: the expected Jitsi address is
  `doctor7[0-9a-f]{32}`. The failover tests use it, so they check the failover path.
- `meeting.store.http.test.js`: a meeting stored with an old hyphenated name is read by
  `GET` unchanged.
- No property-based library is used. Fifty samples cover the format check.

## Documents

- `docs/DEMO.md`: the note from R4 goes in a "Room names" subsection of the Node 3 section.
  The "Verification status" list says that the entry page («Join meeting») was checked.
  It does not say that the room loads or that a call works.
- `docs/SUBMISSION.md` and `docs/HOW-WE-USED-KIRO.md`: the count and folder list are
  updated. The verification sentence in "What is verified and what is not" names the
  entry page. The K-29 fact is item 8 of "What failed and how it was corrected".
- `scripts/judge-docs.test.js`: `TASK_COUNT` is 29 and `TASK_SENTENCE` names K-29.
  `SPEC_SENTENCE` does not change, because K-29 has a specification.

## Verification

- `node --test "api/**/*.test.js" "scripts/**/*.test.js"` runs the format and read-back
  tests and the document checks.
