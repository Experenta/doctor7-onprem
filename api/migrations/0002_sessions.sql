-- doctor7-onprem sign-in schema. Applied and reverted by api/src/db/migrations.js.
-- Only SHA-256 hashes of session tokens and login state values are stored, never the raw values.
-- Keep semicolons out of comments and string literals, because the runner splits on them.

-- migrate:up
-- sessions: one row per server session. Expiry is absolute (expires_at) and by inactivity (last_seen_at).
-- A session with revoked_at set is no longer valid.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id_hash),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- login_attempts: one short-lived row per started sign-in. A row is deleted when the callback uses it.
CREATE TABLE IF NOT EXISTS login_attempts (
  state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  binding_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_verifier VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (state_hash),
  KEY ix_login_attempts_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS sessions;
