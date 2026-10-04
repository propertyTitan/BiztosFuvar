'use client';

// =====================================================================
//  Admin — „Kártyás fizetések (CIB)" blokk (CIB PR-3)
//
//  - kereső TrID / ANUM / fuvar-azonosító szerint, állapot- és dátumszűrővel;
//  - táblázat (TrID, állapot, összeg, RC, ANUM, fuvar, időpontok);
//  - részletpanel: a session, a banki eredmény (a kötelező adatsorral), a
//    fizetési események és a BANKI ÜZENETNAPLÓ (irány, MSGT, HTTP, RC,
//    hibaosztály) — „Titkosított napló másolása a banknak" a banki
//    „Tranzakció kivizsgálás kérés" levélhez (a napló titkosított szöveget
//    tartalmaz, kártyaadatot nem);
//  - „Újraellenőrzés": a következő banki lekérdezés előrehozása;
//  - KÉTES LEZÁRÁS (close_unknown): a két döntés ConfirmDialog mögött — a
//    „Lezárva" ANUM-ot (1–6 alfanumerikus) és indoklást követel, a bank
//    szöveges eredménye (RT) opcionális (C6: üresen a backend alapértéke,
//    „Tranzakció elfogadva"; ≤255 karakter); a „Nem lezárva" indoklást
//    (10–2000 karakter) — mindkettő a bankkal egyeztetve. A „Nem lezárva"
//    kimenete „nem terhelt" (C5), a feladó újra fizethet.
//  - KÉZI MŰVELETEK (2026-10-04, W2 — a backend PR-5-ös kezi-rendezes
//    végpontja, konfig NÉLKÜL is): könyvelés (függő closed_ok), lejáratás
//    (függő, nem végső, a zárási határidő után), visszatérítés (könyvelési
//    árva) — csak abban az állapotban kínálva, ahol a backend engedi
//    (lib/cibAdmin.ts: keziMuveletek), ConfirmDialog mögött, indoklással és
//    opcionális banki hivatkozással. Bankot egyik sem hív, MSGT32 nem megy ki.
//  - A lista állapot-szűrője a nyers szótárat küldi (lib/cibAdmin.ts:
//    ALLAPOT_SZURO; minden értékét a backend őre, a cib-pr5-b2-utak méri).
//
//  Ha a végpont nem érhető el (a CIB-integráció nincs bekapcsolva, vagy a
//  backend még nem tartalmazza), a blokk ezt csendes jelzéssel mondja — az
//  admin-felület többi része ettől nem törik.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, CreditCard, RefreshCw, Search, X } from 'lucide-react';
import { api, type AdminCibReszlet, type AdminCibSor } from '@/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import BankiTranzakcioAdatok from '@/components/BankiTranzakcioAdatok';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { useToast } from '@/components/ToastProvider';
import { KERESKEDO } from '@/lib/kereskedo';
import { visszateritett } from '@/lib/cibFizetes';
import {
  ALLAPOT_SZURO, RT_MAX, adminMuveletHiba, allapotValtozott, bankiHivatkozasHiba, indoklasHiba, keziMuveletek, rtHiba,
  type KeziMuvelet,
} from '@/lib/cibAdmin';

const ALLAPOT_NEV: Record<string, string> = {
  feldolgozas: 'Feldolgozás alatt',
  sikeres: 'Sikeres',
  sikertelen: 'Sikertelen',
  nem_terhelt: 'Nem terhelt',
  mar_fizetve: 'Már fizetve',
  ellenorzes: 'Egyeztetésre vár',
  visszateritve: 'Visszatérítve',
};

const ALLAPOT_SZIN: Record<string, string> = {
  sikeres: 'rgba(22,163,74,0.16)',
  sikertelen: 'rgba(220,38,38,0.14)',
  ellenorzes: 'rgba(217,119,6,0.18)',
  feldolgozas: 'rgba(37,99,235,0.14)',
  nem_terhelt: 'rgba(100,116,139,0.18)',
  mar_fizetve: 'rgba(100,116,139,0.18)',
  visszateritve: 'rgba(100,116,139,0.18)',
};

