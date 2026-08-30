-- 079 — SMS-újraküldési sor (a néma SMS-kiesés ellen)
--
-- ⚠️ MIÉRT (2026-08-30, user-döntés): a címzetti SMS az EGYETLEN csatorna,
-- amin a címzett (aki nem felhasználónk) megkapja az átvételi kódot. A két
-- TAPASZTALT éles hibamód — SeeMe code=13 (a Railway kimenő IP-je nincs
-- engedélyezve) és code=7 (elfogyott az egyenleg) — eddig VÉGLEGES,
-- néma veszteség volt: a küldés fire-and-forget, a Sentry-riasztáson kívül
-- semmi nem történt, és a hiba elhárítása UTÁN sem ment ki a bennragadt SMS.
-- 2026-08-20 és 08-30 között pontosan ez történt élesben (code=13, a
-- 152.55.177.90-es új IP), a tesztelő címzettjei sosem kapták meg a kódot.
--
-- A SOR: sikertelen (újrapróbálható) küldés ide kerül; egy 10 percenkénti
-- kör újrapróbálja, siker esetén azonnal törli a sort. 48 óra után nincs
-- több próba (a felvételi SMS addigra okafogyott), a lejárt sort a napi
-- retenciós kör törli (purgeExpiredSmsRetryQueue) — a tábla tehát
-- ÖNFELSZÁMOLÓ, PII (címzett-telefonszám + átvételi kód a szövegben)
-- legfeljebb ~72 óráig él benne.

CREATE TABLE IF NOT EXISTS sms_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A kör a legrégebbi esedékes sorokat veszi elő.
CREATE INDEX IF NOT EXISTS idx_sms_retry_queue_created_at
    ON sms_retry_queue (created_at);
