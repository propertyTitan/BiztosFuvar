// =====================================================================
//  ANONIMIZÁLÁSI MANIFEST — OSZLOP-szinten (2026-08-11, 10. mérés F1)
//
//  ⚠️ MIÉRT KELLETT: a retenciós őr TÁBLA-granularitáson dolgozik („minden
//  táblának legyen szabálya"), az anonimizálás viszont OSZLOPOKAT sorol fel
//  KÉZZEL a `retention.js`-ben. A kettő között nem volt átjárás, és a hozzá
//  tartozó teszt kézzel írt `expect`-eket használt — vagyis csak azokat az
//  oszlopokat védte, amikre valaki gondolt.
//
//  LEMÉRTEM: a `declared_value_huf = NULL,`, a `sender_delivery_code = NULL,`
//  és a `dropoff_floor = 0,` sorok TÖRLÉSÉVEL mind a 793 teszt zöld maradt —
//  miközben a csomag deklarált értéke, a feladó vészhelyzeti átvételi kódja és
//  a címzett lakásának emelete ÖRÖKRE megmaradt volna, a megmaradó
//  `shipper_id` mellett. A tájékoztató a deklarált értékre NÉV SZERINT ígér
//  3 évet.
//
//  És a jövő is nyitva volt: egy ÚJ PII-oszlop a `jobs`-on átment volna
//  MINDHÁROM sémából olvasó őrön (retenciós, halott-oszlop, állapot-mátrix),
//  mert azok tábla-, illetve státusz-szinten mérnek.
//
//  Ez a manifest ugyanazt teszi OSZLOP-szinten, amit a routeManifest a
//  végpontokkal: minden oszlopot be kell sorolni, új oszlop besorolás
//  nélkül = piros build.
//
//  KATEGÓRIÁK
//    urul    — az anonimizálás után NEM tartalmazhat adatot (NULL, '' vagy 0)
//    marad   — indokoltan megmarad; az indoklás KÖTELEZŐ, és azt kell
//              megmondania, MIÉRT nem személyes adat, vagy miért kell
//              a fuvar tényének megőrzéséhez
// =====================================================================