/**
 * A sor kijelzett állapota. 2026-10-04 (a PR-5 web 2. javítóköre): a
 * backend a visszatérített kísérletet (a bank terhelt, RC=00) „nem_terhelt"-
 * ként adja — az admin-listán ez „Nem terhelt" volt, ami az adminnak is hamis.
 */
function kijelzettAllapot(s: { allapot: string; rc?: string | null; ok?: string | null }): string {
  return visszateritett(s) ? 'visszateritve' : s.allapot;
}

const OLDALMERET = 25;
const ANUM_MINTA = /^[A-Za-z0-9]{1,6}$/;
/** A bank RC=00-hoz tartozó szöveges eredménye — az RT mező alapértéke (C6, a backendé is). */
export const RT_ALAP_RC00 = 'Tranzakció elfogadva';

/** A kézi műveletek gombja és megerősítő dialógusa (W2, 2026-10-04). */
const KEZI: Record<KeziMuvelet, { gomb: string; cim: string; uzenet: string; hivatkozas: string; danger: boolean }> = {
  konyveles: {
    gomb: 'Könyvelés (banki hívás nélkül)',
    cim: 'Könyvelés',
    uzenet: 'A bank ezt a tranzakciót lezárta (closed_ok), de a könyvelés nem futott le. A díjat a tárolt banki '
      + 'adatsorral fizetettként könyveljük: a feladó megkapja a szállító elérhetőségét, a díj-visszaigazolást és a '
      + 'számlát. Ha a fuvar közben már nem fizethető, a tétel felülvizsgálandó lesz (könyvelési árva). Bankot nem '
      + 'hívunk, zárási kérés (MSGT32) nem megy ki.',
    hivatkozas: 'Banki hivatkozás (opcionális)',
    danger: false,
  },
  lejaratas: {
    gomb: 'Lejáratás (a zárási határidő után)',
    cim: 'Lejáratás',
    uzenet: 'Csak a zárási határidő (alapból a MSGT10 után 9 perc 30 mp) lejárta után rögzíthető. Ha zárási kérés '
      + '(MSGT32) nem ment ki, a kísérlet lejárt lesz: a bank a zárolást feloldja, terhelés nincs. Ha kiment, a tétel '
      + 'kétes lesz — azt a bankkal egyeztetve, „Lezárva" vagy „Nem lezárva" döntéssel rendezd. Bankot nem hívunk.',
    hivatkozas: 'Banki hivatkozás (opcionális)',
    danger: true,
  },
  visszaterites: {
    gomb: 'Visszatérítve (a banki visszautalás után)',
    cim: 'Visszatérítés rögzítése',
    uzenet: 'Csak akkor rögzítsd, ha a díjat a banknál ténylegesen visszatérítetted: a bank terhelt, de az ügylet már '
      + 'nem volt fizethető (könyvelési árva). A tételt lezárjuk, a feladó „A díjat visszatérítettük" értesítést és '
      + 'levelet kap.',
    hivatkozas: 'Banki hivatkozás (a visszatérítés azonosítója, ajánlott)',
    danger: true,
  },
};

function ido(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleString('hu-HU');
}

function Pill({ allapot }: { allapot: string }) {
  return (
    <span
      className="pill"
      style={{ background: ALLAPOT_SZIN[allapot] || 'rgba(100,116,139,0.18)', color: 'var(--text)', fontWeight: 700, fontSize: 11 }}
    >
      {ALLAPOT_NEV[allapot] || allapot}
    </span>
  );
}

/** A CIB e-kereskedelmi ügyfélszolgálata (Fejlesztői útmutató, „Support"). */
export const CIB_KIVIZSGALAS_EMAIL = 'ecommerce@cib.hu';

/**
 * A boltazonosító (PID): a session mezőjéből, vagy a titkosított üzenetek
 * NYÍLT részéből (`PID=…&CRYPTO=1&DATA=…`). Ha egyik sincs, helyőrző.
 */
