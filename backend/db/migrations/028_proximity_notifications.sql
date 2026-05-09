-- =====================================================================
--  028_proximity_notifications.sql
--
--  Közelség-alapú push értesítések nyomon követése:
--  - notif_city_sent: a sofőr beért a célvárosba (~5 km)
--  - notif_nearby_sent: a sofőr egy saroknyira van (~300 m)
-- =====================================================================

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS notif_city_sent    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notif_nearby_sent  BOOLEAN NOT NULL DEFAULT FALSE;
