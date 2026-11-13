ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS dispatch_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_due_at timestamptz;

CREATE TABLE IF NOT EXISTS service_request_dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  attempt_no smallint NOT NULL,
  destination_dn text NOT NULL,
  participant_id integer,
  status text NOT NULL CHECK (status IN ('calling', 'connected', 'accepted', 'no_answer', 'failed', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  finished_at timestamptz,
  dtmf_digit text,
  result_detail text,
  UNIQUE (request_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS service_request_dispatch_due_idx
  ON service_requests (dispatch_due_at, created_at)
  WHERE status = 'received' AND dispatch_due_at IS NOT NULL;
