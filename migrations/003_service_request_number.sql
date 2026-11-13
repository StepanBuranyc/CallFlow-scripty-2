CREATE SEQUENCE IF NOT EXISTS service_requests_ticket_number_seq START WITH 10000;

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS ticket_number integer;

UPDATE service_requests
SET ticket_number = nextval('service_requests_ticket_number_seq')
WHERE ticket_number IS NULL;

SELECT setval(
  'service_requests_ticket_number_seq',
  GREATEST(COALESCE((SELECT MAX(ticket_number) FROM service_requests), 9999), 9999),
  true
);

ALTER TABLE service_requests
  ALTER COLUMN ticket_number SET DEFAULT nextval('service_requests_ticket_number_seq'),
  ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_requests_ticket_number_idx
  ON service_requests (ticket_number);
