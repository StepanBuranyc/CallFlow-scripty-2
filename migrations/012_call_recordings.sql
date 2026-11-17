CREATE TABLE IF NOT EXISTS call_recordings (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS call_recordings_request_idx ON call_recordings(request_id);
CREATE INDEX IF NOT EXISTS call_recordings_expiry_idx ON call_recordings(expires_at);
