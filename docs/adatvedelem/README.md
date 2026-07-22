# Adatvédelmi megfelelési dokumentumok — GoFuvar / Tiszta Hód Kft.

Ez a mappa a GoFuvar platform (gofuvar.hu) **belső** adatvédelmi
dokumentumait tartalmazza. Ezek nem publikus anyagok — nem részei a
weboldalnak; a létezésük a GDPR szerinti elszámoltathatóság (5. cikk (2))
teljesítése. Hatósági (NAIH) megkeresés vagy érintetti panasz esetén
ezeket kell tudni bemutatni.

| Dokumentum | Mit fed le | GDPR-alap |
|---|---|---|
| [erdekmerlegelesi-tesztek.md](erdekmerlegelesi-tesztek.md) | A jogos érdeken alapuló adatkezelések mérlegelése (szállítói okmány-azonosítás, csalásvédelmi hash, bizonyíték-zárolás) | 6. cikk (1) f) |
| [dpia-kyc.md](dpia-kyc.md) | Adatvédelmi hatásvizsgálat az AI-támogatott okmány-azonosításra | 35. cikk |
| [gdpr-30-cikk-nyilvantartas.md](gdpr-30-cikk-nyilvantartas.md) | Az adatkezelési tevékenységek nyilvántartása | 30. cikk |
| [incidenskezelesi-terv.md](incidenskezelesi-terv.md) | Adatvédelmi incidens kezelése (72 órás NAIH-bejelentés) | 33–34. cikk |

## Státusz

**MUNKAPÉLDÁNY (draft) — ügyvezetői jóváhagyásra vár.**

A dokumentumokat AI-asszisztens (Claude) készítette 2026-07-20-án a
platform tényleges működése alapján. Hivatalossá az teszi, ha:

1. az ügyvezető (Jovány Gyula) átolvassa és a záró jóváhagyási blokkot
   kitölti (dátum + aláírás — kinyomtatva vagy a repóban rögzített
   jóváhagyó commituzenettel),
2. a tervezett ügyvédi review (lásd CLAUDE.md, Phase 6) megerősíti.

## Frissítési szabály

Ha a platform adatkezelése változik (új adatkör, új adatfeldolgozó, új
retenció, új funkció — pl. élő GPS a mobil-fázisban, QVIK/CIB fizetés
élesedése, DAC7-adatszolgáltatás indulása), a megfelelő dokumentumot
**a változással együtt** frissíteni kell, és a verziótörténetbe új sort
kell írni. A DPIA-t a mobil-GPS élesítése előtt kötelező felülvizsgálni.

## Adatkezelő

```
Tiszta Hód Korlátolt Felelősségű Társaság
Székhely:       6800 Hódmezővásárhely, Szántó Kovács János utca 144.
Cégjegyzékszám: 06-09-020646
Adószám:        24750792-2-06
Képviseli:      Jovány Gyula ügyvezető
Kapcsolat:      info@gofuvar.hu · panasz@gofuvar.hu · +36 20 397 9223
```

Adatvédelmi tisztviselő (DPO): nincs kijelölve — a GDPR 37. cikk szerinti
kötelező esetek jelenleg nem állnak fenn (nincs nagymértékű különleges
adatkezelés; nincs nagymértékű, rendszeres és szisztematikus megfigyelés —
ezt az élő GPS-követés mobil-fázisbeli élesítésekor ÚJRA KELL értékelni).
