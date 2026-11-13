CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_name text NOT NULL,
  caller_number text,
  callback_number text NOT NULL,
  issue_summary text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'dispatching', 'accepted', 'unassigned', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_requests_created_at_idx ON service_requests (created_at DESC);
