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
// =====================================================================
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/api';

/** Modul-szintű gyorsítótár: oldalanként egyszer kérdezzük le. */
let gyorsitotar: boolean | null = null;
let folyamatban: Promise<boolean> | null = null;

async function tesztUzemE(): Promise<boolean> {
  if (gyorsitotar !== null) return gyorsitotar;
  if (!folyamatban) {
    folyamatban = api.getMyProfile()
      .then((m: any) => {
        gyorsitotar = Boolean(m?.payment_test_mode);
        return gyorsitotar;
      })
      // Hiba esetén NEM mutatunk sávot: a figyelmeztetés hiánya kevésbé
      // zavaró, mint egy téves riasztás minden hálózati hibánál.
      .catch(() => false);
  }
  return folyamatban;
}

export default function TesztFizetesSav() {
  const [mutat, setMutat] = useState(false);

  useEffect(() => {
    let el = true;
    tesztUzemE().then((v) => { if (el) setMutat(v); });
    return () => { el = false; };
  }, []);

  if (!mutat) return null;

  return (
    <div
      role="status"
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
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
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
