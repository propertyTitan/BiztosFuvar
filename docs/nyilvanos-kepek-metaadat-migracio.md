# Korábbi nyilvános képek metaadatainak kezelése

A 2026-09-24-i javítás az **új listing- és avatarképeket** a nyilvános mentés előtt tisztítja. A bizonyító pickup/dropoff/damage/document fotó és a privát KYC eredetije változatlan. Már közzétett állományt a deploy nem ír át és nem töröl.

## Most rendelkezésre álló, tényleges dry-run

`backend/scripts/public-image-dry-run.js` kizárólag SQL SELECT és a beállított saját R2-bucket `GetObject` hívásait használja. Nem tölt `.env`-t, nincs `--apply`, PUT, DELETE vagy DB-írás. Legfeljebb 100 rekordot vizsgál; a következő lapot `next_cursor` jelöli. Újrafuttatása idempotens. A kép feldolgozása memóriában történik; GPS-t, nevet, okmányt és nyers képbájtokat nem ír ki. A leltár tartalmazhat nyilvános objektum-URL-t, ezért új, 0600 jogosultságú fájl készül.

Külön, olvasási jogú DB- és csak az adott bucket `GetObject` műveletére jogosult R2-hozzáféréssel, explicit környezeti változókból:

```sh
cd backend
node scripts/public-image-dry-run.js --help
node scripts/public-image-dry-run.js --kind listing --limit 50 --out /biztonsagos/leltar-listing-01.json
node scripts/public-image-dry-run.js --kind avatar --limit 50 --out /biztonsagos/leltar-avatar-01.json
# További lap: --after listing:<az előző next_cursor UUID-ja>
```

Kötelező env: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`; TLS a megszokott `PGSSL=require` vagy connection-string beállítással. Titkokat ne mentsünk a leltárba vagy shell historyba.

Eredmények:

- `sanitize`: felismerhető EXIF/IPTC/XMP/ICC vagy komment van, a tisztított kép elkészíthető.
- `no_metadata_detected`: a dekóder nem jelzett ilyen adatot, és a feldolgozás sikerült. Ez nem teljes fájlformátum-forenzikai bizonyítás.
- `manual_review_evidence_reference`: ugyanazt az URL-t nem-listing fotó vagy vitás bizonyíték is használja. Az eredetit automatikusan törölni tilos.
- `manual_review_unreadable`: hiányzó, ismeretlen forrású, túl nagy, hibás vagy nem dekódolható fájl. A tárhely- vagy formátumhiba nem jelenti azt, hogy az eredeti törölhető.

## Jóváhagyandó adatmigráció konkrét sorrendje

Ez a fázis **nem futott le**, és a dry-run eszköz szándékosan nem hajtja végre. Író batch csak a leltár, az alábbi tranzakciós szabályok és CDN-jogosultság külön ellenőrzése után kerüljön élesbe.

1. Az új feltöltési védelem deploya után mentsük a teljes, lapozott leltárt. Először legfeljebb egy avatar és egy listing legyen a próbaköteg. Rögzítsük a forrás és a tisztított kép SHA-256 lenyomatát, a rekordazonosítót, a régi és új URL-t, valamint a képméretet; személyes EXIF-értéket ne naplózzunk.
2. **Új, véletlen objektumkulcsra** készüljön a tisztított változat. A régi objektumot ne írjuk felül: egy évig `immutable` cache-sel szolgált kép azonos URL-es cseréje a böngészőben/CDN-ben nem megbízható.
3. A feltöltés előtt ugyanaz a tartós `file_deletion_queue` feladat kerüljön a DB-be, mint az alkalmazás `avatarUpload/photoUpload` folyamatában. Az új tárhelyírás alatt a task sorát zároljuk; sikertelen finalizálásnál a task az új árvát takarítsa. Külső tárhelyírást tartós feladat nélkül ne indítsunk.
4. Finalizáláskor **user → job (listingnél) → fotó/task** sorrendben zároljunk. Újra ellenőrizzük, hogy a rekord létezik, ugyanaz az eredeti URL tartozik hozzá, és listing esetén még `kind='listing'`. A csere feltételes UPDATE legyen: `users WHERE id=$id AND avatar_url=$old_url`, illetve `photos WHERE id=$id AND kind='listing' AND url=$old_url`. Nulla sor esetén ne írjuk felül a felhasználó közben feltöltött képét.
5. A fotó szülőjének zára alatt újra ellenőrizzük a `disputes.evidence_url` és a nem-listing `photos.url` hivatkozásokat. Ilyen hivatkozásnál nincs automatikus eredetitörlés. Külön döntés kell privát eredeti példányról és a bizonyítékhoz való későbbi, naplózott hozzáférésről; a bizonyíték integritását a hash-sel meg kell őrizni.
6. Az új DB-URL, az új fájl előzetes takarítási taskjának fogyasztása és a régi, már sehol nem hivatkozott publikus kulcs törlési taskja **egy COMMIT** legyen. Egyéb avatar/listing hivatkozás esetén a régi kulcs az utolsó referencia cseréjéig maradjon. Bizonytalan COMMIT-válasz esetén a meglévő tartós task állapota döntsön; az új képet találomra törölni tilos.
7. A régi objektum törlését az újrapróbáló queue igazolja. A **régi URL-re célzott CDN-cache purge külön szükséges**; DB-csere vagy R2-törlés önmagában nem vonja vissza a cache-ben lévő képet. A saját Cloudflare-domain zónájához szükséges purge-jogot előre biztosítani kell. R2.dev vagy más szolgáltatói URL esetén a megfelelő szolgáltatói cache-eljárás megerősítéséig a privacy-backfill nem minősíthető lezártnak.
8. Ellenőrizzük az új URL képi tartalmát, tájolását és metaadatmentességét, majd a régi URL több cache-útvonalon adott válaszát. Már letöltött klienspéldányt utólag nem lehet visszavonni. A többi, kis köteges átalakítás csak e próba után következzen.

Lezárási feltétel: a módosítható összes publikus rekord tisztított URL-t használ; minden kihagyott/hibás/bizonyítékhoz kötött rekordnak tételes döntése van; a régi objektumok és CDN-példányok törlésének eredménye ellenőrzött. A puszta kóddeploy ezt nem teljesíti.

## Formátum és működési korlát

A runtime JPEG/PNG/WebP/GIF/AVIF képet dekódol és metaadat nélkül újrakódol; tájolást alkalmaz, GIF/WebP animációt megőriz. A korlát 64 megapixel, legfeljebb 20 MiB kimenet és 10 másodperc feldolgozás. A bizonyító és KYC-képeknél nincs ilyen átalakítás. A gyári Sharp/libvips HEVC-HEIC dekódolása nem garantált; nem támogatott képnél 400 és JPG/PNG újramentési útmutató jár. Ezt eredeti, GPS-es publikus fájlra való visszaesés soha nem kerülheti meg.

Technikai háttér: [Sharp kimeneti metaadatkezelés](https://sharp.pixelplumbing.com/api-output/), [Sharp bemeneti korlátok](https://sharp.pixelplumbing.com/api-constructor/). A szerveroldali szűrést nem helyettesíti kliensoldali canvas vagy böngészőfüggő átalakítás.
