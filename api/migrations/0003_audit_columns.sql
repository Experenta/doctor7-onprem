-- doctor7-onprem audit columns. Applied and reverted by api/src/db/migrations.js.
-- Each direction is a single ALTER TABLE statement, so it applies in full or not at all.
-- Keep semicolons out of comments and string literals, because the runner splits on them.

-- migrate:up
-- center_id: the center an entry belongs to. NULL when no center is known, for example a failed sign-in for an unknown email.
-- outcome: success, denied (refused by the authorization rules), or failure (the action did not complete).
-- ip: the client address as the API sees it. It depends on TRUST_PROXY.
-- reason: an internal code that explains a denied or failed entry. It is never sent to the caller.
ALTER TABLE audit_log
  ADD COLUMN center_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD COLUMN outcome ENUM('success', 'denied', 'failure') NOT NULL,
  ADD COLUMN ip VARCHAR(45) NULL,
  ADD COLUMN reason VARCHAR(100) NULL;

-- migrate:down
ALTER TABLE audit_log
  DROP COLUMN reason,
  DROP COLUMN ip,
  DROP COLUMN outcome,
  DROP COLUMN center_id;
