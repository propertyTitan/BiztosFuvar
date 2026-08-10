import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Adatkezelési Tájékoztató (GDPR) | GoFuvar',
  description: 'A GoFuvar platform adatkezelési tájékoztatója.',
};

export default function AdatkezelesPage() {
  return (
    <article
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '32px 20px',
        lineHeight: 1.65,
        fontSize: 16,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Adatkezelési Tájékoztató (GDPR)</h1>
      <p className="muted" style={{ margin: 0 }}>
        <strong>Hatályos:</strong> 2026. augusztus 10-től
      </p>

      <h2 style={{ marginTop: 32 }}>1. Az Adatkezelő</h2>
      <ul>
        <li><strong>Név:</strong> Tiszta Hód Korlátolt Felelősségű Társaság (Tiszta Hód Kft.)</li>
        <li><strong>Székhely:</strong> 6800 Hódmezővásárhely, Szántó Kovács János utca 144.</li>
        <li><strong>Cégjegyzékszám:</strong> 06-09-020646</li>
        <li><strong>Adószám:</strong> 24750792-2-06</li>
        <li><strong>E-mail:</strong> info@gofuvar.hu</li>
        <li><strong>Adatvédelmi kapcsolattartó:</strong> Jovány Gyula, ügyvezető (info@gofuvar.hu)</li>
      </ul>
      <p>
        A szolgáltatás kizárólag 18 éven felüliek számára érhető el. A Tiszta Hód Kft. a GDPR
        37. cikk szerint nem kötelezett külön adatvédelmi tisztviselő (DPO) kinevezésére, az
        adatvédelmi ügyek kapcsolattartója a fenti e-mail címen érhető el.
      </p>

      <h2 style={{ marginTop: 32 }}>2. A kezelt adatok köre és célja</h2>
      <ul>
        <li>
          <strong>Azonosító adatok:</strong> Név, e-mail, telefonszám.
        </li>
        <li>
          <strong>KYC adatok:</strong> Személyi igazolvány — a Szállítóként (fuvarozóként)
          tevékenykedő felhasználóknál kötelező, Feladónál kizárólag kockázat-alapú ellenőrzés
          esetén (pl. visszaélés gyanúja, vitarendezés) kerül bekérésre —, valamint céges fiók
          esetén adószám (Biztonság, jogi megfelelés). A KYC dokumentumok fotója nyers formában a
          hitelesítés ideje alatt kerül tárolásra.
        </li>
        <li>
          <strong>Tranzakciós adatok:</strong> Számlázási adatok, a fizetési szolgáltató tranzakció-azonosítója
          (kapcsolatfelvételi díj), a megállapodott fuvardíj összege (DAC7), valamint az
          elállási jogról szóló fogyasztói nyilatkozat (45/2014. Korm. r. 29. § (1) a) szerinti
          beleegyezés) időbélyege — a nyilatkozat megtételének bizonyítására.
        </li>
        <li>
          <strong>Kapcsolatfelvételi adatok átadása a Felek között:</strong> a kapcsolatfelvételi
          díj megfizetése után a Szolgáltató a Feladó és a Sofőr <strong>nevét, telefonszámát és
          e-mail címét egymás részére átadja</strong> — ez a közvetítési szolgáltatás lényegi
          tartalma, célja a fuvarozási szerződés Felek közötti teljesítésének lehetővé tétele.
          A díj megfizetése előtt a Felhasználók elérhetőségi adatai a másik fél számára nem
          hozzáférhetők.
        </li>
        <li>
          <strong>Rendszer és Fuvarspecifikus adatok:</strong> Címek, GPS koordináták (élő követés),
          csomag fotók, in-app chat üzenetek, profil értékelések (Trust Score), IP címek,
          eszközazonosítók és Push tokenek (működtetés és biztonság).
        </li>
        <li>
          <strong>Címzetti telefonszám:</strong> <strong>egyetlen</strong> SMS a csomag
          felvételekor — benne az átvételi kód, a szállító neve és telefonszáma, valamint
          az adatkezelési tájékoztatóra mutató link. A kézbesítés visszaigazolása
          e-mailben megy (ha megadtak e-mail-címet), SMS-ben nem.
        </li>
        <li>
          <strong>Feladói telefonszám:</strong> kapcsolattartás a szállítóval a
          kapcsolatfelvételi díj megfizetése után. <strong>SMS-t a feladónak nem
          küldünk</strong> — minden értesítés e-mailben és a felületen érkezik.
        </li>
        <li>
          <strong>Adóazonosító adatok (DAC7, csak Szállítóknak):</strong> ha magánszemélyként
          végzel szállítást, az első teljesített fuvar után elkérjük az <strong>adóazonosító
          jeledet</strong>, a <strong>születési dátumodat</strong> és a <strong>lakcímedet</strong>.
          Ezt nem mi találtuk ki: az adó- és egyéb közterhekkel kapcsolatos nemzetközi
          közigazgatási együttműködésről szóló törvény (Aktv., DAC7) a platformüzemeltetőt
          kötelezi az adatszolgáltatásra, ezért a jogalap <strong>jogi kötelezettség</strong>
          (GDPR 6. cikk (1) c). Céges fiók esetén az adószám tölti be ezt a szerepet.
          Címzett: a Nemzeti Adó- és Vámhivatal, éves adatszolgáltatás keretében.
          Megőrzés: az adatszolgáltatási kötelezettség elévüléséig (az adatszolgáltatás
          évének végétől számított 5 év). Ha nem adod meg, szállítói tevékenységet nem
          tudsz folytatni — feladóként a Platform ettől függetlenül használható.
        </li>
        <li>
          <strong>Fiókhasználati adatok:</strong> a legutóbbi bejelentkezésed időpontja, a
          bejelentkezéseid száma, a legutóbbi aktivitásod időpontja és a becsült összes
          aktív idő. Célja a visszaélések és a jogosulatlan hozzáférés felismerése, valamint
          az ügyfélszolgálati hibakeresés (jogos érdek). Ezek az adatok a fiókod
          élettartamáig maradnak meg, és a fiók törlésekor a fiókkal együtt törlődnek.
          Az adminisztrátori hozzáférés ezekhez naplózott (lásd 5. szakasz).
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>3. Az adatkezelés jogalapja</h2>
      <p>
        <strong>Szerződés teljesítése</strong> (ide értve a Felek kapcsolatfelvételi adatainak
        egymás részére történő átadását a díj megfizetése után — ez a megrendelt közvetítési
        szolgáltatás teljesítése) [GDPR 6. cikk (1) b)];{' '}
        <strong>Jogi kötelezettség</strong> (Számvitel, DAC7, a fogyasztói elállási nyilatkozat
        rögzítése és bizonyíthatósága) [GDPR 6. cikk (1) c)];{' '}
        <strong>Jogos érdek</strong> (KYC, csalásmegelőzés, vitarendezés, a Címzett telefonszámának
        kezelése a fuvarozási szerződés hatékony teljesítéséhez és a biztonságos kódátadáshoz,
        a Feladó tájékoztatása a sikeres kézbesítésről) [GDPR 6. cikk (1) f)].
      </p>
      <p>
        A KYC dokumentumokon szereplő fénykép és személyes azonosító adatok a 9. cikk szerinti
        különleges adatkategóriába <strong>nem</strong> tartoznak; ugyanakkor az Adatkezelő ezen
        adatokat fokozott biztonsággal és a 5. szakaszban rögzített megőrzési idők szerint kezeli.
      </p>

      <h2 style={{ marginTop: 32 }}>4. Adatfeldolgozók és Adattovábbítás</h2>
      <p>
        A platform fő piaca Magyarország; európai (EU + EGT) viszonylatú nemzetközi fuvarokat is
        kiszolgálunk. Az adatfeldolgozók EU-n belül helyezkednek el; a 4.2. pontban felsorolt
        USA-szolgáltatók adattovábbítása kizárólag a felhasználói felület (térkép, AI-elemzés,
        push-értesítés) működéséhez szükséges, és az Európai Bizottság SCC + EU-US Data Privacy
        Framework jogalapján történik.
      </p>
      <p>
        <strong>4.1. Adatfeldolgozók (EU területén belül):</strong>
      </p>
      <ul>
        <li><strong>CIB Bank Zrt.</strong> (1027 Budapest) — bankkártyás fizetés elfogadása
          (kapcsolatfelvételi díj)</li>
        <li><strong>KBOSS.hu Kft. (Számlázz.hu)</strong> (1031 Budapest) — számlázás: a számla
          kiállítása és kiküldése (név, számlázási cím, adószám, e-mail cím)</li>
        <li><strong>OpenStreetMap Foundation (Nominatim)</strong> (EU/Egyesült Királyság) —
          címek koordinátára fordítása (geokódolás) a szerveroldalon</li>
        <li><strong>ImprovMX</strong> (EU régió) — a @gofuvar.hu címekre érkező levelek
          továbbítása (így az érintetti kérelmek is)</li>
        <li><strong>Vercel Inc.</strong> (Frankfurt régió) — webes alkalmazás-hosting</li>
        <li><strong>Railway Corp.</strong> (EU régió) — backend-hosting</li>
        <li><strong>Neon Inc.</strong> (eu-central-1, Frankfurt — AWS) — PostgreSQL adatbázis</li>
        <li><strong>Cloudflare R2</strong> (EU régió) — fájlok és fotók object storage</li>
        <li><strong>Resend Inc.</strong> (EU régió) — tranzakciós e-mail küldés</li>
        <li>
          <strong>SeeMe Solutions Kft. / Dream Interactive Kft.</strong> (Budapest) —
          tranzakciós SMS-küldés
        </li>
        <li><strong>Sentry Inc.</strong> (EU régió, opcionális) — alkalmazás-hibák naplózása</li>
      </ul>
      <p>
        <strong>4.2. EU-n kívüli adattovábbítás (USA — SCC + DPF):</strong> A platform technikai
        működéséhez az Adatkezelő igénybe veszi az alábbi USA-székhelyű szolgáltatókat:
      </p>
      <ul>
        <li>
          <strong>Google LLC</strong> — Google Maps Platform (cím-geokódolás, útvonal-számítás),
          Google Gemini AI (KYC dokumentum-elemzés, csomag-méret elemzés, csevegési segéd)
        </li>
        <li>
          <strong>Expo Inc.</strong> — Expo Push Notifications szolgáltatás (mobil-értesítések
          továbbítása az Apple és Google push-szervereihez)
        </li>
      </ul>
      <p>
        Ezen, az EU-n kívülre (USA) történő adattovábbítások jogalapját az Európai Bizottság által
        elfogadott Általános Szerződési Feltételek (Standard Contractual Clauses — SCC) és az
        EU-US Data Privacy Framework biztosítják. A szolgáltatók az Adatkezelő nevében járnak el,
        adatfeldolgozói szerződéssel.
      </p>

      <h2 style={{ marginTop: 32 }}>5. Adatbiztonság és Konkrét Megőrzési Idők</h2>
      <ul>
        <li>
          <strong>Számlázási adatok:</strong> A kiállítástól számított 8 évig
          (2000. évi C. tv. — Számviteli törvény), <strong>ezt követően a számlán
          szereplő személyes adatok (név, adószám, cím) automatikusan törlődnek</strong>.
        </li>
        <li>
          <strong>KYC dokumentumok:</strong> a személyi igazolványról készült
          <strong>fénykép a döntést (jóváhagyás vagy elutasítás) követő 30 napon belül
          automatikusan törlődik</strong> — a fiók megszüntetésekor pedig azonnal, a
          tárolóból is. Ennél tovább <strong>kizárólag az okmányszám egyirányú lenyomata
          (hash)</strong> marad meg, <strong>5 évig</strong>: ebből az okmányszám nem
          állítható vissza, egyedül arra használjuk, hogy ugyanazzal az okmánnyal ne
          lehessen több fiókot létrehozni, illetve hogy a fiók törlése után létrehozott új
          fiók hitelesítése emberi ellenőrzéshez kerüljön (visszaélés- és
          kitiltás-megkerülés elleni védelem, jogos érdek). Öt év után a lenyomat is
          automatikusan törlődik.
        </li>
        <li>
          <strong>In-app Chat üzenetek:</strong> A fuvar lezárását követő <strong>6 hónapig</strong>{' '}
          (kizárólag vitarendezés céljából), utána automatikusan törlésre kerülnek. Kivétel: ha a
          fuvarral kapcsolatban vitarendezési eljárás indult vagy megőrzési zárolás van érvényben —
          ilyenkor kizárólag az érintett fuvar üzenetei legfeljebb 5 évig kerülnek megőrzésre.
          Az Értékelések (Trust Score) a profil részeként a fiók élettartamáig megmaradnak.
        </li>
        <li>
          <strong>A GoFuvar csapatával váltott üzenetek</strong> (a Platform üzemeltetője által
          küldött értesítések, közlemények és az ezekre adott válaszaid): a küldéstől számított{' '}
          <strong>3 évig</strong> (a fogyasztói panaszkezelés megőrzési kötelezettségéhez igazodva —
          Fgytv. 17/A. §), utána automatikusan törlésre kerülnek. A fiók törlésekor ezek az
          üzenetek azonnal törlődnek.
        </li>
        <li>
          <strong>GPS ping adatok:</strong> Az aktív fuvar befejezését követő 7 napig tároljuk
          nyers formában, majd töröljük. Ugyanez vonatkozik a Szállító legutóbb ismert
          pozíciójára is. Aggregált, nem-személyazonosító statisztikák tovább megőrződhetnek.
        </li>
        <li>
          <strong>Fuvar- és foglalási adatok:</strong> a fuvar lezárását követő{' '}
          <strong>3 évig</strong> (polgári jogi elévülés), utána a személyes adatok
          automatikusan törlődnek: a címzett elérhetősége, az átvételi kód és a
          követő-link megszűnik, a cím pedig településre rövidül. Maga a fuvar ténye
          (időpont, ár, értékelés) statisztikai és elszámolási célból megmarad.
          A szállítót nem találó, illetve az <strong>1 éve nem mozduló</strong> (félbehagyott)
          fuvar és foglalás automatikusan lezárul, és onnantól ugyanez a rend vonatkozik rá.
          Folyamatban lévő vitás ügyet ez soha nem érint.
          Ugyanekkor törlődik <strong>a fuvarhoz érkezett árajánlatok üzenete</strong> és
          a fuvar <strong>nyilvános kérdés-válasz szála</strong> is — ezek ugyanarról a
          küldeményről szólnak, mint a fuvar leírása. Vitatott ügyletnél a bizonyítékok —
          a fotókkal és a beszélgetéssel együtt — 5 évig megőrződnek.
        </li>
        <li>
          <strong>Járatok (meghirdetett útvonalak):</strong> az indulást követő{' '}
          <strong>3 évig</strong>, utána a járat és a jármű szabad szöveges leírása
          automatikusan törlődik. A járat ténye és útvonala statisztikai célból
          megmarad. A mentett sablonjaidat ez nem érinti — azok a fiókod
          élettartamáig megmaradnak, és bármikor törölheted őket.
        </li>
        <li>
          <strong>Vitarendezési ügyek:</strong> a vita <strong>lezárását</strong> követő{' '}
          <strong>5 évig</strong> (polgári jogi igényérvényesítés), utána a vita
          leírása, az indoklás és a csatolt bizonyíték automatikusan törlődik.
          Folyamatban lévő ügy nem évül el.
        </li>
        <li>
          <strong>Vészjelzés (SOS) és mentés-kérés:</strong> a pontos helyadat, a
          szabad szöveges leírás és a rendszám <strong>7 nap</strong> után törlődik; a
          jelzés ténye (időpont, típus) további <strong>1 évig</strong> marad meg
          esetleges igényérvényesítés miatt, ezt követően a bejegyzés is törlődik.
        </li>
        <li>
          <strong>Értesítések:</strong> 6 hónap után automatikusan törlődnek.
        </li>
        <li>
          <strong>Fizetési napló:</strong> a díjfizetések technikai naplója (időpont,
          összeg, tranzakció-azonosító) <strong>8 évig</strong>, a számlázási adatokkal
          egyező megőrzéssel, majd automatikusan törlődik.
        </li>
        <li>
          <strong>Törölt fiókok nyoma:</strong> ha törlöd a fiókodat, a törlés
          <strong>tényét</strong> (időpont, a törlés oka) <strong>5 évig</strong>
          megőrizzük, az e-mail-címedről pedig egy visszafejthetetlen, szerver-oldali
          titokkal képzett lenyomatot — visszaélés-vizsgálat és jogi igényérvényesítés
          céljából. Magát az e-mail-címet nem őrizzük meg. Öt év után ez a bejegyzés is
          automatikusan törlődik.
        </li>
        <li>
          <strong>Útvonal-figyelők (szállítóknak):</strong> a mentett figyelőid — köztük a
          megadott kiindulási és célpont-koordináta — a <strong>fiókod élettartamáig</strong>
          maradnak meg, mert ezek élő beállítások, nem előzmény-adatok. Bármikor törölheted
          őket a felületen, és a fiók törlésekor automatikusan megszűnnek.
        </li>
        <li>
          <strong>File- és adminisztrátori hozzáférési audit log:</strong> 1 évig
          (incidens-vizsgálat és NAIH-bejelentés érdekében). Naplózzuk, ha egy
          adminisztrátor megnyitja egy felhasználó részletes adatlapját, a felek chatjét,
          a KYC-dokumentumokat, illetve a felhasználói vagy fuvar-listát. A napló a
          hozzáférés <strong>tényét</strong> rögzíti, nem a megtekintett tartalmat.
        </li>
        <li>
          <strong>Fuvar-fotók (felvételi és kézbesítési fotó):</strong> a fuvar lezárását követő{' '}
          <strong>30 napig</strong>, ezt követően automatikusan törlésre kerülnek. Kivétel: ha a
          fuvarral kapcsolatban vitarendezési eljárás indult, vagy jogi igény érvényesítése miatt
          megőrzési zárolás van érvényben — ilyenkor <strong>kizárólag az érintett fuvar</strong>{' '}
          fotói a polgári jogi elévülési időhöz igazodva legfeljebb 5 évig kerülnek megőrzésre.
        </li>
        <li>
          <strong>Push tokenek és eszközazonosítók:</strong> a fiók aktív állapotáig, vagy a
          token deaktiválásáig.
        </li>
      </ul>
      <p>
        <strong>Technikai biztonsági intézkedések:</strong>
      </p>
      <ul>
        <li>Minden adatkommunikáció HTTPS/TLS-titkosítással zajlik</li>
        <li>A jelszavak <strong>scrypt</strong> algoritmussal hash-elve, sózva tárolódnak</li>
        <li>Dedikált object storage (Cloudflare R2) a fájlok tárolására</li>
        <li>JWT-alapú session-kezelés, IP-szintű rate-limittel</li>
        <li>Adatbázis automatikus napi mentései 7 napig megőrzésre kerülnek (Neon)</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>6. Automatizált Döntéshozatal és Profilalkotás</h2>
      <p>
        A GDPR 22. cikke szerinti tájékoztatásra a platform a következő automatizált adatkezelési
        műveleteket alkalmazza:
      </p>
      <ul>
        <li>
          <strong>AI-alapú KYC ellenőrzés:</strong> a feltöltött személyi igazolvány
          képét a Google Gemini AI elemzi (név, születési dátum és okmányszám kiolvasása,
          kép-minőség ellenőrzés). Ha az ellenőrzés minden szempontból rendben van, a
          hitelesítés <strong>automatikusan</strong> megtörténik — így néhány másodperc alatt
          elindulhatsz. <strong>Kockázati jel esetén a döntést emberi adminisztrátor
          hozza meg</strong>: alacsony felismerési biztonság, az okmányon szereplő és a
          fiókban megadott név eltérése, másolat/képernyőfotó gyanúja, olvashatatlan
          okmányszám, illetve ha ezzel az okmánnyal korábban már volt fiók a rendszerben.
          <strong>Elutasítást az AI önmagában soha nem mond ki</strong> — az mindig emberi
          döntés. A hitelesítés eredménye ellen emberi felülvizsgálatot kérhetsz
          (lásd 8.4. pont).
        </li>
        <li>
          <strong>Automata kor-ellenőrzés:</strong> az AI a személyi igazolványról kiolvassa a
          születési dátumot. Ha 18 évnél fiatalabb felhasználót jelez, a hitelesítés
          <strong>nem történik meg automatikusan</strong>: az ügy emberi adminisztrátorhoz kerül,
          és a döntést ő hozza meg. A Platformot 18 éven aluli nem használhatja
          (ÁSZF 3.1.), a végső döntés ellen emberi felülvizsgálatot kérhetsz (lásd 8.4. pont).
        </li>
        <li>
          <strong>Trust Score:</strong> a Sofőr platformon belüli megbízhatósági pontszámát egy
          algoritmus számítja teljesített fuvarok, értékelések, viták és lemondások alapján.
          A Trust Score <strong>tájékoztató jellegű</strong>: a profilodon és az ajánlataid
          mellett jelenik meg, hogy a másik fél könnyebben dönthessen. <strong>Nem befolyásolja
          a fuvarok kiajánlásának sorrendjét, és önmagában nem eredményez fiók-felfüggesztést</strong>
          — ilyen döntést csak emberi adminisztrátor hozhat, konkrét szabályszegés miatt.
        </li>
        <li>
          <strong>Coverage-zóna szűrés:</strong> a platform földrajzi alapon korlátozhatja a
          szolgáltatás elérhetőségét (pl. csak bizonyos megyékben). Ez nem személyalapú profilalkotás,
          csak a felhasználó megadott / GPS-ből származó tartózkodási helyén alapul.
        </li>
      </ul>
      <p>
        <strong>Az érintett jogai automatizált döntés esetén:</strong> a Felhasználó jogosult
      </p>
      <ul>
        <li><strong>emberi beavatkozást kérni</strong> az automatizált döntésbe (pl. ha a kor-ellenőrzés tévesen utasította el)</li>
        <li><strong>magyarázatot</strong> kapni a döntés logikájáról</li>
        <li>a döntéssel szemben <strong>kifogást emelni</strong> az info@gofuvar.hu címen</li>
      </ul>
      <p>
        Az ilyen kéréseket az Adatkezelő 30 napon belül érdemben elbírálja.
      </p>

      <h2 style={{ marginTop: 32 }}>7. Sütik (Cookies) és Böngészői Tárolók</h2>
      <p>
        A Platform a működéséhez technikailag szükséges, valamint a felhasználói élményt biztosító
        adatokat a böngésző localStorage-jében és session-ben tárolja. A jelenlegi állapotban
        <strong> marketing- és analytics-célú süti NEM kerül elhelyezésre.</strong>
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--surface)', textAlign: 'left' }}>
            <th style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>Tároló</th>
            <th style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>Cél</th>
            <th style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>Élettartam</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: 8 }}>gofuvar_token</td><td style={{ padding: 8 }}>JWT — bejelentkezett munkamenet</td><td style={{ padding: 8 }}>7 nap</td></tr>
          <tr><td style={{ padding: 8 }}>gofuvar_user</td><td style={{ padding: 8 }}>Felhasználói profil cache</td><td style={{ padding: 8 }}>7 nap</td></tr>
          <tr><td style={{ padding: 8 }}>gofuvar_locale</td><td style={{ padding: 8 }}>Nyelvi preferencia</td><td style={{ padding: 8 }}>1 év</td></tr>
          <tr><td style={{ padding: 8 }}>gofuvar_cookie_consent</td><td style={{ padding: 8 }}>A süti-bannerre adott válasz rögzítése</td><td style={{ padding: 8 }}>1 év</td></tr>
        </tbody>
      </table>
      <p>
        A működéshez szükséges sütikhez <strong>nem kérünk külön hozzájárulást</strong>, mivel azok
        nélkül a szolgáltatás nem nyújtható (pl. bejelentkezés). A Felhasználó a böngészőjében
        bármikor törölheti ezeket. Amennyiben a jövőben analytics- vagy marketing-célú sütit
        vezetünk be, ahhoz <strong>kifejezett opt-in hozzájárulást</strong> kérünk a süti-banner-en
        keresztül.
      </p>

      {/* ── GDPR 14. cikk — a CÍMZETT nem felhasználó ──
          A címzett adatait a feladó adja meg: ő maga soha nem lépett kapcsolatba
          velünk, nem fogadott el semmit, és nincs fiókja. A 14. cikk szerint
          neki külön tájékoztatás jár, méghozzá az adat megszerzésétől számított
          ésszerű időn belül — a gyakorlatban az első üzenetünkkel. Ez a szakasz
          az, amire a címzetti e-mail és a nyomon-követő oldal hivatkozik. */}
      <h2 id="cimzett" style={{ marginTop: 32 }}>
        7/A. Ha csomagot vársz (Címzett) — külön tájékoztatás
      </h2>
      <p>
        Ha te <strong>nem regisztrált felhasználóként</strong> kaptál tőlünk SMS-t vagy
        e-mailt egy érkező küldeményről, az alábbiak vonatkoznak rád. Neked nem kell
        regisztrálnod, és nem kell semmit elfogadnod.
      </p>
      <ul>
        <li>
          <strong>Honnan vannak az adataid:</strong> a küldemény feladója adta meg őket a
          fuvar feladásakor, hogy a kézbesítést egyeztetni tudjuk.
        </li>
        <li>
          <strong>Milyen adatot kezelünk:</strong> neved, telefonszámod, e-mail-címed (ha a
          feladó megadta), a szállítási cím, és a küldeményhez tartozó átvételi kód.
        </li>
        <li>
          <strong>Miért:</strong> a fuvar teljesítéséhez fűződő jogos érdek (GDPR 6. cikk
          (1) f) — enélkül a szállító nem tudna időben egyeztetni veled az átadásról.
        </li>
        <li>
          <strong>Meddig:</strong> a fuvar lezárását követő <strong>3 éven belül</strong> az
          adataid a fuvar-adatokkal együtt automatikusan törlődnek (vitatott ügyletnél
          5 év — lásd az 5. szakaszt). A követő-linked ennél hamarabb, a kézbesítést
          követő <strong>14 nap</strong> után lejár. Marketing célra soha nem használjuk,
          és hírlevelet nem küldünk.
        </li>
        <li>
          <strong>Kinek adjuk át:</strong> a küldeményt szállító személynek (a neved és a
          telefonszámod, hogy fel tudjon hívni), valamint az SMS- és e-mail-küldő
          szolgáltatónknak (lásd 4. pont).
        </li>
        <li>
          <strong>Milyen jogaid vannak:</strong> ugyanazok, mint a felhasználóinknak
          (8. pont) — hozzáférés, helyesbítés, törlés, tiltakozás. Mivel nincs fiókod, a
          beazonosításhoz elég annak a küldeménynek az azonosítója vagy a követő-linked.
        </li>
      </ul>
      <p>
        <strong>Ha nem te vagy a címzett, vagy nem szeretnéd, hogy kezeljük az adataidat:</strong>{' '}
        írj az <strong>info@gofuvar.hu</strong> címre, és töröljük őket. Ilyenkor a feladót
        értesítjük, hogy a küldemény kézbesítését más módon kell egyeztetnie.
      </p>

      <h2 style={{ marginTop: 32 }}>8. Az Érintettek Jogai és Eljárási Rend</h2>
      <p>
        A GDPR 13—22. cikkei alapján a Felhasználót megilletik a következő jogok
        (a Címzettre vonatkozó eltéréseket lásd a 7/A. pontban):
      </p>
      <ul>
        <li><strong>Hozzáférési jog:</strong> kérheti a róla tárolt adatok másolatát</li>
        <li><strong>Helyesbítéshez való jog:</strong> téves adat javítása</li>
        <li><strong>Törléshez való jog („elfeledtetés"):</strong> a fiók és a hozzá tartozó nem-jogszabályban előírt adatok teljes törlése</li>
        <li><strong>Adatkezelés korlátozása:</strong> bizonyos esetekben az adatokat nem dolgozzuk fel, csak tároljuk</li>
        <li><strong>Adathordozhatóság:</strong> az adatok strukturált, géppel olvasható (JSON) formátumban való kiadása</li>
        <li><strong>Tiltakozás:</strong> jogos érdek-alapú adatkezelés ellen (pl. csalásmegelőzés, kivéve ha kötelező)</li>
        <li><strong>Automatizált döntés-felülvizsgálat:</strong> lásd 6. pont</li>
      </ul>
      <p>
        <strong>8.1. Hogyan kell egy kérést benyújtani:</strong> e-mail az{' '}
        <strong>info@gofuvar.hu</strong> címre, vagy postai levél a Szolgáltató székhelyére. A
        kérelemben tüntesd fel a regisztrációhoz használt e-mail címedet a beazonosítás érdekében.
        Ha nincs fiókod (pl. csomagot vársz címzettként), a küldemény azonosítója vagy a
        neked küldött követő-link is elegendő.
      </p>
      <p>
        <strong>8.2. Válaszadási határidő:</strong> az Adatkezelő minden megalapozott kérelmet
        <strong> 1 hónapon belül</strong> teljesít. A kérelem összetettségére tekintettel ez az idő
        legfeljebb 2 hónappal meghosszabbítható, melyről a Felhasználót külön értesítjük.
      </p>
      <p>
        <strong>8.3. A kérelem költsége:</strong> a kérelmek elbírálása alapesetben{' '}
        <strong>ingyenes</strong>. Nyilvánvalóan rosszhiszemű, indokolatlan vagy ismétlődő kérelem
        esetén az Adatkezelő ésszerű díjat számolhat fel, vagy a kérelem teljesítését megtagadhatja.
      </p>
      <p>
        <strong>8.4. Jogorvoslat:</strong> ha a Felhasználó úgy ítéli meg, hogy adatkezelésünk
        szabálytalan vagy a kérése nem került megfelelően elbírálásra, jogosult panaszt tenni a
        felügyeleti hatóságnál:
      </p>
      <p style={{ marginLeft: 16 }}>
        <strong>Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)</strong><br />
        1055 Budapest, Falk Miksa utca 9—11.<br />
        Postacím: 1374 Budapest, Pf. 603<br />
        E-mail: ugyfelszolgalat@naih.hu<br />
        Honlap: <a href="https://www.naih.hu" target="_blank" rel="noopener noreferrer">www.naih.hu</a>
      </p>
      <p>
        Vagy a Felhasználó közvetlenül polgári bírósághoz fordulhat — a lakóhelye vagy az
        Adatkezelő székhelye szerinti illetékességű bíróságon.
      </p>
      <p>
        <strong>EU-tagállami Felhasználó esetén:</strong> az Európai Unió bármely tagállamában élő
        érintett a saját lakóhelye, munkahelye vagy a feltételezett jogsértés helye szerinti
        felügyeleti hatóságnál is panaszt tehet (GDPR 77. cikk). A nemzeti adatvédelmi hatóságok
        elérhetőségei elérhetőek az Európai Adatvédelmi Testület (EDPB) honlapján:{' '}
        <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_hu" target="_blank" rel="noopener noreferrer">
          edpb.europa.eu/about-edpb/about-edpb/members_hu
        </a>.
      </p>

      <h2 style={{ marginTop: 32 }}>9. Adatvédelmi Incidens-eljárás</h2>
      <p>
        Adatvédelmi incidensnek minősül a személyes adatok jogellenes nyilvánosságra hozatala,
        elvesztése, jogosulatlan hozzáférése (pl. kibertámadás, jelszó-szivárgás, tévesen megosztott
        adat). Ilyen esemény bekövetkezése esetén az Adatkezelő:
      </p>
      <ul>
        <li>
          haladéktalanul (de legkésőbb az incidens tudomására jutását követő{' '}
          <strong>72 órán belül</strong>) bejelenti az incidenset a NAIH felé, kivéve ha az incidens
          valószínűsíthetően nem jár az érintettek jogaira és szabadságaira nézve kockázattal
        </li>
        <li>
          ha az incidens magas kockázatot jelent az érintettek jogaira nézve, az érintetteket is
          közvetlenül értesíti, indokolatlan késedelem nélkül
        </li>
        <li>
          minden incidenst belső naplóban rögzít (kategória, érintettek köre, adatkör, hatás,
          megtett intézkedések)
        </li>
      </ul>
      <p>
        Incidens-bejelentést a felhasználó az <strong>info@gofuvar.hu</strong> címen tehet, ha
        gyanús eseményt észlel.
      </p>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/aszf">Általános Szerződési Feltételek (ÁSZF)</a>
      </p>
    </article>
  );
}
