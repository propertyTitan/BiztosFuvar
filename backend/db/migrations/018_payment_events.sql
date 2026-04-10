-- Fizetési események naplója (idempotency + admin audit log).
--
-- Minden Barion webhook hívást ide mentünk — ha ugyanaz a PaymentId +
-- Status kombinációval jön egy második hívás, kihagyjuk (idempotens).
-- Az admin felületen ez a tábla adja az élő pénzügyi naplót.

CREATE TABLE IF NOT EXISTS payment_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      TEXT NOT NULL,            -- Barion PaymentId
    status          TEXT NOT NULL,            -- Succeeded, Canceled, stb.
    event_type      TEXT NOT NULL,            -- 'webhook' | 'manual' | 'stub'
    -- Melyik entitáshoz tartozik
    job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
    booking_id      UUID REFERENCES route_bookings(id) ON DELETE SET NULL,
    -- Pénzügyi részletek
    total_amount    INTEGER,                  -- teljes összeg
    currency        TEXT DEFAULT 'HUF',
    platform_fee    INTEGER,                  -- 10% jutalék
    carrier_payout  INTEGER,                  -- 90% sofőrnek
    -- Adó részletek (a VAT engine output-ja)
    vat_rate        NUMERIC(4,3),
    vat_amount      INTEGER,
    is_reverse_charge BOOLEAN DEFAULT false,
    -- Sofőr/feladó
    shipper_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    carrier_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    carrier_country TEXT,
    -- Admin-barát összefoglaló szöveg
    summary         TEXT,                     -- pl. "DE magánszemély, 119 EUR, jutalék: 11.9 EUR"
    -- Idempotency
    processed       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Egyedi: ugyanazt a PaymentId + Status párost csak egyszer dolgozzuk fel
    UNIQUE (payment_id, status)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_created ON payment_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id);
