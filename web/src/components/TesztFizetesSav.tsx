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
//
//  FIÓKHOZ KÖTÖTT GYORSÍTÓTÁR (2026-10-03, CIB PR-5 — lelet 28): a fajta
//  felhasználónként más (a CIB-teszt az allowlistes fiókoké), a modul-szintű
//  gyorsítótár viszont fiókváltáskor (SPA, újratöltés nélkül) az ELŐZŐ fiók
//  sávját mutatta. A kulcs mostantól a bejelentkezett fiók azonosítója.
// =====================================================================
import { useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { CIB_TESZT_SAV_SZOVEG } from '@/lib/cibFeliratok';

export type TesztFizetesFajta = 'stub' | 'cib_teszt' | null;

/** Fiókonkénti gyorsítótár: fiókonként és oldalbetöltésenként egyszer kérdezzük le. */
const gyorsitotar = new Map<string, TesztFizetesFajta>();
const folyamatban = new Map<string, Promise<TesztFizetesFajta>>();

function fajtaProfilbol(m: any): TesztFizetesFajta {
  const k = m?.payment_test_kind;
  if (k === 'stub' || k === 'cib_teszt') return k;
  if (k === null) return null;
  // Régi backend: csak a boolean jön — az a stub-üzem volt.
  return m?.payment_test_mode ? 'stub' : null;
}

async function tesztFajta(fiok: string): Promise<TesztFizetesFajta> {
  if (gyorsitotar.has(fiok)) return gyorsitotar.get(fiok) ?? null;
  let igeret = folyamatban.get(fiok);
  if (!igeret) {
    igeret = api.getMyProfile()
      .then((m: any) => {
        const fajta = fajtaProfilbol(m);
        gyorsitotar.set(fiok, fajta);
        folyamatban.delete(fiok);
        return fajta;
      })
      // Hiba esetén NEM mutatunk sávot: a figyelmeztetés hiánya kevésbé
      // zavaró, mint egy téves riasztás minden hálózati hibánál.
      .catch(() => {
        folyamatban.delete(fiok);
        return null;
      });
    folyamatban.set(fiok, igeret);
  }
  return igeret;
}

export default function TesztFizetesSav() {
  const user = useCurrentUser();
  const fiok = user?.id ?? null;
  // A fajta azzal a fiókkal együtt tárolva, amelyikhez lekértük: egy
  // fiókváltás utáni renderben sem látszhat a másik fiók sávja.
  const [eredmeny, setEredmeny] = useState<{ fiok: string; fajta: TesztFizetesFajta } | null>(null);

  useEffect(() => {
    if (!fiok) return;
    let el = true;
    tesztFajta(fiok).then((v) => { if (el) setEredmeny({ fiok, fajta: v }); });
    return () => { el = false; };
  }, [fiok]);

  const fajta = eredmeny && eredmeny.fiok === fiok ? eredmeny.fajta : null;
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
