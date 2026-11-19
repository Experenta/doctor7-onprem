# K-29 requirements: alphanumeric Jitsi room names and accurate demo notes

A real-browser run on the deployed demo showed a 404 in the video frame. The generated
room names contain a hyphen (`doctor7-<hex>`), and the default rule of the Jitsi Apache
virtual host (`RewriteRule ^/([a-zA-Z0-9]+)$`) accepts letters and digits only. This task
makes new room names alphanumeric and corrects the documents that describe the video.

## Requirements

- R1. A new Jitsi room name is `doctor7` followed by 32 lowercase hexadecimal characters,
  with no separator. Every generated name matches `^[a-zA-Z0-9]+$`. This holds for the
  Jitsi provider and for the failover path, which calls the same Jitsi provider.
- R2. A meeting already stored with the old hyphenated name (`doctor7-<...>`) is read
  back unchanged. The change does not touch stored rows, migrations, or the read path,
  and no code validates a name read from the database against the new format.
- R3. A test checks the format of generated names, for the Jitsi provider and for the
  failover path.
- R4. `docs/DEMO.md`, section "Node 3: self-hosted Jitsi", contains the note:
  "Jitsi's Apache virtual host only accepts letters and digits in room names by default;
  keep room names alphanumeric or widen the RewriteRule."
- R5. Where the judge documents and the Kiro documents say or suggest that the video
  loaded, worked, or was verified on the VM, they state that the entry page of the
  meeting room («Join meeting») was checked, and that a real audio and video call between
  two participants was not verified. Text that already says this is not repeated.
- R6. `docs/HOW-WE-USED-KIRO.md`, in the section on what failed and was corrected, states
  the K-29 fact once, using the sentence given in the task.
- R7. The task count is 29: K-01 to K-29 except K-15, plus K-19b. The count, the
  exceptions (K-11, K-19b, K-25, and K-27), and the folder list (with `k-29`) match in
  `scripts/judge-docs.test.js`, `docs/HOW-WE-USED-KIRO.md`, and `docs/SUBMISSION.md`.
- R8. The demo address and the other address checks do not change.
- R9. The text is in English. No client name, account name, credit figure, or percentage
  of code written by Kiro is added.

## Out of scope

- Migrations, `web/`, `packaging/`, the Jitsi Apache virtual host, and the read path of
  stored meetings.
- Changing stored rows or the test fixtures that hold old names as stored data.
- Installing dependencies, pushing, or touching the deployed demo.
