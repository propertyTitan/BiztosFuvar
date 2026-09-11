-- Teljes audit C1 (2026-09-11): a fizetési webhook keresési indexei + messages XOR.
-- 1) A webhook a payment-id alapján keres az escrow_transactions és a
--    route_bookings táblában — egyik oszlopon sem volt index (teljes
--    táblaszkennelés minden PSP-hívásnál, ami a forgalommal nő).
CREATE INDEX IF NOT EXISTS idx_escrow_transactions_payment_id ON escrow_transactions (barion_payment_id);
CREATE INDEX IF NOT EXISTS idx_route_bookings_payment_id ON route_bookings (barion_payment_id);
-- 2) messages: pontosan EGY szülő (a photos-nak már volt XOR-ja, az
--    üzeneteknek csak OR — a kettős sor két chat-szobában is látszott volna).
--    A prodon 0 kettős / 0 üres sor (2026-09-11 ellenőrizve).
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_parent_xor;
ALTER TABLE messages ADD CONSTRAINT messages_parent_xor CHECK ((job_id IS NOT NULL) <> (booking_id IS NOT NULL));
