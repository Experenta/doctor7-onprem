# K-28 design: real demo address in the judge documents

## Address rule in `scripts/judge-docs.test.js`

- `DEMO_HOST` is `3-139-52-25.sslip.io` and `DEMO_URL` is `https://3-139-52-25.sslip.io`.
  The test uses the host name only with dashes. The dotted IP address is checked by the
  existing public-IP test, which fails for it.
- A web address is judged by its scheme and its host, in this order:
  1. An empty host (a bare scheme in prose) and a placeholder (`<host>`) pass.
  2. The demo host passes only with `https://` and no port. A path after it is allowed.
  3. The demo host with a port fails. It is another address on the same host, and the
     test does not relax its rule.
  4. The demo host with `http://` fails. The message names the address with its scheme.
  5. The other allowed hosts (examples, loopback, the Jitsi repository, and the Google
     endpoints) pass as before. The port of those hosts is ignored, as before.
  6. Every other host fails. This includes every other name under `sslip.io`.
- Exact match for the demo host means a name such as `x3-139-52-25.sslip.io` also fails.

## Three judge documents

- `README.md`, `docs/SUBMISSION.md`, and `docs/DEMO-SCRIPT.md` must each contain
  `DEMO_URL` as text. None of them may contain `<DEMO_URL>`.
- `README.md` has the availability line on its own line, and the public-host sentence.

## Kiro document counts

- 28 tasks. The sentences are fixed in the test constants `TASK_COUNT`, `TASK_SENTENCE`,
  and `SPEC_SENTENCE`. The folder list is the sorted list of the `k-NN` folders on disk.
  The folder list in each document must equal it.
- The folders on disk after this task are k-06 to k-10, k-12 to k-14, k-16 to k-24,
  k-26, and k-28. That is 19 folders.

## Where the K-26 fact goes

- `docs/HOW-WE-USED-KIRO.md`, the list "What failed and how it was corrected", item 7.
  `docs/SECURITY.md` describes the mechanism of K-26 but not the incident on the demo, so
  the incident is added here once.

## Verification

- `node --test "scripts/**/*.test.js"` runs the new tests. Before the documents change,
  the address tests fail, which shows that they check the real files.
