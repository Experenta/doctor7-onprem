-- doctor7-onprem meetings. Applied and reverted by api/src/db/migrations.js.
-- One video meeting per appointment. Ids use the binary collation like the other tables.
-- Timestamps are UTC in DATETIME(3).
-- Keep semicolons out of comments and string literals, because the runner splits on them.

-- migrate:up
-- meetings: appointment_id is the primary key, so an appointment has at most one meeting.
-- Deleting an appointment deletes its meeting. url is TEXT because a signed Jitsi address
-- carries a token. created_by has no foreign key, like audit_log.actor_id.
CREATE TABLE IF NOT EXISTS meetings (
  appointment_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  provider ENUM('meet', 'jitsi') NOT NULL,
  url TEXT NOT NULL,
  created_by VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (appointment_id),
  CONSTRAINT fk_meetings_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS meetings;
