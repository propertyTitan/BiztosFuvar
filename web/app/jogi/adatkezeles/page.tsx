// FONTOS: Ez a szöveg PLACEHOLDER. Launch előtt egy ügyvéddel
// felülvizsgáltatandó és a GDPR + a magyar Infotv. szerint pontosítandó.
// A platform adatkezelési specialitásai (KYC fotó tárolás, GPS log,
// AI-fotó-elemzés, escrow) speciális tájékoztatást igényelnek.

import Link from 'next/link';

export const metadata = {
  title: 'Adatkezelési tájékoztató — GoFuvar',
  description: 'A GoFuvar személyes adatok kezelésével kapcsolatos tájékoztatója (GDPR).',
};

export default function AdatkezelesPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>Adatkezelési tájékoztató</h1>
      <p className="muted" style={{ fontStyle: 'italic' }}>
        Verzió: 0.1 (placeholder) · Hatályos: 2026-05-09 (módosítva launch előtt)
      </p>

      <div
        style={{
          padding: 16, marginTop: 16, marginBottom: 32,
          background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 8, fontSize: 14,
        }}
      >
        ⚠️ <strong>Munka-példány.</strong> Ezt a szöveget egy ügyvéd véglegesíti
        a launch előtt. A linkek már működnek, hogy a regisztráció és a KYC ne
        legyen törött, de a tartalom <em>jogi értelemben még nem hatályos</em>.
      </div>

      <h2>1. Adatkezelő</h2>
      <p>
        GoFuvar Kft. (cégjegyzékszám: __, székhely: __, adatvédelmi
        kapcsolattartó: __@gofuvar.hu)
      </p>

      <h2>2. Mit gyűjtünk és miért</h2>

      <h3>2.1. Regisztrációs adatok</h3>
      <ul>
        <li><strong>Mit:</strong> név, e-mail, telefonszám, jelszó hash</li>
        <li><strong>Miért:</strong> bejelentkezés, kommunikáció, jogszabály alapján kötelező user-azonosítás</li>
        <li><strong>Jogalap:</strong> szerződéses kötelezettség (GDPR 6.(1).b)</li>
        <li><strong>Meddig:</strong> a fiók törléséig + 5 év (számviteli okból)</li>
      </ul>

      <h3>2.2. KYC dokumentum (sofőri jogosítvány)</h3>
      <ul>
        <li><strong>Mit:</strong> jogosítvány fotója, név, okmányszám, lejárati dátum</li>
        <li><strong>Miért:</strong> a sofőr-jogosultság és a jogosítvány érvényességének hitelesítése</li>
        <li><strong>Jogalap:</strong> jogszabály-megfelelés (GDPR 6.(1).c) + szerződés</li>
        <li><strong>Hol tároljuk:</strong> EU-régiós Cloudflare R2, AES-256 titkosítás, csak a backendből — auth + permission check után — érhető el</li>
        <li><strong>Meddig:</strong> a fotó az adminisztrátori jóváhagyás után <strong>30 nap</strong> múlva automatikusan törlődik (adat-minimalizálás); csak a metaadat (név, okmányszám, lejárat) marad meg a státusz fenntartására</li>
      </ul>

      <h3>2.3. Fuvar-fotók (proof of delivery)</h3>
      <ul>
        <li><strong>Mit:</strong> a felvétel és lerakodás során készült fotók, GPS koordináta a felvétel pillanatában, AI-elemzés eredménye</li>
        <li><strong>Miért:</strong> a teljesítés bizonyítása, vitarendezés alapja</li>
        <li><strong>Jogalap:</strong> szerződéses kötelezettség</li>
        <li><strong>Meddig:</strong> a fuvarrekord élettartamával egyező (alapértelmezetten 5 év, számviteli okból)</li>
      </ul>

      <h3>2.4. GPS pozíció (élő követés)</h3>
      <ul>
        <li><strong>Mit:</strong> a sofőr telefonjáról küldött koordináta-pingek a fuvar idején</li>
        <li><strong>Miért:</strong> élő követés a feladó számára, ETA pontosítás, vita-bizonyíték</li>
        <li><strong>Jogalap:</strong> hozzájárulás (a sofőr külön engedélyt ad a Platformon)</li>
        <li><strong>Meddig:</strong> a fuvar lezárása után 30 nap; aggregált statisztika (anonimizálva) tovább</li>
      </ul>

      <h3>2.5. Audit log (file-hozzáférések)</h3>
      <ul>
        <li><strong>Mit:</strong> ki, mikor, mely IP-ről nézte meg egy fájl tartalmát</li>
        <li><strong>Miért:</strong> incidensek vizsgálata, hatósági adatszolgáltatás-kötelezettség</li>
        <li><strong>Jogalap:</strong> jogos érdek (GDPR 6.(1).f) — a felhasználó adatainak védelme</li>
        <li><strong>Meddig:</strong> 1 év</li>
      </ul>

      <h2>3. Kik látják az adataidat</h2>
      <ul>
        <li><strong>Te magad</strong>: minden saját adat</li>
        <li><strong>A másik fél a fuvarodon</strong> (csak a fuvar idején): name, telefonszám (ha megosztott), profilkép, értékelés</li>
        <li><strong>GoFuvar adminisztráció</strong>: KYC dokumentumok hitelesítéskor, viták elbírálásakor (audit-logolva)</li>
        <li><strong>Adatfeldolgozó partnerek</strong>:
          <ul>
            <li>Cloudflare R2 (object storage, EU régió)</li>
            <li>Supabase / Neon (PostgreSQL, EU régió)</li>
            <li>Barion Payment Zrt. (fizetés-feldolgozás)</li>
            <li>Resend (email küldés)</li>
            <li>Google (Gemini AI, Maps API) — szerződéses adatfeldolgozási megállapodás keretében</li>
          </ul>
        </li>
        <li><strong>Hatóságok</strong>: ha jogi kötelezettség alapján kérik (audit log alapján visszanézhető)</li>
      </ul>

      <h2>4. A jogaid (GDPR)</h2>
      <ul>
        <li><strong>Hozzáférés</strong>: kérheted minden rólad tárolt adat lekérdezését</li>
        <li><strong>Helyesbítés</strong>: téves adatot javíthatsz a profilodon</li>
        <li><strong>Törlés („elfeledtetéshez való jog")</strong>: a profilodon a „Fiók törlése" gombbal minden adatod törlődik a tárolóból; csak a jogi okból kötelező anonimizált fizetés-naplók maradnak</li>
        <li><strong>Adathordozhatóság</strong>: kérheted az adatok struktúrált, gépi olvasható formában történő kiadását</li>
        <li><strong>Hozzájárulás visszavonása</strong>: bármikor</li>
        <li><strong>Panasz</strong>: a Nemzeti Adatvédelmi és Információszabadság Hatóságnál (NAIH) — naih.hu</li>
      </ul>

      <h2>5. Sütik (cookies)</h2>
      <p>
        A Platform a működéshez szükséges sütiket használja (bejelentkezés,
        nyelv, felhasználói beállítások). Marketing- vagy analytics-süti
        jelenleg <em>nincs</em>. Ha a jövőben ilyenek bevezetésre kerülnek,
        külön hozzájárulást kérünk a cookie-banneren keresztül.
      </p>

      <h2>6. Adatbiztonság</h2>
      <ul>
        <li>Minden adatkommunikáció HTTPS/TLS titkosítással</li>
        <li>Jelszavak scrypt hashalgoritmussal tárolva</li>
        <li>Feltöltött fájlok privát object storage-ban, AES-256 titkosítással</li>
        <li>Backend-elérés JWT alapú, rate-limit védelemmel</li>
        <li>Minden file-hozzáférés audit-logolva</li>
      </ul>

      <h2>7. Kapcsolat</h2>
      <p>
        Adatvédelemmel kapcsolatos kérdés: <strong>privacy@gofuvar.hu</strong> (cím
        beállítása launch előtt).
      </p>

      <p className="muted" style={{ marginTop: 32, fontSize: 13 }}>
        Vissza az{' '}
        <Link href="/jogi/aszf" style={{ color: 'var(--primary)' }}>ÁSZF-re</Link>
        {' '}vagy a{' '}
        <Link href="/" style={{ color: 'var(--primary)' }}>főoldalra</Link>.
      </p>
    </div>
  );
}
