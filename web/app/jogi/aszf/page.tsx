// FONTOS: Ez a szöveg PLACEHOLDER. Launch előtt egy ügyvéddel
// felülvizsgáltatandó és a magyar jog szerint pontosítandó. A platform
// jellegéhez (P2P fuvarozási marketplace, escrow + Barion + AI fotó
// + GDPR kategorizált adatkezelés) speciális ÁSZF-pontok kellenek.
//
// Ez itt csak strukturált váz: hogy az "ÁSZF" link már a nyilvános
// regisztrációkor és láblécekben működjön és ne 404-eljen.

import Link from 'next/link';

export const metadata = {
  title: 'ÁSZF — GoFuvar',
  description: 'A GoFuvar platform Általános Szerződési Feltételei.',
};

export default function ASZFPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>Általános Szerződési Feltételek</h1>
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
        a launch előtt. A linkek már működnek, hogy a regisztráció ne legyen
        törött, de a tartalom <em>jogi értelemben még nem hatályos</em>.
      </div>

      <h2>1. Fogalmak</h2>
      <ul>
        <li><strong>Szolgáltató</strong>: GoFuvar Kft. (cégjegyzékszám: __, székhely: __, adószám: __)</li>
        <li><strong>Felhasználó</strong>: a Platformra regisztráló természetes vagy jogi személy</li>
        <li><strong>Feladó</strong>: a Felhasználó, aki fuvart hirdet meg a Platformon</li>
        <li><strong>Sofőr</strong>: a Felhasználó, aki a fuvart elvállalja</li>
        <li><strong>Platform</strong>: a www.gofuvar.hu honlap és a kapcsolódó mobilapplikáció</li>
        <li><strong>Letét (escrow)</strong>: a Barion Payment Zrt. által kezelt ideiglenes pénztartás</li>
      </ul>

      <h2>2. A Szolgáltató szerepe</h2>
      <p>
        A GoFuvar egy közvetítő platform, amely lehetőséget biztosít arra, hogy
        a Feladók és Sofőrök egymással szerződéses kapcsolatba lépjenek. A
        Szolgáltató NEM részese a fuvarszerződésnek és NEM vállal felelősséget
        a fuvarozással kapcsolatos teljesítésért, kivéve a kifejezetten
        rögzített szolgáltatásokért (technikai platform üzemeltetése, fizetési
        közvetítés, vita-rendezési eljárás).
      </p>

      <h2>3. Regisztráció és KYC</h2>
      <p>
        A Sofőri státuszhoz kötelező a sofőri jogosítvány feltöltése és
        az adminisztráció általi jóváhagyása. A Szolgáltató fenntartja a
        jogot a regisztráció elutasítására, ha a benyújtott okmányok nem
        megfelelőek vagy lejártak.
      </p>

      <h2>4. Fizetés és platformdíj</h2>
      <p>
        A platform 10% jutalékot számol fel a sikeresen teljesített fuvarok
        után. A Feladó a fuvardíjat a Barion Payment Zrt. által kezelt
        letétbe fizeti, amelyből a sikeres teljesítés (átvételi kód +
        proof-of-delivery fotó) után a Szolgáltató kifizeti a Sofőr 90%-os
        részét, és levonja a 10% jutalékot.
      </p>

      <h2>5. Lemondás</h2>
      <p>
        A Feladó a fuvar elindulásáig (Sofőr GPS-ping-ig) lemondhatja a
        fuvart. Ekkor 10% (max. 1.000 Ft) lemondási díj kerül levonásra,
        a többi visszatérítésre kerül a fizetés módja szerint.
      </p>

      <h2>6. Felelősség és kárfelelősség</h2>
      <p>
        A fuvarozás során bekövetkező károkért elsősorban a Sofőr felel.
        A Szolgáltató moderált vita-rendezési eljárást biztosít, melynek
        kötelező elemei: a kárt jelenteni 24 órán belül, fotó-bizonyítékot
        feltölteni, a vita-modul használata.
      </p>

      <h2>7. Vita-rendezés</h2>
      <p>
        A Felek között felmerülő vitákat elsősorban a Szolgáltató Admin
        csapata bírálja el a beadott bizonyítékok alapján (fotók, GPS log,
        kommunikáció a Platformon, átvételi kód státusza). Az Admin döntés
        a Felekre kötelező; ha a vesztes fél nem ért egyet, peres úton
        érvényesítheti igényét, de a letétben tartott összeg felszabadul
        az Admin-döntés szerint.
      </p>

      <h2>8. A Felhasználó kötelezettségei</h2>
      <p>
        Tilos hamis adatokkal regisztrálni, jogosulatlan helyen / módon
        szállítani, illegális vagy veszélyes árut feladni vagy szállítani
        (külön mellékletben részletezve), a Platform megkerülésével
        kommunikálni vagy fizetni. Súlyos megsértésnél a Szolgáltató
        kizárhatja a Felhasználót.
      </p>

      <h2>9. Adatkezelés</h2>
      <p>
        Az adatkezelés részleteit az{' '}
        <Link href="/jogi/adatkezeles" style={{ color: 'var(--primary)' }}>
          Adatkezelési tájékoztató
        </Link>{' '}
        tartalmazza.
      </p>

      <h2>10. Záró rendelkezések</h2>
      <p>
        Jelen ÁSZF-re a magyar jog az irányadó. A Szolgáltató fenntartja
        a jogot az ÁSZF egyoldalú módosítására, melyről a Felhasználókat
        értesíti a regisztrált e-mail címen, az új verzió hatálybalépését
        legalább 14 nappal megelőzően.
      </p>

      <p className="muted" style={{ marginTop: 32, fontSize: 13 }}>
        Vissza a{' '}
        <Link href="/" style={{ color: 'var(--primary)' }}>főoldalra</Link>.
      </p>
    </div>
  );
}
