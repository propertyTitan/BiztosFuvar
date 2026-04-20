// Általános Szerződési Feltételek — TERVEZET
// Ezt a szöveget az ügyvéd készítette. Hatályba lépés előtt a
// jelölt hiányosságokat ki kell pótolni (illetékes bíróság,
// békéltető testület, sofőri felelősség a deklarált értékig).
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
        <strong>Platform:</strong> GoFuvar (gofuvar.hu és a hozzá tartozó
        mobilalkalmazások)<br />
        <strong>Hatályos:</strong> 2026. [Hónap] [Nap]-tól
      </p>

      <div
        style={{
          marginTop: 20,
          padding: 12,
          borderRadius: 8,
          background: 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.5)',
          fontSize: 13,
        }}
      >
        ⚠️ <strong>Tervezet státusz:</strong> jelen dokumentum jogi felülvizsgálat
        alatt áll. A hatályba lépés előtt a végleges szöveget az ügyvéd véglegesíti.
      </div>

      <h2 style={{ marginTop: 32 }}>1. A Szolgáltató adatai és a Szolgáltatás jellege</h2>
      <p>
        <strong>1.1.</strong> A GoFuvar platform üzemeltetője a{' '}
        <strong>Tiszta Hód Kft. (bejegyzés alatt)</strong> (továbbiakban:{' '}
        <strong>Szolgáltató</strong>).
      </p>
      <p>
        <strong>1.2. A Szolgáltatás jellege:</strong> A Szolgáltató információs
        társadalommal összefüggő szolgáltatást, egy kétoldalú informatikai
        közvetítő platformot (Piacteret) üzemeltet.
      </p>
      <p>
        <strong>1.3. Közvetítői státusz:</strong> A Szolgáltató NEM végez
        szállítmányozási, fuvarozási vagy futárpostai tevékenységet. A
        fuvarozási szerződés kizárólag a csomagot feladó felhasználó
        (továbbiakban: <strong>Feladó</strong>) és a fuvarozást vállaló
        felhasználó (továbbiakban: <strong>Sofőr</strong>) között jön létre.
      </p>

      <h2 style={{ marginTop: 32 }}>
        2. Regisztráció, Korhatár és Progresszív KYC (Azonosítás)
      </h2>
      <p>
        <strong>2.1. Korhatár:</strong> A platform regisztrációhoz kötött,
        amelyet kizárólag 18. életévüket betöltött, cselekvőképes természetes
        személyek, illetve jogi személyek végezhetnek el. Kiskorúak a platformot
        nem használhatják.
      </p>
      <p>
        <strong>2.2.</strong> A regisztrációt követően a Felhasználó böngészheti
        a platformot (Guest mód), azonban érvényes tranzakció (fuvarfeladás,
        licitálás, útvonalhirdetés) megkezdése kizárólag a személyazonosság
        (KYC) igazolása után lehetséges.
      </p>
      <p>
        <strong>2.3. Magánszemély Feladó:</strong> Köteles érvényes
        személyazonosító igazolványának feltöltésére.
      </p>
      <p>
        <strong>2.4. Céges Feladó (B2B):</strong> A személyazonosító okmányon
        felül köteles a cégképviseletet igazoló okirat (Cégkivonat) feltöltésére
        és az adószám megadására.
      </p>
      <p>
        <strong>2.5. Sofőr:</strong> A személyazonosító okmányon (és cég esetén
        cégkivonaton) felül köteles az érvényes vezetői engedélyének feltöltésére.
        A fuvarozáshoz szükséges hatósági engedélyek megléte a Sofőr kizárólagos
        felelőssége.
      </p>

      <h2 style={{ marginTop: 32 }}>3. A Fuvarozási Szerződés Létrejötte és Bizalmi Lánc</h2>
      <p>
        <strong>3.1.</strong> A szerződés a Feladó és a Sofőr között jön létre,
        amikor a Feladó elfogadja a Sofőr licitjét, és a fuvardíjat sikeresen
        letétbe helyezi.
      </p>
      <p>
        <strong>3.2. Proof of Delivery:</strong> A kézbesítés igazolása a Feladó
        (vagy Címzett) birtokában lévő 6 jegyű átvételi kód, vagy az azt
        tartalmazó QR kód Sofőr általi platformon belüli beolvasásával történik.
      </p>

      <h2 style={{ marginTop: 32 }}>4. Pénzügyi Feltételek és Számlázás (Bolt-modell)</h2>
      <p>
        <strong>4.1. Fizetési mód (Barion Escrow):</strong> A Feladó a teljes
        fuvardíjat bankkártyával, a Barion Payment Zrt. (MNB engedélyszám:
        H-EN-I-1064/2013) zárt, letéti rendszerén keresztül egyenlíti ki.
      </p>
      <p>
        <strong>4.2. Pénzkezelés:</strong> A Szolgáltató a fuvardíjat nem
        kezeli. A tranzakció lebonyolítója és a letét kezelője kizárólag a
        Barion Payment Zrt. A letét a sikeres kézbesítés (kód beolvasása)
        pillanatában szabadul fel a Sofőr részére.
      </p>
      <p>
        <strong>4.3. Platformhasználati díj (Jutalék):</strong> A Szolgáltató a
        közvetítésért a Sofőr felé Platformhasználati díjat számít fel. Ennek
        mértéke minden sikeresen létrejött fuvar után a teljes fuvardíj{' '}
        <strong>10%-a, plusz 400 Ft fix adminisztrációs díj</strong>. (Kivéve:
        promóciós időszakban vagy szintlépésből adódó Voucher beváltása esetén).
      </p>
      <p>
        <strong>4.4. Számlázási rend:</strong>
      </p>
      <ul>
        <li>
          A szállítási szolgáltatásról szóló számlát/bizonylatot a{' '}
          <strong>Sofőr állítja ki a Feladó részére</strong> a fuvardíj teljes
          (100%) összegéről. Céges Feladó esetén a Sofőr ÁFA-s számla
          kiállítására kötelezett a Feladó által megadott cégadatokra.
        </li>
        <li>
          A Szolgáltató (GoFuvar) a Platformhasználati díjról (10% + 400 Ft)
          állít ki számlát a <strong>Sofőr részére</strong>.
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>5. Lemondási Feltételek és Felelősségkizárás</h2>
      <p>
        <strong>5.1. Feladói lemondás:</strong> Ha a Feladó a fuvart a felvétel
        előtt lemondja, a Szolgáltató 10% (max. 1.000 Ft) adminisztrációs díjat
        számít fel.
      </p>
      <p>
        <strong>5.2.</strong> A Szolgáltató nem felel a csomagok tartalmáért,
        sérüléséért, megsemmisüléséért, vagy a késedelmes szállításból eredő
        károkért. Illegális tárgyak szállítása a platformon szigorúan tilos.
      </p>
      <p>
        <strong>5.3. Adatszolgáltatási Kötelezettség (DAC7):</strong> A
        Szolgáltató köteles évente jelentést tenni a Nemzeti Adó- és Vámhivatal
        (NAV) felé a platformon jövedelmet szerző Sofőrök adatairól és
        bevételeiről.
      </p>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/adatkezeles">Adatkezelési tájékoztató (GDPR)</a>
      </p>
    </article>
  );
}
