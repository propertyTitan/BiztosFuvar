# Díjfizetési napló és munkamenet helyreállítása

A 2026-09-24-i A05/A06 javítás a helyi pénzügyi konzisztenciát rendezi. A kapcsolatfelvételi díj továbbra is 500/1000 Ft; a szállítás árát a feladó közvetlenül a szállítónak fizeti. Nincs új migráció.

## Új fizetések

A `paid_at`, a fuvar díjsorának felszabadítása, a `fee_payment_receipts` bizonylat és a végleges `payment_events` esemény egy PostgreSQL-tranzakcióba kerül. Az eseményhez tartozó meglévő adatbázis-trigger ugyanebben a tranzakcióban rendezi a `payment_sessions` állapotát. Bármelyik helyi írás hibájára az egész könyvelés visszagörgetődik; számlázás csak a sikeres commit után indul. A callback ilyenkor hibát ad, az előzetes claim felszabadul, és az ismétlés ugyanazt a befizetést egyszer könyveli.

A fuvar és a foglalás `/pay` végpontja közös szolgáltatásban zárolja az ügyletet, majd frissen ellenőrzi az árat és a sessiont. A fuvar escrow-sorát külön, a sorzár megszerzése utáni lekérdezés olvassa. A párhuzamos kérések ugyanazt a függő fizetést kapják. A hiteles callback által `closed` állapotba tett munkamenet helyett új indítható, a korábbi session megmarad. `succeeded`/`needs_review` állapotnál 409 a válasz; függő vagy ismeretlen sessionazonosító gateway nélkül szintén 409, `PAYMENT_RECONCILIATION_REQUIRED` kóddal.

## Korábbi, hiányos könyvelések

A meglévő `fee-invoices` ütemező indulás után három perccel, majd tízpercenként meghívja a napló helyreállítását is. Ez a már kiszámlázott bizonylatokat is vizsgálja; új callback nem szükséges. A két percnél régebbi bizonylatok közül a hiányzó/feldolgozatlan `Succeeded` eseményt, illetve a függő sessiont keresi.

Automatikus javítás csak az alábbi bizonyítékok együttes meglétekor történik:

- A díjbizonylat és a meglevő, fizetett ügylet fizetője, ügyletazonosítója és fizetési ideje egyezik. Az idő összehasonlítása a Node/PostgreSQL adapter által őrzött milliszekundumos pontosságon történik.
- A fizetéskori, 1-es verziójú számlázási pillanatkép rendelkezésre áll, pénzneme és bruttó összege a bizonylatéval egyezik.
- A `Succeeded` esemény eredeti típusa `webhook` vagy `manual`; a megmaradt eseményadatok nem ellentmondásosak. Egy eredeti, még üres `processed=false` claim elegendő, teljes eseménysort nem követel meg.
- A létező session ügyletazonosítója, fizetője, összege és pénzneme is egyezik, és állapota `pending` vagy `succeeded`.

A helyreállítás sorzár alatt, egy tranzakcióban pótolja a végleges eseményt, és a trigger rendezi a sessiont. Nem hív fizetési szolgáltatót, nem módosít összeget vagy fizetéskori vevőadatot, nem hoz létre új terhelést. A hiányzó eseménytípus, hiányzó snapshot vagy ellentmondó összeg kézi egyeztetési hibaként jelenik meg a `fee-payment-recovery` Sentry/log csatornán. Ezek a sorok változatlanok maradnak; a kulcs szerinti, ötvenes lapozás továbbhalad a későbbi tételekre, majd a normál számlázás is lefut.

## Olvasási előellenőrzés és kézi egyeztetés

Az alábbi lekérdezés nem módosít adatot, és nem ad vissza vevőnevet, címet vagy adószámot. Az üzemeltető a szokásos, jogosult adatbázis-hozzáféréssel futtathatja; a javítás elkészítése során éles adatbázison nem futott.

