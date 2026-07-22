# Érdekmérlegelési tesztek (GDPR 6. cikk (1) f)

**Adatkezelő:** Tiszta Hód Kft. (GoFuvar platform, gofuvar.hu)
**Verzió:** 1.0 (munkapéldány) · **Kelt:** 2026-07-20
**Készítette:** AI-asszisztens a platform tényleges működése alapján;
jóváhagyja: Jovány Gyula ügyvezető

Ez a dokumentum a GoFuvar három, jogos érdeken alapuló adatkezelésének
érdekmérlegelési tesztjét rögzíti. A NAIH gyakorlata szerint a jogos
érdekre (GDPR 6. cikk (1) f) alapított adatkezelésnél az adatkezelőnek
előzetesen, írásban kell elvégeznie és dokumentálnia a mérlegelést; ez a
dokumentum ezt a kötelezettséget teljesíti.

---

## I. teszt — Szállítói távoli okmány-azonosítás (KYC)

### 1. Az adatkezelés leírása

A GoFuvar P2P fuvarközvetítő platform. A **Szállítóként** (fuvarozóként)
tevékenykedni kívánó felhasználó az első ajánlattétel előtt feltölti a
személyi igazolványa két oldalának fényképét. A képet a rendszer
mesterséges intelligencia (Google Gemini) segítségével előellenőrzi
(okmány-jelleg, olvashatóság, név és születési dátum kiolvasása, 18. életév
betöltésének ellenőrzése), majd **minden esetben emberi adminisztrátor
dönt** a jóváhagyásról. A nyers okmányfotó a döntést követő **30 nap
elteltével automatikusan és véglegesen törlődik**; megmarad a
verifikációs státusz és az okmányszám kriptográfiai lenyomata
(`doc_number_hash` — lásd II. teszt).

2026-07-19-től az okmány-azonosítás **kizárólag a szállítói
tevékenységhez** kötelező; a Feladónak nem kell (tőle csak kockázati
alapon — visszaélés gyanúja, vitarendezés — kérhető azonosítás, az ÁSZF
3.2 alapján, ugyanezen teszt megfelelő alkalmazásával).

### 2. A jogos érdek azonosítása

- **A feladók (és címzettek) személy- és vagyonbiztonsága**: a szállító
  idegen otthonokba megy be, más tulajdonát veszi át és készpénzt vesz át.
  A platform bizalmi modellje azon áll, hogy a szállító valós,
  azonosított, 18 év feletti személy.
- **Csalás- és visszaélés-megelőzés**: kamu szállító-fiókok, kitiltott
  felhasználók visszatérésének megakadályozása, csomag-eltulajdonítás
  visszatartása (a tettes azonosítható).
- **Jogi igények előterjesztése, érvényesítése és védelme**: káresemény,
  bűncselekmény vagy vitás ügy esetén a felek és a hatóságok felé a
  szállító személye megállapítható.
- Az érdek **harmadik feleké is** (a feladók és címzettek védelme), nem
  pusztán az adatkezelő üzleti érdeke.
- Kapcsolódó **jogi kötelezettség-elem**: a DAC7 (Aktv.) a
  platformüzemeltetőt a szállítók (értékesítők) adatainak gyűjtésére és
  megbízhatóságának megállapítására kötelezi — az azonosítás e
  kötelezettség teljesítését is szolgálja (ott a jogalap: 6. cikk (1) c).

### 3. Szükségesség — miért nincs enyhébb eszköz

A NAIH okmánymásolási gyakorlata szerint az azonosítás főszabály szerint
az okmány **bemutatásával** és az adatok rögzítésével végzendő, másolat
nélkül. Ez az alternatíva **személyes jelenlétet feltételez** — a GoFuvar
azonban kizárólag online működik, fiókhálózata, ügyfélszolgálati irodája
nincs, és a szolgáltatás jellege (országos, később EU-s lefedettség)
mellett a személyes bemutatás nem kivitelezhető és aránytalan terhet róna
az érintettre is (utazás). Megvizsgált alternatívák:

