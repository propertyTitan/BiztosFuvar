-- 080 — Az eltárolt címek országneve magyarul (GF-023, Manus-regresszió)
--
-- ⚠️ MIÉRT: a Google Maps JS API 2026-08-30-tól language=hu-val töltődik
-- (PR #201), tehát az ÚJ címek már „Magyarország"-gal érkeznek — a KORÁBBAN
-- eltárolt címek viszont angol országnévvel („…, Hungary") maradtak, és a
-- magyar felületen így is jelentek meg. A Manus-regresszió ezt fogta meg:
-- a nyelvi paraméter önmagában a meglévő adatot nem gyógyítja.
--
-- A REPLACE idempotens (a már magyar sorokat nem érinti), és csak a
-- „, Hungary" alakot cseréli — a Google formátumában a országnév mindig
-- vesszővel elválasztva áll, más szövegkörnyezetben nem fordul elő.

UPDATE jobs
   SET pickup_address = REPLACE(pickup_address, ', Hungary', ', Magyarország')
 WHERE pickup_address LIKE '%, Hungary%';

UPDATE jobs
   SET dropoff_address = REPLACE(dropoff_address, ', Hungary', ', Magyarország')
 WHERE dropoff_address LIKE '%, Hungary%';

UPDATE route_bookings
   SET pickup_address = REPLACE(pickup_address, ', Hungary', ', Magyarország')
 WHERE pickup_address LIKE '%, Hungary%';

UPDATE route_bookings
   SET dropoff_address = REPLACE(dropoff_address, ', Hungary', ', Magyarország')
 WHERE dropoff_address LIKE '%, Hungary%';

-- A járat-waypointok JSONB-ben tárolják a formatted_address-t.
UPDATE carrier_routes
   SET waypoints = REPLACE(waypoints::text, ', Hungary', ', Magyarország')::jsonb
 WHERE waypoints::text LIKE '%, Hungary%';