```sql
BEGIN READ ONLY;
SELECT r.payment_id, r.job_id, r.booking_id, r.shipper_id,
       r.fee_huf, r.currency, r.paid_at,
       r.invoice_snapshot IS NOT NULL AS has_invoice_snapshot,
       e.event_type, e.processed,
       s.state AS session_state, s.amount_huf AS session_amount,
       s.currency AS session_currency, s.is_simulated,
       COALESCE(j.paid_at, b.paid_at) AS entity_paid_at,
       COALESCE(j.shipper_id, b.shipper_id) AS entity_shipper_id
FROM fee_payment_receipts r
LEFT JOIN payment_events e
  ON e.payment_id = r.payment_id AND e.status = 'Succeeded'
LEFT JOIN payment_sessions s ON s.payment_id = r.payment_id
LEFT JOIN jobs j ON j.id = r.job_id
LEFT JOIN route_bookings b ON b.id = r.booking_id
WHERE r.paid_at < NOW() - INTERVAL '2 minutes'
  AND (e.id IS NULL OR NOT e.processed OR s.state = 'pending')
ORDER BY r.payment_id;
COMMIT;
```

1. A futó javított verzió első ütemezett köre után az előellenőrzést ismételten le kell futtatni. A megmaradt payment ID-khez az eredeti bizonylatot, számlát, sessiont és callback/teszt-nyugtázási bizonyítékot együtt kell egyeztetni. A `manual` esemény és az `is_simulated` jelölés nem igazol valós banki befizetést.
2. Hiányzó eseménynél a valós banki eredményt és az eredeti esemény típusát a szolgáltató nyilvántartásából vagy a megőrzött, ellenőrzött callbackből kell bizonyítani. Ha ez nem lehetséges, az állapot kézi egyeztetésen marad. A `paid_at` önmagában nem elég, kupon is beállíthatja.
3. Hiányzó számlázási snapshotnál csak a fizetéskori, ellenőrzött számla/bizonylat adataiból szabad helyreállítani azt. Az aktuális felhasználói profil újraolvasása nem helyettesíti a történeti adatot. Ellentmondó összeg vagy azonosító esetén előbb az eltérés okát kell tisztázni; nincs általános tömeges UPDATE.
4. A szükséges, payment ID-ra szűkített adatkorrekciót külön, ellenőrizhető módosításként kell elkészíteni az egyeztetett előállapottal. A zárolási sorrend: felhasználó → ügylet → bizonylat → esemény → session. Ha bármelyik előfeltétel közben megváltozott, rollback szükséges. A hiányzó bizonyító adat javítása után a következő kör a fenti őrökön keresztül véglegesít; a session kézi `succeeded`-re állítása önmagában nem javítás.
5. Utóellenőrzés: az eredeti fizetéshez egyetlen díjbizonylat és egy végleges, helyes típusú `Succeeded` esemény tartozzon; a session legyen `succeeded`, az ügylet fizetési időpontja és az összeg maradjon változatlan. Ha a számla már létezett, ne keletkezzen új számla. A következő ütemezett kör legyen idempotens.

## Ellenőrzött működés és banki korlát

A javítás előtti tíz új regresszió mind hibát jelzett. A végleges célzott készlet 17 fájlban 141 tesztet teljesített, benne 23 új esettel: tényleges SQL-triggerrel okozott naplóhiba, webhook és kézi nyugtázás, fuvar és foglalás, `Expired`/`Canceled`, párhuzamos első és ismételt indítás, valódi PostgreSQL lockvárás, callback nélküli történeti helyreállítás, bizonytalan adatok visszautasítása, és ötven kézi review tétel után is továbbhaladó helyreállítás/számlázás. A korábbi rewebhook tesztek változatlanok maradtak.

A banki újraindítás tesztje különálló sessionazonosítókat adó helyettesítő adaptert használ. Ez nem valódi CIB/QVIK-integrációs igazolás. A jelenlegi szimulátor az ügylethez determinisztikus azonosítót ad; tesztmódban a lezárt session kézi nyugtázása továbbra is használható. A valódi adapter bevezetése előtt külön igazolandó a szolgáltatói hitelesítés, az állapotellenőrzés és a callback-feldolgozás, valamint a külső PSP-hívás és a helyi DB-commit közötti folyamatleállást túlélő idempotencia/egyeztetés. Ezt a helyi tranzakció önmagában nem oldja meg; a mostani javítás nem vezet be kitalált banki API-t.
