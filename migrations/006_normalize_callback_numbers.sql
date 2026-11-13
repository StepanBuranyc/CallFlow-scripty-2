UPDATE service_requests
SET callback_number = translate(callback_number, ' ()-./,', '')
WHERE callback_number ~ '[[:space:](),./-]';
