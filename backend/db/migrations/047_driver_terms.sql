-- 047 — Jogosítvány-követelmény megszüntetése + sofőri nyilatkozat
--
-- Döntés (2026-07-07): a jogosítvány feltöltése többé NEM kell. Aki a
-- SZEMÉLYI IGAZOLVÁNYÁT igazolta (identity_kyc_status = 'verified'), jogosult
-- MINDENRE — feladó ÉS sofőr. Ez engedi a nem-motoros futárokat is (kerékpár,
-- gyalog, tömegközlekedés — Tourmix-modell).
--
-- A sofőri tevékenységhez egyszeri NYILATKOZAT kell: a felhasználó a sofőr-mód
-- első használatakor elfogadja, hogy minden vonatkozó jogszabályt és a KRESZ-t
-- betartja. Ezt időbélyeggel rögzítjük.
--
-- A drivers_license doc_type + driver_kyc_status + can_bid oszlopok dormant
-- maradnak (a lejárat-cron mostantól tárgytalan), később visszakapcsolhatók.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS driver_terms_accepted_at TIMESTAMPTZ;
