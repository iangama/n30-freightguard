CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | DONE | FAILED
  kind            TEXT NOT NULL,                   -- CREATE_OPERATION | CREATE_LOCATION_SNAPSHOT
  payload         JSONB NOT NULL,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS commands_status_created_idx ON commands(status, created_at);

CREATE TABLE IF NOT EXISTS ledger_events (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  type            TEXT NOT NULL,   -- BUDGET_RESET_DAILY | OPERATION_DECIDED | LOCATION_SNAPSHOT_RECORDED
  payload         JSONB NOT NULL,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL,
  UNIQUE(hash)
);

CREATE TABLE IF NOT EXISTS operations_projection (
  op_id           UUID PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin_lat      DOUBLE PRECISION NOT NULL,
  origin_lon      DOUBLE PRECISION NOT NULL,
  dest_lat        DOUBLE PRECISION NOT NULL,
  dest_lon        DOUBLE PRECISION NOT NULL,
  cargo_value     NUMERIC NOT NULL,
  sla_hours       INT NOT NULL,
  penalty_value   NUMERIC NOT NULL,
  decision        TEXT NOT NULL, -- APPROVED | APPROVED_WITH_COST | BLOCKED
  cost            NUMERIC NOT NULL,
  budget_left     NUMERIC NOT NULL,
  event_hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS location_snapshots_projection (
  snapshot_id     UUID PRIMARY KEY,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat             DOUBLE PRECISION NOT NULL,
  lon             DOUBLE PRECISION NOT NULL,
  note            TEXT,
  wx_temp         DOUBLE PRECISION,
  wx_wind         DOUBLE PRECISION,
  wx_gust         DOUBLE PRECISION,
  wx_rain1h       DOUBLE PRECISION,
  event_hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_budget_daily (
  day             DATE PRIMARY KEY,
  budget_total    NUMERIC NOT NULL,
  budget_left     NUMERIC NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
