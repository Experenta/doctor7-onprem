# K-24 requirements: documents up to date with stored meetings and the task count

## Context

K-23 stores the video meeting once per appointment, in the `meetings` table created by
migration `0005_meetings.sql`. The client reads it with `GET /appointments/:id/meeting`.
Several documents still describe the meeting as stateless, do not list the new audit
action and reason, and state an older task count.

## Requirements

1. `docs/AUDIT.md` lists the action `meeting.read` with its outcomes: `success` for a
   read of a stored meeting, and `denied` with a reason for a refused read.
2. `docs/AUDIT.md` describes the reason `appointment_closed` for a refused meeting
   creation. The creation is refused with `409` when the appointment is `cancelled` or
   `completed`.
3. `docs/ARCHITECTURE.md` no longer says that the switch to Jitsi stores nothing. It says
   that the created meeting, with the provider really used, is stored once per appointment
   in `meetings` and read with `GET /appointments/:id/meeting`. The rest of the document
   has no sentence that describes meetings as stateless.
4. `docs/OPERATIONS.md` and `docs/MIGRATION.md` name migration `0005_meetings.sql` and the
   table `meetings` where they list migrations or tables. They state the order of the
   migration and the new API version.
5. `docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md` state 24 numbered tasks, K-01 to
   K-24, plus K-19b. They list the specification folders that exist in `.kiro/specs/`.
6. `docs/HOW-WE-USED-KIRO.md` gives the two findings of the task in "What failed and how
   it was corrected", without a duplicate of an existing item.
7. `docs/DEMO-SCRIPT.md` segments add up to 180 seconds or less.
8. `scripts/judge-docs.test.js` checks requirements 5 and 7.
9. All text is in English. The documents give no credit figures and no percentages of
   code written by Kiro.

## Out of scope

- Code under `api/` and `web/`, migrations, packaging, and the seed.
- Client or account names. The list of them is outside the repository.
- Installing dependencies, pushing, and deploying.
- Fixing bugs found while checking. They are reported.
