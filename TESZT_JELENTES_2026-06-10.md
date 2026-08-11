# GoFuvar — Átfogó tesztjelentés (2026-06-10)

Modulonkénti mélyvizsgálat: web UI/UX, web frontend logika, backend (biztonság + üzleti logika), mobil app.
Súlyosság: 🔴 KRITIKUS · 🟠 SÚLYOS · 🟡 KÖZEPES · ⚪ POLÍR

> **FONTOS ELŐZETES MEGJEGYZÉS:** A helyi munkakönyvtár **kb. 1 hónappal le van maradva** a GitHub-hoz képest!
> A `mobile/BiztosFuvar/` mappa valójában a teljes repó egy **újabb klónja** (utolsó commit: 2026-06-05, PR #36–39),
> míg a külső repó 2026-05-08-nál áll. Az upstream már javít néhány itt felsorolt hibát (pl. hiányzó `Alert` import).
> **Első lépés: `git pull`, utána a `mobile/BiztosFuvar/` klón törlése.** Az alábbi hibákat a pull után újra kell ellenőrizni.

---

## 1. WEB — UI/UX (profi megjelenés)

### 🔴 Kritikus

1. **A build el van törve — a sofőrök fő fuvarkereső oldala nem fordul le.**
   `web/app/sofor/fuvarok/page.tsx:411-413` — a `c3c95a5` commit („hide fee from shipper") kitörölte az ár-oszlop nyitó `<div>`-jeit, de otthagyta a címkét és két záró `</div>`-et. A `next build` elhasal. *Megjegyzés: ez az oszlop a feladó által javasolt árat mutatta a sofőröknek (licitekhez kell), nem a platformdíjat — vissza kell állítani.*
   Ráadásul a `next.config.js` `ignoreBuildErrors: true` + `eslint.ignoreDuringBuilds: true` beállítása miatt csúszhatott át — **mindkettőt kapcsold ki.**

2. **`useSearchParams()` Suspense nélkül** — `bejelentkezes/page.tsx:20`, `sofor/uj-utvonal/page.tsx:21`, `fizetes-stub/page.tsx:31`. Az 1. pont javítása után ezen fog elhasalni a build. Fix: `<Suspense>` wrapper.

3. **Halott link a főmenüben:** „AI segéd" → `/ai-chat`, de ilyen oldal nem létezik (`SiteHeader.tsx:308`, `HomeHub.tsx:434`). A felhasználó 404-re fut a profilmenüből.

### 🟠 Súlyos

4. **Ékezet nélküli magyar szövegek élesben** — a legláthatóbb „amatőr" jel:
   - `dashboard/uj-fuvar/page.tsx:735` „Szamlat kerek errol a fuvarrol" + `:738` hosszabb mondat
   - `sofor/fuvarok/page.tsx:369` „Ellenorzott Ceg"
   - `KycModal.tsx:153` `aria-label="Bezaras"`

5. **`alert()` / `prompt()` / `confirm()` üzletileg kritikus folyamatokban**, pedig van toast-rendszer:
   - vita indítás leírása `prompt()`-ban (`dashboard/fuvar/[id]/page.tsx:460`)
   - **admin visszatérítési összeg `prompt()` szövegmezőben!** (`admin/page.tsx:143,153`)
   - fióktörlés `confirm()`-mal (`profil/page.tsx:297`)
   - licit validáció `alert()` (`sofor/fuvar/[id]/page.tsx:93`), ChatBox, útvonalak…
   Fix: közös `<ConfirmDialog>` / `<InputDialog>` komponens (a KycModal minta megvan).

6. **Színrendszer szétcsúszott** — a `globals.css` token-rendszerét mindenhol hardcodeolt hexek kerülik meg: 3 párhuzamos paletta (`#EF4444` vs `--danger:#dc2626`; `#2E7D32`/`#16a34a` vs `--success`; 5 féle narancs; off-brand türkiz `#4ECDC4` a sofőr dashboardon). Gombsugarak 6/8/10px keverve.

7. **Dark mode `!important` + `[style*="#dcfce7"]` attribútum-hackekkel** van összetartva (`globals.css:65,147-184`). A `#fefce8` háttér pl. nincs a listában → sötét módban olvashatatlan. Fix: `.banner-success`/`.banner-warning` osztályok dark variánssal.

8. **Minden oldal ugyanazt a böngészőcímet mutatja** — csak a root layout exportál metadata-t. Nincs `favicon.ico`/`apple-touch-icon` (csak SVG), nincs `robots.txt`, `sitemap`. SEO-s piactérnél ez sok.

9. **Zoom letiltva** (`layout.tsx:38` `user-scalable=no`) — WCAG 1.4.4 sértés, gyengénlátóknak használhatatlan.

10. **Akadálymentesség gyakorlatilag nulla:** 0 db `htmlFor`, 6 db `aria-*` az egész kódbázisban. A label-ek nincsenek inputhoz kötve, hibaüzenetek nem `role="alert"`, toast nem `aria-live`.

11. **Auth-villanás és néma hibák:** `ertesitesek/page.tsx:70` bejelentkezett usernek is felvillan a „Lépj be…"; `profil/page.tsx:43` hiba esetén örök „Betöltés…"; `sofor/dashboard` hibája csak konzolra megy. Fix: közös `useRequireAuth()` + `<ErrorState onRetry>`.

12. **Nyelvváltó becsapós:** EN-re váltva csak 3 komponens fordul le, a többi 31 oldal magyar marad. Rejtsd el a váltót, amíg nincs valódi fordítás.

### 🟡 Közepes / ⚪ Polír

13. Magyar szöveghibák: „licitedre válaszra vár" → „licited válaszra vár" (`HomeHub.tsx:273`); „Level 2", „Verified", „voucher" angolul magyar UI-ban (`HomeHub.tsx:97-100`); „SAJÁT POSZT" → „Saját hirdetés"; fuvar/hirdetés/munka terminológia keveredik; rossz záró idézőjel `„…"` → `„…”` (3 helyen); `mentes/page.tsx:16` „Kérjük, nézz vissza" tegezés-magázás keverés.
14. Betöltési állapotok: a szép kamionos `app/loading.tsx` mellett minden oldalon sima `<p>Betöltés…</p>` — közös `<Loading/>` komponens + skeleton kártyák.
15. Üres állapotokból hiányzik a CTA (`sofor/fuvarok`, `ertesitesek`).
16. Konfetti minden oldalbetöltésnél elsül delivered státusznál, nem csak a kézbesítés pillanatában (`dashboard/fuvar/[id]/page.tsx:219`).
17. Státusz-pill mindig kék a részletoldalakon, lemondott fuvar is (`dashboard/fuvar/[id]:136`, `sofor/fuvar/[id]:157`); `STATUS_PILL`-ből hiányzik a `disputed` (`foglalasaim:25-32`).
18. Bejelentkezés: nincs „elfelejtett jelszó" link, jelszó-megjelenítés, `autocomplete` attribútumok.
19. Fájlfeltöltés natív, csúnya `<input type="file">` (`uj-fuvar:287`).
20. Google Fonts render-blokkoló `@import`-tal → `next/font` ajánlott.
21. Emoji-ikonrendszer (🚛📍🔔) → egy kis SVG ikonkészlet sokat dobna a percepción.
22. Publikus követőoldal: számított de nem renderelt ETA (halott kód, `nyomon-kovetes/[token]:81`), teljes app-fejléc loginnal a címzettnek — minimál chrome jobb lenne.

---

## 2. WEB — Frontend logika (hibák)

### 🔴 Kritikus

1. **Rossz jelszónál a user SOSEM látja a hibát** — `src/api.ts:233-239` minden 401-re (a `/auth/login`-ra is!) töröl + átirányít a login oldalra → az oldal újratöltődik, a hibaüzenet elveszik, az űrlap kiürül. Fix: `/auth/*` kivételezése az auto-logout alól.

2. **A Socket.IO-n minden chat mindenkihez megy** — `messages.js:78` `emitGlobal` = `io.emit` az ÖSSZES kliensnek; a szűrés csak kliensoldali eseménynév. Bárki `socket.onAny()`-vel a platform összes privát üzenetét olvassa. (Részletek a backend szekcióban.)

### 🟠 Súlyos

3. **QR-kód kép végleg halott** — `QrCode.tsx:27` a 2019-ben leállított `chart.googleapis.com` API-t hívja → törött kép a követőoldalon és a kódkártyán. Fix: `qrcode` npm csomag, kliensoldali render.
4. **Az admin vita-lista mindig üres** — `admin/page.tsx:43` a `myDisputes()`-t hívja (admin saját vitái), nincs „összes vita" endpoint → a viták a UI-ból sosem rendezhetők. Fix: `GET /disputes` (admin) a backendre.
5. **„Szűrők törlése" a régi szűrőkkel kérdez le újra** (stale closure + `setTimeout` hack) — `sofor/fuvarok:253-259`, `dashboard/utvonalak:160-166`. Fix: paraméterben átadott értékek.
6. **A lemondási díj szövege ellentmond az ügyvéd által jóváhagyott szabálynak** — `foglalasaim:63` még „10%, max 1000 Ft"-ot ír, a backend 400 Ft / 5%-ot von. A feladó rossz feltételekbe egyezik bele. (A `backend/src/constants.js:88-97` halott 10%-os kódja + 4 elavult komment/email-szöveg is frissítendő.)
7. **Google Maps kulcs nélkül az új fuvar űrlap némán beadhatatlan** — a kézi cím-fallback sosem ad koordinátát, a `canSubmit` örökre false (`AddressAutocomplete.tsx:55`, `uj-fuvar:167`).
8. **ToastProvider minden rendernél új context-objektumot gyárt** (`ToastProvider.tsx:60`) → a SiteHeader minden toastnál újra feliratkozik + újra lekérdezi az olvasatlan értesítéseket. Fix: `useMemo`.

### 🟡 Közepes

9. Publikus követőoldal: egy átmeneti hálózati hiba után örökre „Fuvar nem található" (a `setError('')` hiányzik sikernél, `nyomon-kovetes/[token]:46-72`); `disputed` státusz „Sofőrt keresünk"-ként jelenik meg.
10. Licit-elfogadás és foglalás-megerősítés gombja duplakattra dupla POST-ot küld (nincs pending-tiltás).
11. „null. emelet" jelenik meg, ha `needs_carrying` igaz de a floor null (`sofor/fuvar/[id]:288,300`).
12. Foglalás után rossz oldalra visz a redirect (`/dashboard` → hirdetések, nem a foglalások).
13. AI chat előzmények nem usrenkénti localStorage-kulcson — fiókváltásnál az előző user beszélgetése megy kontextusként a Geminihez (`AiChatWidget.tsx:14`).
14. `subscribeJob` nem szűr job-id-re és ref-count nélkül lép ki a szobából (`src/lib/socket.ts:78-107`).
15. Object-URL leak a fotó-előnézeteknél (`uj-fuvar:128`); `router.push` render közben (`profil:83`); Bid type-ból hiányzó mezők (`rating_avg`, `carrier_name`) — a kikapcsolt tsc miatt némán.

---

## 3. BACKEND — Biztonság és üzleti logika

*(SQL injection: NINCS — minden lekérdezés paraméterezett. Az alábbiak auth/IDOR, fizetési bizalom, versenyhelyzet és „fail-open" hibák.)*

### 🔴 Kritikus

1. **A kézbesítési kód teljes védelme megkerülhető — a sofőr ki tudja olvasni a címzett kódját.**
   `jobs.js:40-53` a `scrubJobForUser` törli a kódokat, de a `tracking_token`-t NEM → a sofőr a `GET /jobs/:id`-ből kiveszi a tokent → a publikus `GET /tracking/:token` (`publicTracking.js:84`) **plaintextben visszaadja a `delivery_code`-ot** → a sofőr a címzett nélkül lezárja a fuvart, a letét felszabadul. **A teljes fotó+kód letéti modell kijátszható, brute force se kell.**
   Fix: `tracking_token` (és recipient mezők) kiszűrése nem-feladónak; a publikus tracking endpoint SOHA ne adja vissza a kódot.

2. **IDOR a `GET /jobs/:id`-n** — bármely bejelentkezett user bármely fuvar teljes sorát lekérheti: címzett neve/telefonja, pontos címek, tracking token, Barion ID-k (`jobs.js:390-417`). Fix: shipper/carrier/admin jogosultság-ellenőrzés.

3. **A 6-jegyű kód brute force-olható** — a dropoff fotó endpointon (`photos.js:37-82`) nincs kísérletszámláló/lockout, csak a globális 300/perc/IP limit; ráadásul 2 érvényes kód van (címzett + feladó vész) = dupla esély. Fix: 5 próba/óra per (job,user) + lockout + constant-time összehasonlítás.

4. **Letét dupla-felszabadítási verseny** — `photos.js:114-176`: nincs tranzakció, nincs `FOR UPDATE`, a `status='delivered'` és `escrow released` UPDATE-eknek nincs `WHERE status=...` guardja → két párhuzamos dropoff = **dupla Barion-átutalás a sofőrnek**. Fix: tranzakció + sor-lock + guardolt UPDATE + rowCount ellenőrzés.

5. **Éles SMS API kulcs hardcodeolva a repóban** — `sms.js:20` (`zktq7...`), a stub emiatt SOSEM kapcsol be → dev/teszt is élesben SMS-ezik, és a kulcs kiszivárgott. **Azonnal rotálni**, csak env-ből olvasni, üres env = stub.

6. **A Barion webhook vakon hisz a request body-nak** — `payments.js:26-258`: bárki POST-ol egy `Status:'Succeeded'`-et → `paid_at` beáll, számla generálódik. Nincs aláírás-ellenőrzés, nincs szerveroldali `GetPaymentState` visszaigazolás (stub módban a payment ID ráadásul kitalálható: `stub-${jobId}`). Fix: Barion `GetPaymentState` hívás a POS kulccsal, a body státuszát soha ne fogadd el.

### 🟠 Súlyos

7. **Socket.IO auth nélkül** — `realtime.js:18-35`: bárki beléphet bármely `user:<id>` és `job:<id>` szobába → más értesítései, GPS-pingek, chat. Fix: JWT a handshake-ben, szerveroldali szoba-hozzárendelés, `emitToUser` a globál emit helyett.
8. **IDOR-csokor további olvasó endpointokon:** `GET /jobs/:jobId/bids` (minden licit + sofőr-identitás), `GET /jobs/:jobId/photos`, `GET /jobs/:jobId/escrow` + `payout-status` (pénzügyi bontás), `GET /jobs/:jobId/location/last` (GPS). Mindenhova ownership-check kell (a `messages.js`/`disputes.js` mintája megvan).
9. **A KYC „fail-open"** — ha nincs `GEMINI_API_KEY` vagy hibázik az AI, a `verifyKycDocument` `{valid:true}`-t ad (`gemini.js:399,472`) → automatikus `verified` státusz, ÉS a dokumentumszám-kinyerés híján az „egy igazolvány = egy fiók" csalásvédelem is kimarad. Fix: AI-hiba esetén `pending` (kézi ellenőrzés), soha nem `verified`.
10. **Jutalék-eltérés a webhookban** — `payments.js:115-116` csak 10%-ot számol, a +400 Ft fix díj lemarad → a `payment_events` és a sofőr platformdíj-számlája 400 Ft-tal kevesebbet mutat, mint a tényleges letéti felosztás. Fix: `barion.calculatePlatformFee()` használata itt is.
11. **A „fizetés megerősítése" önbevallásos** — `jobs.js:530-599`: a feladó Barion-ellenőrzés nélkül beállíttatja a `paid_at`-ot, és a kézbesítés nem követeli meg a `paid_at`-ot a letét felszabadítása előtt → inkonzisztens állapot pénz nélkül.
12. **Licit-elfogadás nem zárolja a job sort** — két párhuzamos accept két Barion-foglalást indíthat (`bids.js:196-321`). Fix: `SELECT … FOR UPDATE` a jobs-ra + guardolt UPDATE.

### 🟡 Közepes

13. Feltöltött fájlok típusa nincs validálva (csak méret) — HTML/SVG feltöltés a publikus `/uploads`-ról kiszolgálva stored-XSS lehet. MIME allowlist kell.
14. Async route-handlerek try/catch nélkül (Express 4 nem kapja el) → DB-hiba = beragadt kérés. `asyncHandler` wrapper.
15. A hibakezelő `detail: err.message`-et ad vissza a kliensnek — éles módban elrejteni.
16. `/tracking/:token` és `/calculator` a rate-limiter ELŐTT van mountolva (`index.js:53-64`).
17. Fióktörlés CASCADE-del törli a múltbeli fuvarokat + letéti/fizetési sorokat is — pénzügyi audit-adat vész el; lezárt tranzakciós előzménnyel rendelkező usernél anonimizálás kell törlés helyett.
18. KYC duplikátum-ellenőrzés TOCTOU; az insert-kori 23505-öt nem kezeli → 500 a tiszta 409 helyett.
19. GPS 50 m geofence valójában NINCS kézbesítéskor (csak evidenciaként tárolódik — ha ez tudatos döntés, oké, de a kód-brute-force fix enélkül még fontosabb).
20. In-memory rate-limit + coverage state → több instance-nál/újraindulásnál elveszik.

---

## 4. MOBIL APP (Expo SDK 54)

### Szerkezet — első teendők

- **`mobile/BiztosFuvar/` = a teljes repó véletlenül beklónozva** (1 hónappal újabb, mint a külső fa!). Teendő: külső repóban `git pull`, majd a beágyazott klón **törlése** (előtte a `.mcp.json` kimentése, ha kell).
- **`mobile/.en` = elgépelt `.env`** (LAN dev IP-vel). Nem tölt be semmit (a valódi, gitignore-olt `.env` jó), de félrevezető — **törölni**.
- **`mobile/brew.sh` = a Homebrew telepítő script bemásolva** (32 KB szemét) — törölni.
- A módosított `package.json` **helyes** SDK 54-igazítás (a commitolt verziók voltak rosszak) — **commitold**. A `.npmrc` `legacy-peer-deps` valószínűleg már elhagyható.
- **`tsconfig.json` módosítása hibás:** az `include` besöpri a beágyazott klónt → 1065 fake tsc hiba (React 18/19 típusütközés), és kiesett az `.expo/types` + `expo-env.d.ts`. Visszaállítani + `"exclude": ["node_modules", "BiztosFuvar"]`.

### 🔴 Kritikus

1. **`app/feladas/foglalasaim.tsx:60` — `Alert` nincs importálva** → azonnali crash a foglalás-lemondás gombnál. (Upstream már javította — +1 ok a pullra.)
2. **iOS háttér-GPS nem fog menni:** `app.config.js`-ből hiányzik a `ios.infoPlist.UIBackgroundModes: ["location"]` — enélkül a teljes háttérkövetés némán nem működik iOS-en.
3. **A háttér-task csak a fuvar-képernyő moduljából importálódik** (`app/fuvar/[id].tsx:14`) — ha az OS headless indítja újra az appot, a task nincs definiálva, a pingek elvesznek. Fix: `import '@/services/backgroundTracking'` az `app/_layout.tsx` tetejére.

### 🟠 Súlyos

4. A követés a képernyő elhagyásakor leáll (unmount cleanup hívja a `stopBackgroundTracking`-et) — a lifecycle-t a fuvar státuszához kell kötni, nem a képernyőhöz.
5. Az „5 km-en belül gyorsítás" minden 15 mp-es pingnél stop/start-olja a location updates-t, és sosem lassul vissza (`backgroundTracking.ts:75-91`).
6. **Szűrők sosem érvényesülnek** a fuvarlistán — `useCallback(..., [])` stale closure (`app/fuvarok.tsx:54-75`). (Ugyanaz a hibaminta, mint weben!)
7. Push: `getExpoPushTokenAsync()` projectId nélkül + pre-SDK-53 `setNotificationHandler` alak (`app/hub.tsx:44-60`) → push némán halott EAS buildben; `platform` defaultból 'ios' Androidon is.
8. **JWT AsyncStorage-ben** (plaintext, mentésbe kerül) → `expo-secure-store`.
9. `app.config.js`: nincs `icon`/`splash`/`adaptiveIcon` (default Expo ikonnal menne store-ba), nincs `eas.projectId`; **hiányzik az `NSPhotoLibraryUsageDescription`** → iOS crash + App Store elutasítás a galéria-választásnál.
10. QR-szkenner Alert-spam: érvénytelen QR-nél másodpercenként tucatnyi Alert (`fuvar/[id]/lezaras.tsx:107-128`).
11. Safe area sehol: hardcodeolt `paddingBottom`, a tartalom a tab bar alá lóg, kamera-gomb a home indicatoron.
12. A `mobile/.env`-beli Google Maps kulcs a JS bundle-be kerül és REST hívásban is megy — **app-restrikció (bundle ID/SHA-1) + rotálás** kell.

### 🟡 Közepes

13. KeyboardAvoidingView csak az AI chatben — a fuvar-chat és a login input billentyűzet alá kerül.
14. 401-nél a kliens törli a tokent, de nem navigál/nem szól → törött képernyő tab-barral.
15. `hu.json`/`en.json` (180 kulcs) teljesen bekötetlen — bekötni vagy törölni.
16. ToastProvider ugyanaz a re-render hiba, mint weben (`useMemo` hiányzik).
17. tsc (klón kizárása után) 3 valódi hibát ad: az Alert-import, a `'listing'` photo-kind típushiány, a NotificationBehavior új mezői.

---

## 5. PRIORIZÁLT CSELEKVÉSI TERV

### Azonnal (élesben kihasználható / törött)
1. `git pull` + `mobile/BiztosFuvar/`, `.en`, `brew.sh` törlése — minden további munka előtt.
2. **SeeMe SMS kulcs rotálása** + env-be helyezése (B-C5).
3. **`tracking_token` kiszűrése + a publikus tracking ne adja vissza a kódot** (B-C1) + IDOR-ok befoltozása (B-C2, B-M2).
4. **Web build javítása** (`sofor/fuvarok` ár-oszlop visszaállítása + Suspense) és a `next.config.js` hibaelnyelés kikapcsolása.
5. Kód-brute-force védelem + letét-tranzakciók (B-C3, B-C4), Barion webhook-ellenőrzés (B-C6).
6. Login 401-redirect javítás (a userek most nem tudják, miért nem tudnak belépni).

### Élesítés előtt (Barion-szerződésig bőven befér)
7. Socket.IO autentikáció + szobakezelés (chat-szivárgás).
8. KYC fail-open → fail-closed; webhook jutalék +400 Ft; bid-accept lock.
9. Lemondási díj szövegek egységesítése (jogi kockázat!) + halott 10%-os kód törlése.
10. Admin vita-lista endpoint; QR-kód csere `qrcode` csomagra.
11. Mobil: UIBackgroundModes, backgroundTracking import a _layout-ba, SecureStore, app ikonok + photo permission.

### Profi UI-csomag (a „hihetetlenül profi" hatáshoz)
12. Ékezetes szövegek javítása (4 string — 10 perc, hatalmas hatás).
13. `alert/prompt/confirm` → márkázott modálok (külön: admin visszatérítés rendes űrlapra).
14. Színtokenek egységesítése + `.btn-danger`/`.btn-ghost` + dark-mode hackek kiváltása.
15. Oldalankénti title + favicon-készlet + robots/sitemap.
16. Egységes Loading (kamionos!) / ErrorState / EmptyState CTA-val.
17. Akadálymentesség: zoom vissza, `htmlFor`, `role="alert"`, `aria-live`.
18. Magyar szövegkorrektúra (terminológia, idézőjelek, „Level 2"→„2. szint").
19. EN nyelvváltó elrejtése vagy az i18n befejezése.
20. Emoji-ikonok → SVG ikonkészlet; skeleton loaderek; `next/font`.

---

*Készült: 2026-06-10, négy párhuzamos mélyvizsgálattal (web UI, web logika, backend, mobil). A pontos fájl:sor hivatkozások a 2026-05-08-as helyi fára vonatkoznak — `git pull` után egyes sorszámok eltolódhatnak, néhány hiba pedig már javított lehet.*
