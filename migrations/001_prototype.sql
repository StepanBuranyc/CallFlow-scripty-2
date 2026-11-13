CREATE TABLE IF NOT EXISTS prototype_outbound_calls (
  id uuid PRIMARY KEY,
  destination_dn text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  participant_id integer,
  status text NOT NULL CHECK (status IN ('calling', 'connected', 'acknowledged', 'failed', 'ended')),
  connected_at timestamptz,
  acknowledged_at timestamptz,
  dtmf_digit text,
  result_detail text
);

-- Idempotent upgrade from the first prototype schema, which called this field `extension`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'prototype_outbound_calls'
      AND column_name = 'extension'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'prototype_outbound_calls'
      AND column_name = 'destination_dn'
  ) THEN
    ALTER TABLE prototype_outbound_calls RENAME COLUMN extension TO destination_dn;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prototype_outbound_calls_started_at_idx
  ON prototype_outbound_calls (started_at DESC);
