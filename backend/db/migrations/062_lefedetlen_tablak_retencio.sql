-- 062 — A retencióból kimaradt táblák életciklusa
--
-- MIÉRT: a 060-as migráció a `jobs` és a `route_bookings` sorát anonimizálja
-- 3 év után, csakhogy a fuvar KÖRÉ épült szabad szöveg egy másik táblában él,
-- és ott érintetlen maradt:
--
--   * `bids.message`        — a szállító üzenete az ajánlatához,
--   * `job_questions`       — a fuvar nyilvános kérdés-válasz szála.
--
-- Vagyis a fuvar leírását kiürítettük, de a RÓLA szóló beszélgetést nem: a
-- küldemény tartalma, a lakás megközelítése, „a nagymamám a 3. emeleten lakik,
-- nincs lift" — mindez örökre megmaradt. Ugyanaz az adat, másik táblában.
-- (A chatet 6 hónap után már töröltük — ez a két csatorna maradt ki.)
--
-- Rajtuk kívül három tábla volt teljesen határidő nélküli:
--
--   * `disputes`      — a vita leírása, az indoklás és a bizonyíték-hivatkozás.
--                       A megőrzési szabályunk 5 év a lezárt bizonyítékra
--                       (photo_retention_hold), a vita SAJÁT sorára viszont
--                       semmi nem vonatkozott.
--   * `carrier_routes`— a járat leírása, a jármű leírása és az évekre
--                       visszamenő útvonal-előzmény (mozgásprofil).
--   * `invoices`      — a vevő neve, adószáma és címe. Ez SZÁMVITELI
--                       bizonylat: a Számv. tv. 169. § (2) nyolc évet ír elő,
--                       tehát itt a hosszabb megőrzés a jogszabályi kötelmünk
--                       — de nyolc év UTÁN ennek is el kell évülnie.
--
-- A `carrier_alerts` SZÁNDÉKOSAN nem kap időzített törlést: az a szállító élő,
-- általa bármikor törölhető beállítása (útvonal-figyelő), nem előzmény-adat.
-- Egy időzített purge némán kikapcsolná a működő értesítőjét. A mögötte lévő
-- valódi kérdés — mi legyen az évek óta inaktív fiókok adatával — fiók-szintű
-- termékdöntés, nem tábla-szintű takarítás.

-- ── Járat-anonimizálás jelölője (a 060 mintájára) ────────────────────────
ALTER TABLE carrier_routes
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_carrier_routes_anonimizalando
    ON carrier_routes (departure_at)
    WHERE anonymized_at IS NULL;

-- ── A napi körök keresései ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_disputes_resolved_at
    ON disputes (resolved_at)
    WHERE resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_created_at
    ON invoices (created_at);
