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
        <strong>Hatályos:</strong> 2026. július 4-től
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
          <strong>KYC adatok:</strong> Személyi igazolvány, és céges fiók esetén adószám
          (Biztonság, jogi megfelelés). A KYC dokumentumok fotója nyers formában a hitelesítés
          ideje alatt kerül tárolásra.
        </li>
        <li>
          <strong>Tranzakciós adatok:</strong> Számlázási adatok, Barion fizetési azonosító
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
          <strong>Címzetti telefonszám:</strong> Többlépcsős tájékoztatás a csomag érkezéséről,
          átvételi kód eljuttatása, sikeres kézbesítés visszaigazolása.
        </li>
        <li>
          <strong>Feladói telefonszám:</strong> Kapcsolattartás mellett a sikeres teljesítésről
          szóló záró SMS-értesítés küldése.
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
        <li><strong>Barion Payment Zrt.</strong> (1117 Budapest) — bankkártyás fizetés (kapcsolatfelvételi díj)</li>
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
          (2000. évi C. tv. — Számviteli törvény).
        </li>
        <li>
          <strong>KYC dokumentumok:</strong> A fiók megszüntetését követő 5 évig
          (Polgári jogi elévülés és csalásmegelőzés). A platform a hitelesítést követően az
          aktív tárolást technikai-szervezési intézkedésekkel minimalizálja.
        </li>
        <li>
          <strong>In-app Chat üzenetek:</strong> A fuvar lezárását követő <strong>6 hónapig</strong>{' '}
          (kizárólag vitarendezés céljából), utána automatikusan törlésre kerülnek. Kivétel: ha a
          fuvarral kapcsolatban vitarendezési eljárás indult vagy megőrzési zárolás van érvényben —
          ilyenkor kizárólag az érintett fuvar üzenetei legfeljebb 5 évig kerülnek megőrzésre.
          Az Értékelések (Trust Score) a profil részeként a fiók élettartamáig megmaradnak.
        </li>
        <li>
          <strong>GPS ping adatok:</strong> Az aktív fuvar befejezését követő 7 napig tároljuk
          nyers formában, majd töröljük. Aggregált, nem-személyazonosító statisztikák tovább megőrződhetnek.
        </li>
        <li>
          <strong>File-hozzáférési audit log:</strong> 1 évig (incidens-vizsgálat és NAIH-bejelentés
          érdekében).
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
          <strong>AI-alapú KYC előellenőrzés:</strong> a feltöltött személyi igazolvány
          képét a Google Gemini AI elemzi (név, születési dátum kiolvasása, kép-minőség
          ellenőrzés). Az AI csak <strong>előellenőrzést</strong> végez,
          <strong> a végleges hitelesítést minden esetben emberi adminisztrátor</strong> hagyja
          jóvá.
        </li>
        <li>
          <strong>Automata kor-ellenőrzés:</strong> az AI a személyi igazolványról kiolvassa a
          születési dátumot, és ha az 18 évnél fiatalabb felhasználót jelez, a regisztráció
          automatikusan visszautasításra kerül. Ez a döntés joghatást vált ki, ezért a felhasználó
          jogosult emberi felülvizsgálatra (lásd 8.4. pont).
        </li>
        <li>
          <strong>Trust Score:</strong> a Sofőr platformon belüli megbízhatósági pontszámát egy
          algoritmus számítja teljesített fuvarok, értékelések, viták és lemondások alapján.
          A Trust Score a fuvar-elfogadási sorrendet befolyásolja, és kiemelkedően alacsony
          értéknél a fiók ideiglenes felfüggesztését eredményezheti.
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

      <h2 style={{ marginTop: 32 }}>8. Az Érintettek Jogai és Eljárási Rend</h2>
      <p>
        A GDPR 13—22. cikkei alapján a Felhasználót megilletik a következő jogok:
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
