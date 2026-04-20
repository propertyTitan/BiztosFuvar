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

      <h2 style={{ marginTop: 32 }}>1. Az Adatkezelő</h2>
      <ul>
        <li><strong>Név:</strong> Tiszta Hód Korlátolt Felelősségű Társaság (Tiszta Hód Kft.)</li>
        <li><strong>Székhely:</strong> 6800 Hódmezővásárhely, Szántó Kovács János utca 144.</li>
        <li><strong>Cégjegyzékszám:</strong> 06-09-020646</li>
        <li><strong>Adószám:</strong> 24750792-2-06</li>
        <li><strong>E-mail:</strong> info@gofuvar.hu</li>
      </ul>
      <p>
        A szolgáltatás kizárólag 18 éven felüliek számára érhető el.
      </p>

      <h2 style={{ marginTop: 32 }}>2. A kezelt adatok köre és célja</h2>
      <ul>
        <li>
          <strong>Azonosító adatok:</strong> Név, e-mail, telefonszám.
        </li>
        <li>
          <strong>KYC adatok:</strong> Személyi igazolvány, jogosítvány, cégkivonat, adószám
          (Biztonság, jogi megfelelés).
        </li>
        <li>
          <strong>Tranzakciós adatok:</strong> Számlázási adatok, Barion azonosító (DAC7).
        </li>
        <li>
          <strong>Rendszer és Fuvarspecifikus adatok:</strong> Címek, GPS koordináták (élő követés),
          csomag fotók, in-app chat üzenetek, profil értékelések (Trust Score), IP címek,
          eszközazonosítók és Push tokenek (működtetés és biztonság).
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>3. Az adatkezelés jogalapja</h2>
      <p>
        <strong>Szerződés teljesítése</strong> [GDPR 6. cikk (1) b)];{' '}
        <strong>Jogi kötelezettség</strong> (Számvitel, DAC7) [GDPR 6. cikk (1) c)];{' '}
        <strong>Jogos érdek</strong> (KYC, csalásmegelőzés, vitarendezés) [GDPR 6. cikk (1) f)].
      </p>

      <h2 style={{ marginTop: 32 }}>4. Adatfeldolgozók és Adattovábbítás Harmadik Országba</h2>
      <p>
        <strong>4.1. Adatfeldolgozók:</strong> Barion Payment Zrt. (fizetés), Vercel, Railway,
        Neon DB, Cloudflare R2, Resend.
      </p>
      <p>
        <strong>4.2. USA adattovábbítás (SCC):</strong> A platform technikai működéséhez az Adatkezelő
        igénybe veszi a Google Maps Platform (címek), a Google Gemini AI (tartalomelemzés) és az
        Expo Push Notifications (mobil értesítések) szolgáltatásokat. Ezen, az EU-n kívülre (USA)
        történő adattovábbítások jogalapját az Európai Bizottság által elfogadott Általános Szerződési
        Feltételek (Standard Contractual Clauses - SCC) és az EU-US Data Privacy Framework biztosítják.
      </p>

      <h2 style={{ marginTop: 32 }}>5. Adatbiztonság és Konkrét Megőrzési Idők</h2>
      <ul>
        <li>
          <strong>Számlázási adatok:</strong> A kiállítástól számított 8 évig (Számviteli tv.).
        </li>
        <li>
          <strong>KYC dokumentumok:</strong> A fiók megszüntetését követő 5 évig
          (Polgári jogi elévülés és csalásmegelőzés).
        </li>
        <li>
          <strong>In-app Chat üzenetek és Értékelések:</strong> A fuvar lezárását követő 6 hónapig
          (Kizárólag vitarendezés céljából, utána anonimizálásra kerülnek).
        </li>
        <li>
          <strong>GPS ping adatok:</strong> Az aktív fuvar befejezését követő 7 napig tároljuk
          nyers formában, majd töröljük.
        </li>
        <li>
          A jelszavak <strong>scrypt</strong> algoritmussal titkosítva kerülnek tárolásra.
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>6. Az Érintettek Jogai és Jogorvoslat</h2>
      <p>
        A GDPR rendelet alapján a Felhasználót megilleti a hozzáférés, a helyesbítés, a törlés
        (&quot;elfeledtetés&quot;), az adathordozhatóság, valamint az adatkezelés korlátozásának és a
        tiltakozásnak a joga.
      </p>
      <p>
        Amennyiben a Felhasználó úgy ítéli meg, hogy adatkezelésünk szabálytalan, kérjük, keressen
        minket az <strong>info@gofuvar.hu</strong> címen. Jogosult továbbá panaszt tenni a felügyeleti
        hatóságnál: <strong>Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)</strong>{' '}
        (1055 Bp., Falk Miksa utca 9-11., www.naih.hu), vagy bírósághoz fordulhat.
      </p>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/aszf">Általános Szerződési Feltételek (ÁSZF)</a>
      </p>
    </article>
  );
}
