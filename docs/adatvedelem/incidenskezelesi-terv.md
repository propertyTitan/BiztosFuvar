# Adatvédelmi incidenskezelési terv (GDPR 33–34. cikk)

**Adatkezelő:** Tiszta Hód Kft. (GoFuvar platform, gofuvar.hu)
**Verzió:** 1.0 (munkapéldány) · **Kelt:** 2026-07-20
**Felelős (incidens-gazda):** Jovány Gyula ügyvezető
**Technikai kapcsolattartó:** a platform fejlesztője

## 1. Mi számít adatvédelmi incidensnek

A biztonság olyan sérülése, amely a kezelt személyes adatok véletlen vagy
jogellenes megsemmisítését, elvesztését, megváltoztatását, jogosulatlan
közlését vagy az azokhoz való jogosulatlan hozzáférést eredményezi.
Példák a GoFuvar kontextusában:

- adatbázis- vagy tároló-hozzáférés illetéktelen fél által (pl.
  kiszivárgott API-kulcs, feltört admin-fiók)
- okmányfotók vagy elérhetőségek jogosulatlan letöltése
- félrecímzett tömeges e-mail/SMS (más érintett adatával)
- kód-hiba, amely más felhasználó adatait mutatja (adatszivárgás)
- zsarolóvírus / szolgáltató-oldali incidens (Neon, R2, Railway, Resend,
  SeeMe, Sentry, Google értesítése alapján)
- eszköz-lopás, amelyen éles hozzáférés volt

**Nem incidens** (de vizsgálandó): sikertelen támadási kísérlet
hozzáférés nélkül; rendelkezésre állási kiesés adatsérülés nélkül —
ezeket is naplózzuk (7. pont), de bejelentési kötelezettség nélkül.

## 2. Észlelési csatornák

- Sentry-riasztások (web + backend) és Railway-naplók
- Felhasználói bejelentés (info@ / panasz@ — minden „más adatát látom"
  jellegű levél azonnal eszkalálandó)
- Adatfeldolgozó értesítése (a DPA-k alapján a feldolgozó köteles
  indokolatlan késedelem nélkül jelezni)
- NAIH vagy hatóság megkeresése
- Saját észlelés fejlesztés/üzemeltetés közben

## 3. A 72 órás óra

A NAIH-bejelentés határideje **az incidensről való tudomásszerzéstől**
számított **72 óra** (33. cikk (1)). A tudomásszerzés időpontját azonnal
írásban rögzíteni kell (e-mail önmagunknak / incidens-napló), mert minden
határidő ettől számít.

## 4. Lépések

### 0–4. óra — Megfékezés és rögzítés

1. **Rögzítsd az időpontot** (tudomásszerzés) és a tényeket az
   incidens-naplóba (7. pont).
2. **Állítsd el a vérzést** — a helyzettől függően: érintett API-kulcs/
   jelszó azonnali rotálása; kompromittált fiók kényszer-kijelentkeztetése
   (token-verzió léptetés); szükség esetén az érintett funkció vagy az
   egész platform ideiglenes leállítása (Railway-en a deploy leállítható).
3. **Őrizd meg a bizonyítékot**: naplók, Sentry-események, DB-mentés
   pillanatképe MIELŐTT javítasz — a javítás ne semmisítse meg a
   nyomokat.
4. Ha adatfeldolgozónál történt: kérj írásos részleteket (mi, mikor,
   kiket érint, mit tettek).

### 4–24. óra — Felmérés

5. **Hatókör**: mely adatkategóriák (okmányfotó? elérhetőség? chat?
   fizetési adat?), hány érintett, milyen időtávon.
6. **Kockázat-értékelés** a 33–34. cikk logikája szerint:

| Szint | Ismérv | Teendő |
|---|---|---|
| Nincs kockázat | Az adat nem került ki / azonnal visszavonható volt (pl. titkosított, kulcs nélkül) | Napló + nincs bejelentés |
| Kockázat | Személyes adat illetéktelenhez kerülhetett | **NAIH-bejelentés 72 órán belül** |
| Magas kockázat | Az érintettre nézve jelentős hátrány valószínű (okmányfotók kiszivárgása, elérhetőség + cím együtt, fizetési adatok, nagy tömegű adat) | NAIH-bejelentés **ÉS az érintettek közvetlen értesítése** indokolatlan késedelem nélkül |