| Alternatíva | Miért nem alkalmas |
|---|---|
| Adatok bekérése okmánykép nélkül (önbevallás) | Nem azonosít: bárki bármilyen nevet beírhat; a biztonsági cél meghiúsul |
| Videóhívásos azonosítás | Aránytalanul erőforrás-igényes (élő operátor), az érintettnek is terhesebb; a rögzített videó TÖBB adatot tartalmazna, mint egy fotó |
| eSzemélyi elektronikus (eID/eIDAS) azonosítás | Hosszabb távon vizsgálandó, jelenleg a célcsoport jelentős részénél nem elérhető (nincs aktivált eAzonosítás), a lefedettség-hiány a szolgáltatást kiüresítené; bevezetése esetén e teszt felülvizsgálandó |
| Banki fizetéssel történő közvetett azonosítás | A szállító nem fizet a platformon (a fuvardíjat készpénzben kapja), így nála ez az eszköz nem áll rendelkezésre — a Feladónál pont ezért NEM kérünk okmányt |

A fénykép készítése tehát a távoli kontextusban az azonosítás egyetlen
ténylegesen működő, egyben a legkevésbé korlátozó eszköze.

### 4. Az érintettre gyakorolt hatás (arányosság)

- **Érintett adatkör**: a személyi igazolvány két oldalán látható adatok
  (név, születési adatok, okmányszám, arckép, aláírás). Lakcímkártyát a
  platform **nem kér és nem fogad el** (a személyi azonosító kezelésére
  nincs törvényi felhatalmazás).
- **Nem különleges adat**: arcfelismerés, biometrikus sablon-képzés
  NINCS — a fotó tárolása a GDPR (51) preambulum-bekezdése alapján nem
  9. cikk szerinti biometrikus adatkezelés.
- **Az érintett észszerű elvárásai**: a szállító üzleti jelleggel,
  bevételszerzés céljából lép a platformra; a sharing-economy platformok
  (fuvar-, futár-, szállás-közvetítők) általános gyakorlata az
  okmány-alapú azonosítás — az érintett számára ez nem váratlan.
- **Az adatkezelés önkéntes belépéshez kötött**: aki nem kíván szállítani,
  attól a platform okmányt nem kér (a feladói használat okmány nélkül
  teljes).

### 5. Garanciák (az érintetti kockázat csökkentése)

1. **Rövid tárolás**: a nyers okmányfotó a döntés után 30 nappal
   automatikusan törlődik (napi ütemezett törlő-job).
2. **Privát tárolás**: az okmányfotó dedikált, nyilvánosan nem elérhető
   tárolóban (privát object storage) áll; hozzáférés kizárólag rövid
   élettartamú, szerver-oldalon aláírt hivatkozással, kizárólag admin
   jogosultsággal.
3. **Adattakarékos megőrzés**: a 30 nap után nem a másolat, hanem csak a
   verifikációs státusz és az okmányszám lenyomata marad (II. teszt).
4. **Emberi döntéshozatal**: az AI csak előszűr; elutasítást és
   jóváhagyást minden esetben ember hoz (GDPR 22. cikk szerinti, kizárólag
   automatizált döntés nincs).
5. **Feltöltés-védelem**: a feltöltött fájl tartalmi (magic-byte)
   ellenőrzésen megy át; csak képformátum fogadott.
6. **Átláthatóság**: az Adatkezelési tájékoztató az adatkört, célt,
   megőrzést és a címzetteket részletesen közli.
7. **Érintetti jogok**: hozzáférés, törlés (fiók-törlés önkiszolgálóan),
   tiltakozás — a tiltakozás elbírálása e teszt alapján történik.

### 6. A mérlegelés eredménye

A szállítói okmány-azonosításhoz fűződő érdek (a felhasználók biztonsága,
csalásmegelőzés, jogérvényesítés, részben törvényi kötelezettség) **valós,
konkrét és jelentős**; a választott eszköz a távoli kontextusban a
**legenyhébb működőképes** megoldás; a garanciák (30 napos törlés, privát
tárolás, emberi döntés, adattakarékos megőrzés) az érintetti kockázatot
alacsony szintre szorítják. Az adatkezelés az érintett érdekeit és
alapvető jogait **nem írja felül aránytalanul** — a jogos érdek jogalap
megalapozott.

