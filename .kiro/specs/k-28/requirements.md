# K-28 requirements: real demo address in the judge documents

The demo host is public, and the judges need its address. The project director replaces
the placeholder rule with the real address. The judge documents name the address, and
the document test accepts that one host and nothing else.

## Requirements

- R1. `README.md`, `docs/SUBMISSION.md`, and `docs/DEMO-SCRIPT.md` contain the exact text
  `https://3-139-52-25.sslip.io`, and none of them contains the placeholder `<DEMO_URL>`.
- R2. `README.md` has the line `The demo instance is available until 2027-01-29.` next to
  the address. It also has a sentence that says `3-139-52-25.sslip.io` is the public host
  of the demo.
- R3. The document test passes the exact address. It fails for any other web address in
  the judge documents and in `.kiro/`:
  - another host;
  - another name under `sslip.io`;
  - the same host with a port;
  - the same host with `http://` instead of `https://`;
  - the public IP address of the demo host.
  A path on the demo host is allowed.
- R4. The IP address of the demo host does not appear in any judge document or in `.kiro/`.
  Only the host name with dashes appears.
- R5. The Kiro documents (`docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md`) state:
  - 28 tasks: K-01 to K-28 except K-15, plus K-19b;
  - the specification exceptions: K-11, K-19b, K-25, and K-27;
  - the list of the folders that exist in `.kiro/specs/`, which includes `k-28`;
  - that there is no folder for K-11, K-15, K-25, and K-27.
- R6. `docs/HOW-WE-USED-KIRO.md`, in the section on what failed and was corrected, states
  the K-26 fact about the duplicate session cookie on the deployed demo, once.
- R7. The text is in English. No client name, account name, e-mail address, user name,
  credit figure, or percentage of code written by Kiro is added.

## Out of scope

- Changes to `api/`, `web/`, `packaging/`, migrations, and tests other than
  `scripts/judge-docs.test.js`.
- Any other address, IP address, user name, or e-mail address.
- Installing dependencies, pushing, or touching the deployed demo.