const ANONIMIZALAS_MANIFEST = {
  jobs: {
    // ── Ürülnie kell ────────────────────────────────────────────────────
    description: 'urul',
    // A cim nem NULLAZODIK, hanem TELEPULES-SZINTRE rovidul (utils/address.js,
    // tartalom-alapu) - a piac-statisztikahoz a telepules kell, a hazszam nem.
    pickup_address: 'rovidul',
    dropoff_address: 'rovidul',
    delivery_code: 'urul',
    sender_delivery_code: 'urul',
    tracking_token: 'urul',
    recipient_name: 'urul',
    recipient_phone: 'urul',
    recipient_email: 'urul',
    cancel_reason: 'urul',
    ai_description_notes: 'urul',
    source_store: 'urul',
    source_image_url: 'urul',
    declared_value_huf: 'urul',
    // A fuvar cime helyere fix helyettesito szoveg kerul, nem NULL: a
    // lista-feluletek es a statisztika NOT NULL cimre szamitanak.
    title: 'rovidul',
    pickup_floor: 'urul',
    dropoff_floor: 'urul',
    pickup_has_elevator: 'urul',
    dropoff_has_elevator: 'urul',
    pickup_needs_carrying: 'urul',
    dropoff_needs_carrying: 'urul',

    // ── Indokoltan marad ────────────────────────────────────────────────
    id: { marad: 'Elsődleges kulcs. Önmagában nem azonosít személyt, és a fuvar tényének megőrzéséhez kell.' },
    shipper_id: { marad: 'A fuvar TÉNYE a felhasználóhoz kötve marad (statisztika, vitarendezés utólagos nyoma). A fiók törlésekor CASCADE/SET NULL viszi.' },
    carrier_id: { marad: 'Ugyanaz a szállítói oldalon; a teljesítés-szám és az értékelés-aggregátum erre épül.' },
    status: { marad: 'A fuvar/foglalás életciklusának végállapota — státusz-érték, nem személyes adat.' },
    status_before_dispute: { marad: 'A vita előtti státusz, hogy a lezárás visszaállíthassa. Státusz-érték.' },
    created_at: { marad: 'Időbélyeg; a retenciós órák és a statisztika alapja.' },
    updated_at: { marad: 'Ugyanaz; egyben a lejáratási óra.' },
    anonymized_at: { marad: 'Épp az anonimizálás ténye — enélkül nem tudnánk, hogy megtörtént (GDPR 5. cikk (2)).' },
    paid_at: { marad: 'A díjfizetés ténye; a számviteli és a bevételi könyvelés hivatkozik rá.' },
    delivered_at: { marad: 'A teljesítés TÉNYE és időpontja — a fuvar megtörténtének bizonyítéka; cím és címzett nélkül nem azonosít.' },
    cancelled_at: { marad: 'A lemondás ténye, időbélyeg (az INDOKA ürül).' },
    cancelled_by: { marad: 'Felhasználó-azonosító, nem tartalom; a fiók törlésekor megy.' },
    distance_km: { marad: 'Számított távolság, cím nélkül nem azonosít.' },
    weight_kg: { marad: 'Csomag-paraméter, nem személyes adat.' },
    volume_m3: { marad: 'Csomag-paraméter (térfogat), nem személyes adat; az árazási statisztikához kell.' },
    length_cm: { marad: 'Csomag-méret, nem személyes adat; az árazási statisztikához kell.' },
    width_cm: { marad: 'Csomag-méret, nem személyes adat; az árazási statisztikához kell.' },
    height_cm: { marad: 'Csomag-méret, nem személyes adat; az árazási statisztikához kell.' },
    suggested_price_huf: { marad: 'Árazási statisztika; a jövőbeli ajánlott ársáv erre épül.' },
    accepted_price_huf: { marad: 'A ténylegesen elfogadott ár; az ajánlott ársáv kalibrálásához és a bevételi statisztikához kell.' },
    connection_fee_huf: { marad: 'A platform bevétele — számviteli megőrzés alá esik.' },
    fee_consent_at: { marad: 'A 45/2014. szerinti nyilatkozat ténye; bizonyíték, hogy jogszerűen szedtük a díjat.' },
    cancellation_fee_huf: { marad: 'Pénzügyi tétel, számviteli megőrzés.' },
    refund_huf: { marad: 'Visszatérített összeg — pénzügyi tétel, számviteli megőrzés alá esik.' },
    currency: { marad: 'Pénznem-kód (HUF/EUR) — nem személyes adat.' },
    country_code: { marad: 'Ország-kód; a ~1 km-re kerekített koordinátánál durvább felbontás.' },
    category: { marad: 'Csomag-kategória (bútor, doboz, gép…) — statisztika és árazás, nem személyes adat.' },
    pickup_lat: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — nem alkalmas lakás azonosítására, de a piac-statisztikához kell.' },
    pickup_lng: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    dropoff_lat: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    dropoff_lng: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    pickup_window_start: { marad: 'Időablak; a cím nélkül nem azonosít.' },
    pickup_window_end: { marad: 'Időablak vége; cím és címzett nélkül nem azonosít, a kereslet-elemzéshez kell.' },
    is_instant: { marad: 'Termék-jelző: azonnali („UberFuvar") fuvar volt-e. Boolean, nem személyes adat.' },
    instant_radius_km: { marad: 'Az azonnali fuvar keresési sugara — termék-paraméter, nem személyes adat.' },
    instant_expires_at: { marad: 'Az azonnali ajánlat lejárata — termék-időbélyeg, cím nélkül nem azonosít.' },
    instant_accepted_at: { marad: 'Az azonnali fuvar elvállalásának időpontja — termék-időbélyeg.' },
    ai_description_ok: { marad: 'Boolean ellenőrzés-eredmény; a SZÖVEGES indoklás (ai_description_notes) ürül.' },
    invoice_requested: { marad: 'Kért-e a feladó számlát — boolean, a számlázási kötelezettség nyoma.' },
    notif_city_sent: { marad: 'Belső kézbesítési jelző: küldtünk-e már város-értesítést. Boolean.' },
    notif_nearby_sent: { marad: 'Belső kézbesítési jelző (küldtünk-e már közeledés-értesítést), boolean.' },
    closed_by_code_type: { marad: 'Melyik KÓD-TÍPUSSAL zárult (címzetti/vészhelyzeti) — bizonyíték-érték, a kód maga ürül.' },
    delivery_code_attempts: { marad: 'A hibás kód-próbálkozások száma — brute-force védelem, szám.' },
    delivery_code_locked_until: { marad: 'A kód-zárolás lejárata — brute-force védelem, időbélyeg.' },
    reopened_count: { marad: 'Az újranyitások száma; a díj-visszaélés elleni plafon erre épül.' },
    photo_retention_hold: { marad: 'A bizonyíték-zárolás jelzője — épp a retenciót vezérli.' },
    payment_reminder_count: { marad: 'Belső könyvelés (hány emlékeztetőt küldtünk).' },
    last_payment_reminder_at: { marad: 'A legutóbbi fizetési emlékeztető időpontja — belső könyvelés, hogy ne spammeljünk.' },
  },

  route_bookings: {
    // ── Ürülnie kell ────────────────────────────────────────────────────
    pickup_address: 'rovidul',
    dropoff_address: 'rovidul',
    delivery_code: 'urul',
    tracking_token: 'urul',
    recipient_name: 'urul',
    recipient_phone: 'urul',
    recipient_email: 'urul',
    notes: 'urul',
    cancel_reason: 'urul',

    // ── Indokoltan marad ────────────────────────────────────────────────
    id: { marad: 'Elsődleges kulcs; a foglalás tényének megőrzéséhez kell.' },
    route_id: { marad: 'A járatra mutató kulcs, nem személyre; a járat külön retenció alatt áll (3 év).' },
    shipper_id: { marad: 'A foglalás TÉNYE a felhasználóhoz kötve marad; a fiók törlésekor megy.' },
    status: { marad: 'A fuvar/foglalás életciklusának végállapota — státusz-érték, nem személyes adat.' },
    status_before_dispute: { marad: 'A vita előtti státusz, hogy a lezárás visszaállíthassa. Státusz-érték.' },
    package_size: { marad: 'Csomag-méretkategória (S/M/L) — statisztika, nem személyes adat.' },
    length_cm: { marad: 'Csomag-paraméter (csomag-paraméter) — nem személyes adat, az árazási statisztikához kell.' },
    width_cm: { marad: 'Csomag-méret, nem személyes adat; az árazási statisztikához kell.' },
    height_cm: { marad: 'Csomag-méret, nem személyes adat; az árazási statisztikához kell.' },
    weight_kg: { marad: 'Csomag-paraméter (ugyanaz) — nem személyes adat, az árazási statisztikához kell.' },
    price_huf: { marad: 'A járat szakasz-ára — árazási statisztika, nem személyes adat.' },
    carrier_share_huf: { marad: 'Pénzügyi tétel (dormant escrow-maradvány), számviteli megőrzés.' },
    platform_share_huf: { marad: 'Csomag-paraméter (ugyanaz) — nem személyes adat, az árazási statisztikához kell.' },
    connection_fee_huf: { marad: 'A platform bevétele — számviteli megőrzés.' },
    fee_consent_at: { marad: 'A 45/2014. szerinti nyilatkozat ténye.' },
    cancellation_fee_huf: { marad: 'Csomag-paraméter (pénzügyi tétel) — nem személyes adat, az árazási statisztikához kell.' },
    refund_huf: { marad: 'Visszatérített összeg — pénzügyi tétel, számviteli megőrzés alá esik.' },
    currency: { marad: 'Pénznem-kód (HUF/EUR) — nem személyes adat.' },
    pickup_lat: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve.' },
    pickup_lng: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    dropoff_lat: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    dropoff_lng: { marad: 'ROUND(...,2) ≈ 1,1 km-re kerekítve — lakás azonosítására alkalmatlan, a piac-statisztikához kell.' },
    created_at: { marad: 'Csomag-paraméter (időbélyeg; retenciós óra) — nem személyes adat, az árazási statisztikához kell.' },
    confirmed_at: { marad: 'Csomag-paraméter (a megerősítés ténye) — nem személyes adat, az árazási statisztikához kell.' },
    paid_at: { marad: 'A díjfizetés ténye; számviteli hivatkozás.' },
    delivered_at: { marad: 'A teljesítés ténye; egyben a retenciós óra.' },
    cancelled_at: { marad: 'A lemondás ténye (az INDOKA ürül).' },
    cancelled_by: { marad: 'Felhasználó-azonosító, nem tartalom.' },
    anonymized_at: { marad: 'Az anonimizálás ténye — elszámoltathatóság.' },
    delivery_code_attempts: { marad: 'A hibás kód-próbálkozások száma — brute-force védelem, szám.' },
    delivery_code_locked_until: { marad: 'A kód-zárolás lejárata — brute-force védelem, időbélyeg.' },
    photo_retention_hold: { marad: 'Csomag-paraméter (a bizonyíték-zárolás jelzője) — nem személyes adat, az árazási statisztikához kell.' },
    // ⚠️ A két Barion-nevű oszlop a CIB payment-id-ját is hordozza (az
    // átnevezés külön migráció + 15 fájl — lásd CLAUDE.md).
    barion_payment_id: { marad: 'A PSP tranzakció-azonosítója; a fizetési napló 8 éves megőrzése alá esik (Számv. tv.).' },
    barion_gateway_url: { marad: 'A PSP fizetőoldalának linkje; lejárt token, a tranzakció-nyomkövetéshez tartozik.' },
  },

  // ⚠️ A HARMADIK ANONIMIZÁLT TÁBLA (2026-08-12, 11. mérés T2). A manifest
  // eddig csak a `jobs`-ot és a `route_bookings`-ot fedte — a `carrier_routes`
  // kimaradt, pedig az `anonymizeOldCarrierRoutes` ugyanúgy csupaszítja.
  // Lemérve: a `waypoints = '[]'::jsonb,` sor TÖRLÉSÉVEL mind a 811 teszt
  // zöld maradt, miközben a `waypoints` az, amit a függvény saját indoklása
  // MOZGÁSPROFILNAK nevez: „hogy egy magánszemély jellemzően mikor merre jár".
  carrier_routes: {
    // ── Ürülnie kell ────────────────────────────────────────────────────
    description: 'urul',
    vehicle_description: 'urul',
    waypoints: 'urul',
    title: 'rovidul',

    // ── Indokoltan marad ────────────────────────────────────────────────
    id: { marad: 'Elsődleges kulcs; a járat tényének megőrzéséhez kell.' },
    carrier_id: { marad: 'A járat TÉNYE a szállítóhoz kötve marad; a fiók törlésekor CASCADE viszi.' },
    departure_at: { marad: 'Az indulás időpontja — a retenciós óra alapja, cím és megállók nélkül nem azonosít.' },
    status: { marad: 'A járat életciklusának végállapota — státusz-érték, nem személyes adat.' },
    is_template: { marad: 'Sablon-jelző. A sablon a szállító visszatérő járata; az anonimizálás szándékosan kihagyja.' },
    template_source_id: { marad: 'Melyik sablonból készült — belső hivatkozás, nem személyes adat.' },
    created_at: { marad: 'Időbélyeg; a retenciós órák és a statisztika alapja.' },
    updated_at: { marad: 'Ugyanaz; a legutóbbi módosítás ideje.' },
    anonymized_at: { marad: 'Épp az anonimizálás ténye — enélkül nem tudnánk, hogy megtörtént (GDPR 5. cikk (2)).' },
    countries: { marad: 'Érintett országkódok — a ~1 km-es koordináta-kerekítésnél durvább felbontás.' },
    currency: { marad: 'Pénznem-kód, nem személyes adat.' },
    is_ride_along: { marad: 'Termék-jelző: személyszállítással együtt megy-e. Boolean, nem személyes adat.' },
  },
};

module.exports = { ANONIMIZALAS_MANIFEST };
