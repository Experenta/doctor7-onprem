# K-24 design

## Approach

Text changes only, plus one check in the document test. Each fact comes from the code or
from a file in the repository, and each edit names its source in the document where a
claim needs one.

## Facts checked in the code

| Fact | Source |
| --- | --- |
| Table `meetings`: `appointment_id` primary key, `provider` (`meet` or `jitsi`), `url`, `created_by`, `created_at`. Deleting an appointment deletes its meeting. | `api/migrations/0005_meetings.sql` |
| `GET /appointments/:id/meeting` audits a successful read as `meeting.read`, and a refused read as `meeting.read` with `denied`. A read that finds no meeting is not audited. | `api/src/video/router.js` |
| A repeated `POST` that finds the stored meeting answers `200` and is audited as `meeting.read`, not as `meeting.create`. | `api/src/video/router.js` |
| A `POST` for an appointment that is not `scheduled` answers `409 appointment_closed` and is audited as `meeting.create` with `denied` and reason `appointment_closed`. | `api/src/video/router.js`, `api/src/video/meeting.store.http.test.js` |
| The upgrade script runs `migrate up` after the install step and before the restart. | `packaging/scripts/upgrade.sh` |
| The `doctor7-api` postinst restarts the API during an upgrade install, before the migration step. | `packaging/api/DEBIAN/postinst`, `packaging/api/DEBIAN/prerm` |

The last row is a gap between the packaging and the documented order. The documents
describe what the code does. The packaging fix is out of scope and is reported.

## Specification folders

The specification folders are the directories under `.kiro/specs/` whose names match
`k-NN`. The document test compares the list in each document with that listing. A folder
added later makes the test fail until the documents list it.

## Task count

One explicit number: 24 numbered tasks, K-01 to K-24, plus K-19b. The test checks that
both documents state this exact phrase and that no other count of numbered tasks appears.

## Document test

`scripts/judge-docs.test.js` gets two checks:

- The task phrase is in `docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md`, and no other
  number of numbered tasks appears in either file.
- The specification folders listed in each document equal the folders in `.kiro/specs/`.

The existing demo script check already covers the 180 second limit.