---

## II. teszt — Okmányszám-lenyomat (doc_number_hash) csalásvédelmi megőrzése

### 1. Az adatkezelés leírása

A KYC-döntés után a nyers okmányfotó törlődik; a rendszer kizárólag az
okmányszám **kriptográfiai lenyomatát** (hash) őrzi meg, a fiók
megszűnését követő **5 évig**. A lenyomatból az okmányszám nem állítható
vissza; a lenyomat kizárólag arra alkalmas, hogy egy ÚJONNAN feltöltött
okmányról megállapítsa: szerepelt-e már (pl. kitiltott felhasználónál).

### 2. A jogos érdek

**Kitiltás-megkerülés és sorozatos visszaélés megakadályozása**: a
platformról csalás, károkozás vagy visszaélés miatt kizárt személy új
e-mail-címmel új fiókot hozhatna létre; az okmány-lenyomat az egyetlen
eszköz, amely a visszatérését felismeri anélkül, hogy az okmány másolatát
meg kellene őrizni. Az érdek a platform többi felhasználójáé is (a kizárt
csalótól való védelem).

### 3. Szükségesség

- A cél (visszatérés-felismerés) az okmánymásolat megőrzésével is
  elérhető lenne — a hash ennél **lényegesen enyhébb** eszköz: a NAIH
  által kifogásolt „okmánymásolat-tárolás" helyett egy vissza nem
  fejthető, egyetlen célra használható lenyomat marad.
- Rövidebb megőrzés a célt meghiúsítaná (a Ptk. szerinti általános
  elévülési idő 5 év; a vagyon elleni cselekmények igényérvényesítési
  időtávja ezt indokolja).

### 4. Hatás és garanciák

- A lenyomat önmagában személyazonosításra alkalmatlan; kizárólag
  egyezés-ellenőrzésre használható, más célra a rendszer nem használja.
- Automatikus törlés a határidő után; a tájékoztató a megőrzést közli.

### 5. Eredmény

Az eszköz kifejezetten az adattakarékosság elvét szolgáló megoldás
(másolat-tárolás HELYETT lenyomat); az érintetti kockázat minimális, az
érdek jelentős — a jogalap megalapozott.

---

## III. teszt — Bizonyíték-zárolás vitás ügyleteknél (photo_retention_hold)

### 1. Az adatkezelés leírása

A fuvarokhoz tartozó felvételi/átadási fotók alapesetben a lezárás után
30 nappal, a platformon belüli üzenetek 6 hónappal automatikusan
törlődnek. **Vitarendezés kezdeményezésekor** (vagy indokolt admin-döntés
alapján) az érintett ügylet fotói és üzenetei zárolás alá kerülnek, és
**5 évig** megőrződnek, ezt követően azok is törlődnek.

### 2. A jogos érdek

**Jogi igények előterjesztése, érvényesítése és védelme** (GDPR (52)
preambulum-bekezdés szerint elismert cél): a vitás ügylet bizonyítékainak
megsemmisülése mindkét fél jogérvényesítését ellehetetlenítené. Az érdek
elsősorban maguké a vitában álló érintetteké.

### 3. Szükségesség és arányosság

- Csak az **érintett ügylet** anyagai kerülnek zárolásra (nem a
  felhasználó összes adata).
- Az 5 év a polgári jogi elévülési időhöz igazodik.
- A zárolás nem diszkrecionális tömeges megőrzés: automatikusan a
  vita-nyitáshoz kötött, admin-zárolás pedig egyedi, indokolt döntés.

### 4. Eredmény

A célhoz kötött, ügylet-szintű, határozott idejű zárolás arányos; a
jogalap megalapozott.

---

## Záradék

A fenti mérlegeléseket az adatkezelő elvégezte, az eredményt elfogadja.
A tesztek felülvizsgálandók, ha az adatkezelés körülményei változnak
(különösen: eID-alapú azonosítás elérhetővé válása, a feladói
kockázat-alapú azonosítás tényleges alkalmazása, élő GPS bevezetése).

```
Kelt: Hódmezővásárhely, 2026. ___________

________________________________
Jovány Gyula, ügyvezető
Tiszta Hód Kft.
```
