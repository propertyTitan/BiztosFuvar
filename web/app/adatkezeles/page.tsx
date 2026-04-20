// Adatkezelési Tájékoztató (GDPR) — TERVEZET
// Ezt a szöveget az ügyvéd készítette. Hatályba lépés előtt a
// jelölt hiányosságokat ki kell pótolni (érintetti jogok, NAIH panaszjog,
// EU-n kívüli adattovábbítás részletezése).
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
        fontSize: 15,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Adatkezelési Tájékoztató (GDPR)</h1>
      <p className="muted" style={{ margin: 0 }}>
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

      <h2 style={{ marginTop: 32 }}>1. Az Adatkezelő és az Érintettek</h2>
      <p>
        <strong>1.1. Adatkezelő:</strong> GoFuvar Kft. (bejegyzés alatt).
      </p>
      <p>
        <strong>1.2. Gyermekek védelme:</strong> A szolgáltatás kizárólag 18
        éven felüliek számára érhető el. Az Adatkezelő 18 éven aluli személyek
        személyes adatait nem kezeli; amennyiben ilyen adat a birtokába jut,
        azt haladéktalanul törli.
      </p>

      <h2 style={{ marginTop: 32 }}>2. A kezelt adatok köre és célja</h2>
      <ul>
        <li>
          <strong>Azonosító és kapcsolattartási adatok:</strong> Név, e-mail
          cím, telefonszám. <em>Cél:</em> Kapcsolattartás.
        </li>
        <li>
          <strong>KYC (Know Your Customer) adatok:</strong> Személyazonosító
          igazolvány másolata (minden Felhasználó), vezetői engedély (Sofőrök),
          cégkivonat és adószám (Céges Felhasználók). <em>Cél:</em> Biztonság,
          csalásmegelőzés, szerződéskötési feltételek ellenőrzése.
        </li>
        <li>
          <strong>Pénzügyi adatok:</strong> Számlázási adatok, Barion tárca
          azonosító. <em>Cél:</em> Kifizetések teljesítése, DAC7 jelentés.
        </li>
        <li>
          <strong>Fuvarspecifikus és GPS adatok:</strong> Felvételi/lerakodási
          címek, csomag fotók, a Sofőr aktuális tartózkodási helye aktív fuvar
          esetén. <em>Cél:</em> Élő nyomon követés, teljesítés igazolása.
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>3. Az adatkezelés jogalapja</h2>
      <ul>
        <li>
          <strong>Szerződés teljesítése:</strong> A platform használata és a
          fuvarok közvetítése.
        </li>
        <li>
          <strong>Jogi kötelezettség teljesítése:</strong> Számviteli törvény
          és DAC7 adóügyi adatszolgáltatás (NAV felé).
        </li>
        <li>
          <strong>Jogos érdek:</strong> A platform biztonságának garantálása, a
          „Bizalmi lánc" fenntartása (KYC dokumentumok manuális jóváhagyása és
          ellenőrzése).
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>4. Adatfeldolgozók és adattovábbítás</h2>
      <p>
        A GoFuvar az alábbi harmadik feleknek továbbít adatokat a szolgáltatás
        zavartalan működése érdekében:
      </p>
      <ul>
        <li>
          <strong>Barion Payment Zrt.:</strong> Fizetési tranzakciók
          lebonyolítása.
        </li>
        <li>
          <strong>IT szolgáltatók:</strong> Vercel, Railway, Neon DB, Cloudflare
          R2 (titkosított tárhely a fotóknak és KYC dokumentumoknak).
        </li>
        <li>Hatósági megkeresés esetén a NAV és a rendészeti szervek.</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>5. Adatbiztonság és Megőrzési idő</h2>
      <ul>
        <li>A jelszavakat erős scrypt algoritmussal, titkosítva tároljuk.</li>
        <li>
          A KYC dokumentumokhoz csak a jogosult adminisztrátorok férnek hozzá a
          jóváhagyási folyamat (Progressive Onboarding) során.
        </li>
        <li>
          Az adatokat a fiók törléséig, számlázási adatokat a kiállítástól
          számított 8 évig, a KYC dokumentumokat az ellenőrzési és elévülési
          idő lezártáig őrizzük meg.
        </li>
      </ul>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/aszf">Általános Szerződési Feltételek (ÁSZF)</a>
      </p>
    </article>
  );
}
