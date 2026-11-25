-- field: health history, open incidents and an audit trail of admin actions.

-- One row per health check. ts in unix seconds.
CREATE TABLE IF NOT EXISTS checks (
  app    TEXT    NOT NULL,
  ts     INTEGER NOT NULL,
  ok     INTEGER NOT NULL,
  status INTEGER,
  ms     INTEGER,
  error  TEXT,
  PRIMARY KEY (app, ts)
);
CREATE INDEX IF NOT EXISTS idx_checks_ts ON checks (ts);

-- Latest known state per app, so the overview never has to scan history.
CREATE TABLE IF NOT EXISTS state (
  app        TEXT PRIMARY KEY,
  ok         INTEGER NOT NULL,
  since      INTEGER NOT NULL,
  last_ts    INTEGER NOT NULL,
  status     INTEGER,
  ms         INTEGER,
  error      TEXT,
  fails      INTEGER NOT NULL DEFAULT 0,
  detail     TEXT
);

-- An incident opens after two failed checks in a row and closes on the next good one.
CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app         TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_app ON incidents (app, started_at DESC);

-- Who changed what, from which admin screen.
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  actor  TEXT    NOT NULL,
  app    TEXT    NOT NULL,
  action TEXT    NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts DESC);
