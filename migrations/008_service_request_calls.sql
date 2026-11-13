CREATE TABLE IF NOT EXISTS service_request_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  call_fingerprint text NOT NULL UNIQUE,
  call_type text NOT NULL,
  call_direction text NOT NULL,
  external_number text NOT NULL DEFAULT '',
  contact_name text,
  queue_extension text,
  agent_extension text,
  agent_name text,
  duration_seconds integer,
  started_at timestamptz,
  ended_at timestamptz,
  recording_url text,
  match_status text NOT NULL CHECK (match_status IN ('linked', 'unmatched', 'ambiguous')),
  match_method text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_request_calls_request_idx ON service_request_calls (request_id, started_at DESC);
CREATE INDEX IF NOT EXISTS service_request_calls_match_idx ON service_request_calls (match_status, started_at DESC);
