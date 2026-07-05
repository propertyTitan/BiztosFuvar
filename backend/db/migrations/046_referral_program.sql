-- 046 — Ajánlói program (referral)
--
-- Modell (2026-07-05, user döntése): egyoldalú ajánlás. Aki a linkjén
-- keresztül hoz egy új felhasználót, ÉS az teljesíti az első fuvarját
-- (feladóként = kifizeti az első kapcsolatfelvételi díjat, sofőrként =
-- lezárja az első fuvart), az ajánló kap egy INGYEN FELADÁS kupont
-- (a kapcsolatfelvételi díjat elengedi, egy sáv-plafonig).
--
-- Visszaélés-védelem: a jutalom CSAK akkor jár, ha a meghívott átment az
-- identity-KYC-n; userenként egyszer (referral_reward_granted_at); és az
-- ajánló havi plafonja korlátozza a tömeges farmolást (a service-ben).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_reward_granted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

-- A meglévő usereknek generálunk egy determinisztikus, ütközésmentes kódot
-- (az id md5-jének első 8 hex karaktere, nagybetűsítve). Új usereknél az
-- alkalmazás (referral service) generál regisztrációkor.
UPDATE users
   SET referral_code = UPPER(SUBSTR(MD5(id::text), 1, 8))
 WHERE referral_code IS NULL;

-- A kupon (fee_vouchers, 020) kap egy opcionális díj-plafont: az ajánlói
-- kupon csak a plafon alatti díjú feladásra váltható be (efölött nem
-- alkalmazható). NULL = nincs plafon (a szint-alapú kuponok ilyenek).
ALTER TABLE fee_vouchers
  ADD COLUMN IF NOT EXISTS max_fee_huf INTEGER;