### 24–72. óra — Bejelentés

7. **NAIH-bejelentés** (ha az előző pont szerint kell): a NAIH online
   incidensbejelentő rendszerén (naih.hu → Adatvédelmi incidensbejelentés)
   vagy ügyfélkapun át. Tartalma (33. cikk (3)): az incidens jellege,
   érintetti kör és becsült szám, adatkategóriák, várható következmények,
   megtett és tervezett intézkedések, kapcsolattartó. **Ha 72 órán belül
   nem áll össze minden adat: RÉSZLEGES bejelentést kell tenni határidőben,
   és utólag kiegészíteni** — a késedelem önálló jogsértés, a részlegesség
   nem.
8. **Érintett-értesítés** (magas kockázatnál, 34. cikk): közérthetően,
   közvetlenül (e-mail; SMS ha az e-mail érintett), tartalma: mi történt,
   mit jelent rá nézve, mit tettünk, mit tegyen ő (pl. jelszócsere),
   kapcsolat. Sablon: 6. pont.

### 72 óra után — Helyreállítás és tanulság

9. Végleges javítás, az érintett rendszerek megerősítése.
10. **Utóelemzés** (post-mortem) az incidens-naplóba: gyökérok, mi
    észlelte, mennyi idő alatt, mit változtatunk (kód, folyamat, DPA).
11. E terv és szükség szerint a DPIA/nyilvántartás frissítése.

## 5. Szerep-mátrix (egyszemélyes szervezetre szabva)

| Feladat | Felelős |
|---|---|
| Döntés bejelentésről / érintett-értesítésről | ügyvezető |
| Technikai megfékezés, bizonyíték-mentés, javítás | fejlesztő |
| NAIH-kommunikáció, érintett-értesítés kiküldése | ügyvezető (a fejlesztő előkészíti) |
| Incidens-napló vezetése | fejlesztő |

Ha a szervezet bővül, a mátrix név szerint frissítendő.

## 6. Érintett-értesítési sablon (magas kockázat esetén)

> **Tárgy: Fontos biztonsági tájékoztatás a GoFuvar-fiókodról**
>
> Kedves {Név}!
>
> {Dátum}-án biztonsági incidens történt a GoFuvar rendszerében:
> {mi történt, közérthetően, 1-2 mondat}. Az érintett adataid:
> {adatkategóriák}.
>
> Amit tettünk: {megfékezés + javítás röviden}. Az esetet bejelentettük
> a Nemzeti Adatvédelmi és Információszabadság Hatóságnak.
>
> Amit érdemes tenned: {pl. jelszócsere, gyanús megkeresések figyelése}.
>
> Kérdésedre az info@gofuvar.hu címen válaszolunk. A kellemetlenségért
> elnézést kérünk.
>
> Tiszta Hód Kft. — GoFuvar

## 7. Incidens-napló

Minden incidenst és „majdnem-incidenst" rögzíteni kell (33. cikk (5) —
akkor is, ha bejelentés nem volt szükséges, mert a NAIH ellenőrizheti):
időpont, leírás, érintett adatok/személyek, kockázat-értékelés és annak
indoka, intézkedések, bejelentés történt-e. Vezetése: e mappában
(`incidens-naplo.md` — az első bejegyzéskor létrehozandó) vagy azonos
tartalmú különálló nyilvántartásban.

## 8. Karbantartás

- Évente egyszer: a terv átolvasása + egy gondolatkísérlet-teszt
  („kiszivárgott a DB-connstring — mi a lépéssor?").
- Új adatfeldolgozó belépésekor: észlelési/értesítési út ellenőrzése.
- Szolgáltató-kontaktok: Railway/Neon/Cloudflare/Resend/Sentry/SeeMe
  support-csatornái + a NAIH incidensbejelentő elérhetősége (naih.hu).

```
Kelt: Hódmezővásárhely, 2026. ___________

________________________________
Jovány Gyula, ügyvezető
Tiszta Hód Kft.
```