function boltazonosito(r: AdminCibReszlet): string {
  const sajat = r.session?.pid;
  if (typeof sajat === 'string' && /^[A-Za-z0-9]{1,20}$/.test(sajat)) return sajat;
  for (const m of r.messages) {
    const talalat = /(?:^|[?&])PID=([A-Za-z0-9]{1,20})(?:&|$)/.exec(m.raw ?? '');
    if (talalat) return talalat[1];
  }
  return '[boltazonosító]';
}

/**
 * A banknak küldhető kivizsgálási levél (a Fejlesztői útmutató „Support"
 * pontja szerint): címzett, a tárgyban a boltazonosító, a tranzakció
 * azonosítója és ideje, a probléma leírásának helye (ezt az admin tölti ki),
 * és a küldött/fogadott titkosított üzenetek időpecséttel.
 *
 * 2026-10-03 (CIB PR-5/B): a „kereskedői szerver IP-címe" mezőt nem kérjük
 * kitölteni — a kimenő IP a felhőszolgáltatónál (Railway) változik, egy
 * utólag beírt pillanatnyi cím téves is lehet. A bank a tranzakciót a TrID,
 * a PID és az időpecsétek alapján azonosítja (IP-regisztráció nem kell).
 */
export function bankiNaploSzoveg(trid: string, r: AdminCibReszlet): string {
  const pid = boltazonosito(r);
  const kezdete = r.session?.created_at ?? r.messages[0]?.created_at ?? null;
  const sorok = [
    `Címzett: ${CIB_KIVIZSGALAS_EMAIL}`,
    `Tárgy: Tranzakció kivizsgálás kérés ${pid}`,
    '',
    `A problémás tranzakció azonosítója (TrID): ${trid}`,
    `Boltazonosító (PID): ${pid}`,
    `A tranzakció indítása (MSGT10, a kereskedő órája szerint): ${kezdete ?? '[ld. az üzenetnaplót]'}`,
    'A probléma leírása: [kitöltendő]',
    'A kereskedői szerver kimenő IP-címe: felhőszolgáltatónál futó, változó cím (nem rögzített) — '
      + 'a tranzakció a TrID, a PID és az alábbi időpecsétek alapján azonosítható.',
    'Képernyőkép: [ha van, csatold]',
    `Kereskedő: ${KERESKEDO.teljesNev} (${KERESKEDO.rovidNev}), adószám: ${KERESKEDO.adoszam}`,
    r.session?.job_id ? `Belső hivatkozás (fuvar): ${r.session.job_id}` : null,
    '',
    'A küldött/fogadott titkosított üzenetek (időpecséttel):',
    '',
    ...r.messages.flatMap((m) => [
      `[${m.created_at}] ${m.direction} MSGT${m.msgt ?? '?'} ${m.endpoint ?? ''} HTTP ${m.http_status ?? '–'} RC ${m.rc ?? '–'}${m.error_class ? ` (${m.error_class})` : ''}`,
      m.raw ?? '(nincs nyers üzenet)',
      '',
    ]),
  ];
  return sorok.filter((x) => x !== null).join('\n');
}

