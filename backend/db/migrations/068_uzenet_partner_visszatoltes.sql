-- 068 — Az üzenet-partner visszatöltése a meglévő sorokra
--
-- A 067 hozta létre a `messages.recipient_id` oszlopot; a visszatöltés azért
-- külön fájl, mert a migrációs futtató a teljes fájlt egyetlen lekérdezésként
-- adja át, és abban a Postgres a most létrehozott oszlopot még nem tudja
-- feloldani (lásd a 067 fejlécét).
--
-- A leváltott szállítókról nincs előzmény-adatunk, ezért a mai állapotból
-- számolunk: a régi sorok a jelenlegi felekhez rendelődnek. Ez a lehető
-- legjobb közelítés visszamenőleg; előre haladva a küldés rögzíti a valódi
-- címzettet.

UPDATE messages m
   SET recipient_id = CASE WHEN m.sender_id = j.shipper_id THEN j.carrier_id
                           ELSE j.shipper_id END
  FROM jobs j
 WHERE m.job_id = j.id AND m.recipient_id IS NULL;

UPDATE messages m
   SET recipient_id = CASE WHEN m.sender_id = b.shipper_id THEN r.carrier_id
                           ELSE b.shipper_id END
  FROM route_bookings b
  JOIN carrier_routes r ON r.id = b.route_id
 WHERE m.booking_id = b.id AND m.recipient_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id);
