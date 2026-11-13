ALTER TABLE service_request_dispatch_attempts
  ADD COLUMN IF NOT EXISTS transfer_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_result text;