export default function CibFizetesekAdmin() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [allapot, setAllapot] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [lista, setLista] = useState<{ items: AdminCibSor[]; total: number } | null>(null);
  const [elerheto, setElerheto] = useState(true);
  const [betolt, setBetolt] = useState(false);
  const [egyeztetesreVar, setEgyeztetesreVar] = useState<number | null>(null);
  const [reszlet, setReszlet] = useState<{ trid: string; adat: AdminCibReszlet } | null>(null);
  const [reszletBetolt, setReszletBetolt] = useState<string | null>(null);
  const [dontes, setDontes] = useState<'lezarva' | 'nem_lezarva' | null>(null);
  const [keziDontes, setKeziDontes] = useState<KeziMuvelet | null>(null);
  const [muvelet, setMuvelet] = useState(false);
  // Szinkron őr a dupla kattintás ellen (a state csak a következő renderben
  // látszik; a backend a close_unknown+pending feltétellel amúgy is véd).
  const folyamatban = useRef(false);

  const betoltLista = useCallback(async (p: { q: string; allapot: string; from: string; to: string; offset: number }) => {
    setBetolt(true);
    try {
      const r = await api.adminCibKereses({ ...p, limit: OLDALMERET });
      setLista({ items: Array.isArray(r?.items) ? r.items : [], total: Number(r?.total) || 0 });
      setElerheto(true);
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 404 || st === 503) setElerheto(false);
      else toast.error('A kártyás fizetések nem tölthetők be', 'Próbáld újra pár perc múlva.');
      setLista({ items: [], total: 0 });
    } finally {
      setBetolt(false);
    }
  }, [toast]);

  useEffect(() => {
    betoltLista({ q: '', allapot: '', from: '', to: '', offset: 0 });
    api.adminCibKereses({ allapot: 'ellenorzes', limit: 1, offset: 0 })
      .then((r) => setEgyeztetesreVar(Number(r?.total) || 0))
      .catch(() => setEgyeztetesreVar(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function keres(ujOffset = 0) {
    setOffset(ujOffset);
    betoltLista({ q, allapot, from, to, offset: ujOffset });
  }

  async function nyit(trid: string) {
    setReszletBetolt(trid);
    try {
      const adat = await api.adminCibReszlet(trid);
      setReszlet({ trid, adat: { ...adat, messages: Array.isArray(adat?.messages) ? adat.messages : [], events: Array.isArray(adat?.events) ? adat.events : [] } });
    } catch {
      toast.error('A részletek nem tölthetők be', 'Próbáld újra.');
    } finally {
      setReszletBetolt(null);
    }
  }

  async function masol() {
    if (!reszlet) return;
    try {
      await navigator.clipboard.writeText(bankiNaploSzoveg(reszlet.trid, reszlet.adat));
      toast.success('Vágólapra másolva', 'A titkosított napló beilleszthető a banknak szóló levélbe.');
    } catch {
      toast.error('A másolás nem sikerült', 'A böngésző nem engedte a vágólap használatát.');
    }
  }

  async function ujraellenoriz() {
    if (!reszlet) return;
    setMuvelet(true);
    try {
      // 2026-10-03 (CIB PR-5/B): a backend mondja meg, mi történik (azonnal
      // fut, vagy legkorábban mikor) — a kétes tételen a következő lépés egy
      // késleltetett, csak-olvasó egyeztetés, nem „a lehető leghamarabb".
      const v = await api.adminCibUjraellenorzes(reszlet.trid).catch((e: unknown) => {
        // 409 CIB_NO_AUTOMATIC_STEP: felülvizsgálandó vagy végállapotú tétel —
        // nincs újrafuttatható lépés, a „próbáld újra" itt félrevezetne.
        if ((e as { code?: string } | null)?.code === 'CIB_NO_AUTOMATIC_STEP') return null;
        throw e;
      });
      if (!v) {
        toast.info('Nincs automatikus banki lépés',
          'Ennél a tételnél a rendszer magától nem kérdez újra a banktól. A felülvizsgálandó tételt a bankkal '
          + 'egyeztetve a kézi rendezés zárja le; a végállapotú tételnél nincs teendő.');
        await nyit(reszlet.trid);
        return;
      }
      toast.success(v?.azonnal ? 'Újraellenőrzés elindítva' : 'Újraellenőrzés ütemezve',
        v?.uzenet || 'A következő banki lekérdezés a lehető leghamarabb lefut.');
      await nyit(reszlet.trid);
    } catch (e) {
      // W2: hiányos CIB-konfignál (CIB_UNAVAILABLE) a kézi műveletekre utalunk.
      const u = adminMuveletHiba(e, { cim: 'Az újraellenőrzés nem indult el', szoveg: 'Próbáld újra pár perc múlva.' });
      toast.error(u.cim, u.szoveg);
    } finally {
      setMuvelet(false);
    }
  }

  async function rendez(v: Record<string, string>) {
    if (!reszlet || !dontes || folyamatban.current) return;
    const indoklas = (v.indoklas || '').trim();
    const indHiba = indoklasHiba(indoklas);
    if (indHiba) {
      toast.error('Hibás indoklás', indHiba);
      return;
    }
    let body: { eredmeny: 'lezarva' | 'nem_lezarva'; indoklas: string; anum?: string; rt?: string };
    if (dontes === 'lezarva') {
      const anum = (v.anum || '').trim();
      if (!ANUM_MINTA.test(anum)) {
        toast.error('Hibás engedélyszám', 'Az ANUM 1–6 betű vagy számjegy (a bank által adott engedélyszám).');
        return;
      }
      // C6: az RT a bank kötelező adatsorának része. Opcionális — üresen a
      // backend a bank RC=00-hoz tartozó szövegét („Tranzakció elfogadva")
      // írja; megadva legfeljebb 255 karakter, vezérlőkarakter nélkül.
      const rt = (v.rt || '').trim();
      const rHiba = rtHiba(rt);
      if (rHiba) {
        toast.error('Hibás banki szöveg (RT)', rHiba);
        return;
      }
      body = rt ? { eredmeny: 'lezarva', anum, rt, indoklas } : { eredmeny: 'lezarva', anum, indoklas };
    } else {
      body = { eredmeny: 'nem_lezarva', indoklas };
    }
    folyamatban.current = true;
    setMuvelet(true);
    try {
      await api.adminCibRendezes(reszlet.trid, body);
      // C5: a „nem lezárva" kimenete „nem terhelt" (nem „sikertelen").
      toast.success('Döntés rögzítve', dontes === 'lezarva'
        ? 'A fizetést lezártként könyveljük.'
        : 'A kísérletet „nem terhelt"-ként zártuk; a feladó értesítést kap, és újra fizethet.');
      setDontes(null);
      await nyit(reszlet.trid);
      keres(offset);
    } catch (e) {
      const u = adminMuveletHiba(e, { cim: 'A döntés nem rögzült', szoveg: 'Frissítsd a részleteket, és próbáld újra.' });
      toast.error(u.cim, u.szoveg);
      if (allapotValtozott(e)) {
        setDontes(null);
        await nyit(reszlet.trid);
      }
    } finally {
      folyamatban.current = false;
      setMuvelet(false);
    }
  }

  /** A konfig nélkül is elérhető kézi műveletek (W2, 2026-10-04). */
  async function keziRendez(v: Record<string, string>) {
    if (!reszlet || !keziDontes || folyamatban.current) return;
    const muv = keziDontes;
    const indoklas = (v.indoklas || '').trim();
    const indHiba = indoklasHiba(indoklas);
    if (indHiba) {
      toast.error('Hibás indoklás', indHiba);
      return;
    }
    const hivatkozas = (v.banki_hivatkozas || '').trim();
    const hHiba = bankiHivatkozasHiba(hivatkozas);
    if (hHiba) {
      toast.error('Hibás banki hivatkozás', hHiba);
      return;
    }
    folyamatban.current = true;
    setMuvelet(true);
    try {
      const r = await api.adminCibKeziRendezes(reszlet.trid, hivatkozas
        ? { muvelet: muv, indoklas, banki_hivatkozas: hivatkozas }
        : { muvelet: muv, indoklas });
      const allapot = r?.allapot;
      if (muv === 'konyveles' && allapot === 'ellenorzes') {
        toast.info('Könyvelési árva', 'A fuvar közben már nem fizethető — a díjat a banknál vissza kell téríteni, majd a „Visszatérítve" művelettel lezárni.');
      } else if (muv === 'konyveles' && allapot === 'sikeres') {
        toast.success('Könyvelve', 'A díjat a banki adatsorral fizetettként könyveltük; a feladó megkapta a szállító elérhetőségét.');
      } else if (muv === 'konyveles') {
        toast.success('Könyvelés elindítva', 'A könyvelés még fut — frissítsd a részleteket pár másodperc múlva.');
      } else if (muv === 'lejaratas' && allapot === 'ellenorzes') {
        toast.info('Kétesként rögzítve', 'A zárási kérés (MSGT32) kiment — egyeztess a bankkal, és rendezd „Lezárva" vagy „Nem lezárva" döntéssel.');
      } else if (muv === 'lejaratas') {
        toast.success('Lejáratva', 'A kísérletet lejártként zártuk: zárási kérés nem ment ki, a bank nem terhelhetett.');
      } else {
        toast.success('Visszatérítés rögzítve', 'A tételt lezártuk; a feladó értesítést kap a visszatérítésről.');
      }
      setKeziDontes(null);
      await nyit(reszlet.trid);
      keres(offset);
    } catch (e) {
      const u = adminMuveletHiba(e);
      toast.error(u.cim, u.szoveg);
      if (allapotValtozott(e)) {
        setKeziDontes(null);
        await nyit(reszlet.trid);
      }
    } finally {
      folyamatban.current = false;
      setMuvelet(false);
    }
  }

  const kettes = reszlet?.adat.session?.cib_state === 'close_unknown'
    && (reszlet.adat.session?.state ?? 'pending') === 'pending';
  const keziLehetosegek = keziMuveletek(reszlet?.adat.session);

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CreditCard size={20} aria-hidden /> Kártyás fizetések (CIB)
        {egyeztetesreVar != null && egyeztetesreVar > 0 && (
          <span className="pill" style={{ background: 'rgba(217,119,6,0.18)', color: 'var(--text)', fontSize: 12 }}>
            Egyeztetésre vár: {egyeztetesreVar}
          </span>
        )}
      </h2>

      {!elerheto ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            A kártyás fizetési napló most nem érhető el (a CIB-integráció nincs bekapcsolva ezen a szerveren).
          </p>
        </div>
      ) : (
        <>
          <form
            className="card"
            onSubmit={(e) => { e.preventDefault(); keres(0); }}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <label htmlFor="cib-kereso" style={{ fontSize: 12, display: 'block' }}>TrID, ANUM vagy fuvar-azonosító</label>
              <input id="cib-kereso" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="pl. 1234567812345678" />
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <label htmlFor="cib-allapot" style={{ fontSize: 12, display: 'block' }}>Állapot</label>
              <select id="cib-allapot" className="input" value={allapot} onChange={(e) => setAllapot(e.target.value)}>
                <option value="">Mind</option>
                {/* A nyers szótár (W2, lib/cibAdmin.ts) — a „Nem terhelt"
                    szűrő a „Visszatérítve" pillű tételeket is adná. */}
                {ALLAPOT_SZURO.map((o) => <option key={o.ertek} value={o.ertek}>{o.nev}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 150px' }}>
              <label htmlFor="cib-ettol" style={{ fontSize: 12, display: 'block' }}>Ettől</label>
              <input id="cib-ettol" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 150px' }}>
              <label htmlFor="cib-eddig" style={{ fontSize: 12, display: 'block' }}>Eddig</label>
              <input id="cib-eddig" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button type="submit" className="btn" disabled={betolt}>
              <Search size={14} style={{ verticalAlign: -2 }} aria-hidden /> Keresés
            </button>
          </form>

          {lista === null ? (
            <ListSkeleton rows={3} />
          ) : lista.items.length === 0 ? (
            <EmptyState
              compact
              icon={<CreditCard size={24} />}
              title="Nincs találat"
              description="Még nincs kártyás fizetési kísérlet, vagy a szűrő nem talált ilyet."
            />
          ) : (
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['TrID', 'Állapot', 'Összeg', 'RC', 'ANUM', 'Fuvar', 'Indult', 'Lezárva', ''].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lista.items.map((s) => (
                    <tr key={s.trid}>
                      <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{s.trid}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <Pill allapot={kijelzettAllapot(s)} />
                        {s.cib_state && <div className="muted" style={{ fontSize: 11 }}>{s.cib_state}</div>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{s.amount_huf != null ? `${s.amount_huf} HUF` : '–'}</td>
                      <td style={{ padding: '8px 10px' }}>{s.rc || '–'}</td>
                      <td style={{ padding: '8px 10px' }}>{s.anum || '–'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {s.job_id ? <Link href={`/dashboard/fuvar/${s.job_id}`}>{s.job_id.slice(0, 8)}…</Link> : '–'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{ido(s.created_at)}</td>
                      <td style={{ padding: '8px 10px' }}>{ido(s.closed_at)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          aria-label={`Részletek: ${s.trid}`}
                          disabled={reszletBetolt === s.trid}
                          onClick={() => nyit(s.trid)}
                        >
                          Részletek
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', fontSize: 12 }}>
                <span className="muted">Összesen: {lista.total}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                    disabled={offset === 0 || betolt} onClick={() => keres(Math.max(0, offset - OLDALMERET))}>Újabbak</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                    disabled={offset + OLDALMERET >= lista.total || betolt} onClick={() => keres(offset + OLDALMERET)}>Régebbiek</button>
                </span>
              </div>
            </div>
          )}

          {reszlet && (
            <div className="card" data-testid="cib-reszlet" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>TrID {reszlet.trid}</h3>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px' }}
                  aria-label="Részletek bezárása" onClick={() => setReszlet(null)}>
                  <X size={14} aria-hidden />
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>
                CIB-állapot: <strong>{String(reszlet.adat.session?.cib_state ?? '–')}</strong>
                {' · '}Munkamenet: <strong>{String(reszlet.adat.session?.state ?? '–')}</strong>
                {reszlet.adat.session?.job_id && (
                  <>{' · '}<Link href={`/dashboard/fuvar/${reszlet.adat.session.job_id}`}>fuvar megnyitása</Link></>
                )}
              </p>

              <BankiTranzakcioAdatok adatok={{ ...(reszlet.adat.result || {}), trid: reszlet.trid }} />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {/* A .btn alapból nowrap — 390 px-en ez a hosszú felirat kilógna. */}
                <button type="button" className="btn btn-secondary" onClick={masol} style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                  <Copy size={14} style={{ verticalAlign: -2, flexShrink: 0 }} aria-hidden /> Titkosított napló másolása a banknak
                </button>
                <button type="button" className="btn btn-secondary" onClick={ujraellenoriz} disabled={muvelet}>
                  <RefreshCw size={14} style={{ verticalAlign: -2 }} aria-hidden /> Újraellenőrzés
                </button>
                {kettes && (
                  <>
                    <button type="button" className="btn" onClick={() => setDontes('lezarva')} disabled={muvelet}>
                      Lezárva (ANUM + indoklás)
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => setDontes('nem_lezarva')} disabled={muvelet}>
                      Nem lezárva (indoklás)
                    </button>
                  </>
                )}
                {keziLehetosegek.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={KEZI[k].danger ? 'btn btn-danger' : 'btn'}
                    style={{ whiteSpace: 'normal', textAlign: 'left' }}
                    onClick={() => setKeziDontes(k)}
                    disabled={muvelet}
                  >
                    {KEZI[k].gomb}
                  </button>
                ))}
              </div>
              {keziLehetosegek.length > 0 && (
                <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                  Kézi művelet — a CIB-konfiguráció nélkül is elérhető; bankot nem hív, zárási kérést (MSGT32) nem küld.
                </p>
              )}

              {reszlet.adat.events.length > 0 && (
                <>
                  <h4 style={{ margin: '16px 0 6px', fontSize: 14 }}>Fizetési események</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {reszlet.adat.events.map((ev, i) => (
                      <li key={i}>{ido(ev.created_at)} — {String(ev.event_type ?? '')} {String(ev.status ?? '')}</li>
                    ))}
                  </ul>
                </>
              )}

              <h4 style={{ margin: '16px 0 6px', fontSize: 14 }}>Banki üzenetnapló</h4>
              {reszlet.adat.messages.length === 0 ? (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Nincs naplózott banki üzenet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left' }}>
                        {['Idő', 'Irány', 'Üzenet', 'Végpont', 'HTTP', 'RC', 'Hibaosztály'].map((h) => (
                          <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reszlet.adat.messages.map((m, i) => (
                        <tr key={i}>
                          <td style={{ padding: '6px 8px' }}>{ido(m.created_at)}</td>
                          <td style={{ padding: '6px 8px' }}>{m.direction}</td>
                          <td style={{ padding: '6px 8px' }}>{m.msgt ? `MSGT${m.msgt}` : '–'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.endpoint || '–'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.http_status ?? '–'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.rc || '–'}</td>
                          <td style={{ padding: '6px 8px' }}>{m.error_class || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={dontes !== null}
        title={dontes === 'lezarva' ? `Kétes lezárás rendezése — lezárva (${reszlet?.trid ?? ''})` : `Kétes lezárás rendezése — nem lezárva (${reszlet?.trid ?? ''})`}
        message={dontes === 'lezarva'
          ? 'Csak akkor rögzítsd, ha a bank írásban megerősítette, hogy a tranzakció lezárult. A díjat fizetettként könyveljük, a feladó megkapja a szállító elérhetőségét.'
          : 'Csak akkor rögzítsd, ha a bank megerősítette, hogy a tranzakció NEM zárult le (nem terheltünk). A feladó „nem terheltünk" értesítést kap, és újra fizethet.'}
        confirmLabel="Rögzítés"
        danger={dontes === 'nem_lezarva'}
        fields={dontes === 'lezarva'
          ? [
            { key: 'anum', label: 'ANUM (a bank engedélyszáma, 1–6 karakter)', type: 'text', required: true, placeholder: 'pl. AB1234' },
            {
              key: 'rt',
              label: `RT (a bank szöveges eredménye, a vásárló is látja; legfeljebb ${RT_MAX} karakter — üresen: „${RT_ALAP_RC00}")`,
              type: 'text',
              placeholder: RT_ALAP_RC00,
            },
            { key: 'indoklas', label: 'Indoklás (legalább 10 karakter)', type: 'textarea', required: true, placeholder: 'pl. A CIB e-mailben megerősítette a lezárást (dátum, ügyintéző).' },
          ]
          : [
            { key: 'indoklas', label: 'Indoklás (legalább 10 karakter)', type: 'textarea', required: true, placeholder: 'pl. A CIB szerint a MSGT32 nem érkezett be, a tétel reverzálva.' },
          ]}
        initialValues={dontes === 'lezarva' ? { rt: RT_ALAP_RC00 } : undefined}
        onConfirm={(v) => { rendez(v); }}
        onClose={() => setDontes(null)}
      />

      <ConfirmDialog
        open={keziDontes !== null}
        title={keziDontes ? `${KEZI[keziDontes].cim} (${reszlet?.trid ?? ''})` : ''}
        message={keziDontes ? KEZI[keziDontes].uzenet : undefined}
        confirmLabel="Rögzítés"
        danger={keziDontes ? KEZI[keziDontes].danger : false}
        fields={keziDontes
          ? [
            { key: 'indoklas', label: 'Indoklás (legalább 10 karakter)', type: 'textarea', required: true, placeholder: 'pl. A CIB-konfiguráció hiányzott; a bank naplója szerint (dátum, ügyintéző)…' },
            { key: 'banki_hivatkozas', label: KEZI[keziDontes].hivatkozas, type: 'text', placeholder: 'pl. CIB-2026/10-123' },
          ]
          : []}
        onConfirm={(v) => { keziRendez(v); }}
        onClose={() => setKeziDontes(null)}
      />
    </section>
  );
}
