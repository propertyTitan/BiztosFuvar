'use client';

// =====================================================================
//  TESZT FIZETÉSI MÓD — LÁTHATÓ FIGYELMEZTETÉS
//
//  ⚠️ MIÉRT LÉTEZIK EZ A KOMPONENS (2026-08-15, user-döntés):
//
//  Élesben a stub-fizetés alapesetben ZÁRVA van: enélkül bárki fizetés nélkül
//  „fizetettnek" jelölhetné a saját fuvarát, és ingyen megkapná a kontaktot —
//  a platform EGYETLEN bevétele kerülhető meg. A védelem mellékhatása viszont
//  az volt, hogy a fizetés UTÁNI fél rendszer (felvétel, átvételi kód,
//  kézbesítés, értékelés, vita) élesben egyáltalán nem tesztelhető, amíg a CIB
//  nem él. A user döntése: `ALLOW_STUB_PAYMENTS=true`, a launchnál vissza.
//
//  Az aggály — hogy az env-változó ELFELEJTVE BENT MARAD a launchkor — ezzel
//  nem szűnt meg. Ez a sáv a válasz rá: NEM az emlékezetre épül, hanem arra,
//  hogy egy VALÓDI FELHASZNÁLÓ is azonnal látja, ha a teszt-üzem élesben
//  maradt. A boot-log és a Sentry-riasztás csak akkor ér valamit, ha valaki
//  nézi; ezt a sávot nem lehet nem észrevenni.
//
//  KÉT FAJTA (CIB PR-3, 2026-09-29) — a `GET /auth/me` `payment_test_kind`
//  mezője dönt:
//   - 'stub'      → a mai SÁRGA sáv (szimulált fizetés, nincs bank);
//   - 'cib_teszt' → KÉK sáv: a CIB banki TESZTKÖRNYEZETE fut (valódi banki
//                    oldal, de valódi terhelés nincs, csak a bank tesztkártyái
//                    működnek) — a kijelölt tesztfiókoknak;
//   - null        → éles üzem, nincs sáv.
//  Régi backendnél (csak `payment_test_mode` boolean) a mai sárga sáv marad.
// =====================================================================
import { useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { api } from '@/api';
import { CIB_TESZT_SAV_SZOVEG } from '@/lib/cibFeliratok';

export type TesztFizetesFajta = 'stub' | 'cib_teszt' | null;

/** Modul-szintű gyorsítótár: oldalanként egyszer kérdezzük le. */
let gyorsitotar: TesztFizetesFajta | undefined;
let folyamatban: Promise<TesztFizetesFajta> | null = null;

function fajtaProfilbol(m: any): TesztFizetesFajta {
  const k = m?.payment_test_kind;
  if (k === 'stub' || k === 'cib_teszt') return k;
  if (k === null) return null;
  // Régi backend: csak a boolean jön — az a stub-üzem volt.
  return m?.payment_test_mode ? 'stub' : null;
}

async function tesztFajta(): Promise<TesztFizetesFajta> {
  if (gyorsitotar !== undefined) return gyorsitotar;
  if (!folyamatban) {
    folyamatban = api.getMyProfile()
      .then((m: any) => {
        gyorsitotar = fajtaProfilbol(m);
        return gyorsitotar;
      })
      // Hiba esetén NEM mutatunk sávot: a figyelmeztetés hiánya kevésbé
      // zavaró, mint egy téves riasztás minden hálózati hibánál.
      .catch(() => {
        folyamatban = null;
        return null;
      });
  }
  return folyamatban;
}

export default function TesztFizetesSav() {
  const [fajta, setFajta] = useState<TesztFizetesFajta>(null);

  useEffect(() => {
    let el = true;
    tesztFajta().then((v) => { if (el) setFajta(v); });
    return () => { el = false; };
  }, []);

  if (!fajta) return null;

  if (fajta === 'cib_teszt') {
    return (
      <div
        role="status"
        data-testid="teszt-fizetes-sav"
        data-fajta="cib_teszt"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '12px 14px',
          margin: '12px 0',
          borderRadius: 8,
          background: 'rgba(37,99,235,0.12)',
          border: '2px solid rgba(37,99,235,0.55)',
          color: 'var(--text)',
          fontSize: 14,
        }}
      >
        <FlaskConical size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <div><strong>{CIB_TESZT_SAV_SZOVEG}</strong></div>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="teszt-fizetes-sav"
      data-fajta="stub"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        margin: '12px 0',
        borderRadius: 8,
        background: 'rgba(217,119,6,0.14)',
        border: '2px solid rgba(217,119,6,0.55)',
        fontSize: 14,
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div>
        <strong>TESZT FIZETÉSI MÓD</strong>
        <div style={{ marginTop: 2 }}>
          Ez a fizetés <strong>nem valódi</strong>: nem terhelünk meg semmit, és
          nem keletkezik számla. A funkció tesztelés alatt áll.
        </div>
      </div>
    </div>
  );
}
