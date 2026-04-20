import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Általános Szerződési Feltételek (ÁSZF) | GoFuvar',
  description: 'A GoFuvar platform általános szerződési feltételei.',
};

export default function AszfPage() {
  return (
    <article
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '32px 20px',
        lineHeight: 1.65,
        fontSize: 15,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Általános Szerződési Feltételek (ÁSZF)</h1>
      <p className="muted" style={{ margin: 0 }}>
        <strong>Platform:</strong> GoFuvar (gofuvar.hu és a mobilalkalmazások)<br />
        <strong>Hatályos:</strong> 2026. [Hónap] [Nap]-tól
      </p>

      <h2 style={{ marginTop: 32 }}>1. A Szolgáltató adatai és Elérhetőségei</h2>
      <p>
        Az e-Kereskedelemről szóló 2001. évi CVIII. törvény alapján a szolgáltató adatai:
      </p>
      <ul>
        <li><strong>Cégnév:</strong> Tiszta Hód Korlátolt Felelősségű Társaság (Tiszta Hód Kft.)</li>
        <li><strong>Székhely:</strong> 6800 Hódmezővásárhely, Szántó Kovács János utca 144.</li>
        <li><strong>Cégjegyzékszám:</strong> 06-09-020646</li>
        <li><strong>Adószám:</strong> 24750792-2-06</li>
        <li><strong>Képviseli:</strong> Jovány Gyula</li>
        <li><strong>Központi e-mail cím:</strong> info@gofuvar.hu</li>
        <li><strong>Panaszkezelési e-mail cím:</strong> panasz@gofuvar.hu</li>
        <li><strong>Telefonszám:</strong> +36 20 397 9223</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>2. A Szolgáltatás jellege és Közvetítői státusz</h2>
      <p>
        A Szolgáltató egy kétoldalú informatikai közvetítő platformot (<strong>Piacteret</strong>) üzemeltet.
        A Szolgáltató <strong>NEM</strong> végez fuvarozási vagy postai tevékenységet.
        A fuvarozási szerződés kizárólag a csomagot feladó (továbbiakban: <strong>Feladó</strong>) és
        a fuvarozást vállaló (továbbiakban: <strong>Sofőr</strong>) között jön létre.
      </p>

      <h2 style={{ marginTop: 32 }}>3. Regisztráció és Progresszív KYC</h2>
      <p>
        <strong>3.1.</strong> A regisztráció kizárólag 18. életévüket betöltött, cselekvőképes személyek
        és jogi személyek számára engedélyezett.
      </p>
      <p>
        <strong>3.2.</strong> A tranzakciók megkezdése a személyazonosság (KYC) igazolásához kötött
        (Személyi igazolvány, Sofőröknél + Jogosítvány, Cégeknél + Cégkivonat és Adószám).
      </p>

      <h2 style={{ marginTop: 32 }}>4. Pénzügyi Feltételek és Számlázás (Bolt-modell)</h2>
      <p>
        <strong>4.1. Fizetés (Barion Escrow):</strong> A fuvardíjat a Feladó a Barion Payment Zrt.
        letéti rendszerén keresztül egyenlíti ki. A letét a sikeres kézbesítés (átvételi kód beolvasása)
        pillanatában szabadul fel a Sofőr részére.
      </p>
      <p>
        <strong>4.2. Platformhasználati díj:</strong> A Szolgáltató a Sofőr felé a teljes fuvardíj{' '}
        <strong>10%-a + 400 Ft fix adminisztrációs díjat</strong> számít fel.
      </p>
      <p>
        <strong>4.3. Számlázás:</strong> A fuvardíj teljes (100%) összegéről a számlát/bizonylatot
        a <strong>Sofőr állítja ki a Feladó részére</strong>. A Szolgáltató a Platformhasználati díjról
        állít ki számlát a <strong>Sofőr részére</strong>.
      </p>

      <h2 style={{ marginTop: 32 }}>5. Lemondás, Kártérítési Felelősség és DAC7</h2>
      <p>
        <strong>5.1. Lemondás:</strong>
      </p>
      <ul>
        <li>
          <strong>Feladói lemondás (felvétel előtt):</strong> A Szolgáltató 10% (max. 1.000 Ft)
          adminisztrációs díjat von le.
        </li>
        <li>
          <strong>Sofőri lemondás:</strong> A Feladó a kifizetett letét 100%-át maradéktalanul
          visszakapja, a Sofőr platformon belüli &quot;Trust Score&quot; értéke csökken.
        </li>
      </ul>
      <p>
        <strong>5.2. A Sofőr kártérítési felelőssége:</strong> A küldemény épségéért a Sofőr felel.
        A kártérítési felelősség felső határa a Feladó által megadott deklarált érték. Amennyiben a
        Feladó nem adott meg deklarált értéket, a Sofőr felelősségének alapértelmezett felső határa
        egységesen <strong>bruttó 50.000 Ft</strong>. A Szolgáltató a csomagok sérüléséért nem felel.
      </p>
      <p>
        <strong>5.3. DAC7:</strong> A Szolgáltató a jogszabályoknak megfelelően adatot szolgáltat
        a NAV felé a Sofőrök bevételeiről.
      </p>

      <h2 style={{ marginTop: 32 }}>6. Fogyasztói Jogok: Elállás és Panaszkezelés</h2>
      <p>
        <strong>6.1. 14 napos elállási jog (B2C):</strong> A fogyasztó és a vállalkozás közötti
        szerződések részletes szabályairól szóló 45/2014. (II. 26.) Korm. rendelet alapján a
        fogyasztónak minősülő Feladót alapesetben 14 napos elállási jog illeti meg.
      </p>
      <p>
        <strong>6.2. Kivételszabály (Az elállási jog elvesztése):</strong> Tekintettel arra, hogy a
        platformon a fuvarozási szolgáltatás a Feladó kifejezett, előzetes beleegyezésével kezdődik meg,
        a Feladó elveszíti a 14 napos elállási jogát abban a pillanatban, amikor a szolgáltatás egésze
        teljesítésre kerül (a csomag sikeres kézbesítése megtörténik) [Rendelet 29. &sect; (1) bek. a) pont].
      </p>
      <p>
        <strong>6.3. Panaszkezelés:</strong> A Felhasználó panaszát a{' '}
        <strong>panasz@gofuvar.hu</strong> e-mail címen vagy a Szolgáltató székhelyére küldött postai
        levélben teheti meg. A Szolgáltató a beérkezett panaszt 30 napon belül érdemben kivizsgálja
        és írásban megválaszolja.
      </p>
      <p>
        <strong>6.4. Békéltető Testület:</strong> A panasz elutasítása esetén a fogyasztó jogosult
        a lakóhelye, vagy a Szolgáltató székhelye szerint illetékes Békéltető Testülethez fordulni.
        A Szolgáltató székhelye szerinti testület adatai:{' '}
        <strong>Csongrád-Csanád Megyei Békéltető Testület</strong> (Cím: 6721 Szeged, Párizsi krt. 8-12.,
        E-mail: bekelteto.testulet@csmkik.hu).
      </p>

      <h2 style={{ marginTop: 32 }}>7. Az ÁSZF Módosítása</h2>
      <p>
        A Szolgáltató fenntartja a jogot az ÁSZF egyoldalú módosítására. A lényeges módosításokról
        a Felhasználókat a hatálybalépés előtt legalább 15 nappal e-mailben, vagy a platformon belüli
        (in-app) értesítés formájában tájékoztatja.
      </p>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/adatkezeles">Adatkezelési Tájékoztató (GDPR)</a>
      </p>
    </article>
  );
}
