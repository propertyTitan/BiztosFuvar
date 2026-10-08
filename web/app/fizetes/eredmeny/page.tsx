'use client';

// =====================================================================
//  /fizetes/eredmeny — a CIB-es kártyás fizetés eredménye (CIB PR-3)
//
//  A bank a böngészőt az API-ra küldi vissza (GET /payments/cib/vissza),
//  az pedig ide, egy aláírt, 24 órás tokennel: `?e=<token>`. Hibás vagy
//  hamisított visszatérésnél `?hiba=azonositas`, elhasznált/ismeretlen
//  átirányító linknél `?hiba=link`.
//
//  ⚠️ BELÉPÉS NÉLKÜL IS MŰKÖDIK: a visszatérés gyakran MÁS böngészőben nyílik
//  (kezdőképernyőre tett GoFuvar → Safari, Facebook/Gmail beépített
//  böngésző), ahol nincs munkamenet — a bank által kötelezővé tett adatsort
//  (TrID, RC, RT, AMO, ANUM) ott is meg kell mutatni. Az újrapróba belépést
//  kér (a fizetést csak a fuvar feladója indíthatja).
//
//  LEKÉRDEZÉS: 3 mp-enként 3 percig, utána 20 mp-enként; végleges állapotban
//  leáll (az egyeztetés alatti „ellenőrzés" nem az: ott 20 mp-enként figyel,
//  mert a backend az egyeztetést magától is lezárja — W2, 2026-10-04), és 30
//  perc után is (a token 24 órás — egy nyitva hagyott fül ne
//  kérdezzen addig; utána „Frissítés" gomb). Tartós, nem 404-es hibánál
//  (5xx, 429, hálózat) három próba után kiírjuk, hogy most nem érjük el, és
//  kiutat adunk — a háttérben tovább próbálkozunk. Bejelentkezve a
//  socket-események (`cib:eredmeny`, `job:paid`) azonnali újrakérdezést
//  váltanak ki. A lekérdezés csak a DB-t olvassa; a banki lekérdezés ütemét
//  a backend fékezi. ⚠️ A 3 mp-es ütem ~20 kérés/perc/IP — a backend
//  IP-limitjének ezt el kell bírnia.
//
//  „Vissza a fuvarhoz" gomb MINDIG van: a böngésző Vissza gombja a bank
//  oldalára vinne (amit a bank biztonsági okból elutasít — a valódi banknál
//  mérve: ERR_CACHE_MISS). Kijelentkezve a fuvar-linkek a belépésen át
//  (`?next=`) visznek a fuvarhoz. 2026-10-03 (CIB PR-5): ahol nincs más
//  teendő, ez az ELSŐDLEGES gomb, és mellette elmondjuk, miért ezt használja
//  — a böngésző előzményeit szándékosan nem írjuk át.
//
//  2026-10-03 (CIB PR-5) továbbá: 429-re a szerver kérte ideig várunk
//  (lelet 11); a „nem terhelt" kimenet oka saját szöveget kap (C5, lelet 9);
//  a banki adatsor felirata minden kimenetnél szó szerint a banki, a nem
//  sikeres kimenetet külön mondat mondja (a PR-5 web 1. javítóköre — az AMO
//  feliratának átírása a bank előírását sértette); újrapróba nélkül is
//  megmondjuk, miért nincs (lelet 25c); a CIB tesztkörnyezete jelölve
//  (lelet 28, C1).
//
//  2026-10-04 (a PR-5 web 2. javítóköre, BLOKKOLÓ): a visszatérített
//  kísérlet (a bank terhelt, a díjat visszautaltuk) saját kimenetet kap —
//  eddig „A fizetést nem véglegesítettük / Nem terheltük a kártyádat" állt
//  rajta, a banki adatsor RC=00-ja mellett.
// =====================================================================
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, CircleCheck, FlaskConical, Hourglass, RefreshCw, RotateCcw, ShieldAlert, WifiOff, XCircle } from 'lucide-react';
import { api, type CibEredmeny } from '@/api';
import { Loading } from '@/components/StateView';
import BankiTranzakcioAdatok from '@/components/BankiTranzakcioAdatok';
import DijFizetesKartya from '@/components/DijFizetesKartya';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import { CIB_FELIRATOK, CIB_TESZT_SAV_SZOVEG } from '@/lib/cibFeliratok';
import { BANKI_TOVABBI_INFO, ugyfelUzenet } from '@/lib/cibRcCsoport';
import { publikusKonfig } from '@/lib/publikusKonfig';
import {
  ELERHETETLEN_HIBASZAM, GYORS_SZAKASZ_MS, kovetkezoLekeresMs, lekerdezesFolytathato, lekerdezesUtem,
  nemTerheltMagyarazat, varakozasHibaUtan, visszateritesMagyarazat, visszateritett,
} from '@/lib/cibFizetes';

type Nezet =
  | { fajta: 'betoltes' }
  | { fajta: 'eredmeny'; e: CibEredmeny }
  | { fajta: 'lejart' };

const KARTYA = { marginTop: 16 } as const;

/**
 * A fuvar oldala. Kijelentkezve a belépésen át (`?next=`) visz oda: a
 * fuvaroldal 401-e különben cél nélkül dobná a belépésre. A `horgony` a
 * lapon belüli cél (UX Q06: `elerhetoseg` — a szállító elérhetősége).
 */
function fuvarUt(jobId: string | null | undefined, bejelentkezve: boolean, horgony?: string): string {
  if (!jobId) return '/fuvarjaim';
  const ut = `/dashboard/fuvar/${jobId}${horgony ? `#${horgony}` : ''}`;
  return bejelentkezve ? ut : `/bejelentkezes?next=${encodeURIComponent(ut)}`;
}

function VisszaGomb({ jobId, bejelentkezve, elsodleges = false }: {
  jobId: string | null | undefined; bejelentkezve: boolean; elsodleges?: boolean;
}) {
  return (
    <>
      <div>
        <Link href={fuvarUt(jobId, bejelentkezve)} className={elsodleges ? 'btn' : 'btn btn-secondary'} style={{ marginTop: 12 }}>
          Vissza a fuvarhoz
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        A fuvarodhoz ezzel a gombbal térj vissza: a böngésző Vissza gombja a bank fizetőoldalára vinne,
        amit a bank biztonsági okból már nem tölt be újra.
      </p>
    </>
  );
}

/**
 * A CIB banki tesztkörnyezetének jelölése (lelet 28, C1): a banki átvételi
 * teszt ezen az oldalon nézi a kötelező adatsort — tesztkörnyezetben itt is
 * látszódjon, hogy valódi terhelés nincs. Hibánál / élesben semmi (fail-closed).
 */
function CibTesztJelzes() {
  const [teszt, setTeszt] = useState(false);
  useEffect(() => {
    let el = true;
    publikusKonfig().then((k) => { if (el) setTeszt(k?.kartyas_fizetes === 'teszt'); });
    return () => { el = false; };
  }, []);
  if (!teszt) return null;
  return (
    <div
      role="status"
      data-testid="eredmeny-teszt-jelzes"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: '12px 14px', borderRadius: 8,
        background: 'rgba(37,99,235,0.12)', border: '2px solid rgba(37,99,235,0.55)', color: 'var(--text)', fontSize: 14,
      }}
    >
      <FlaskConical size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <strong>{CIB_TESZT_SAV_SZOVEG}</strong>
    </div>
  );
}

function FrissitesGomb({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={onClick}>
      <RefreshCw size={14} aria-hidden /> Frissítés
    </button>
  );
}

function KezdokepernyoTipp() {
  return (
    <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
      Ha a kezdőképernyőre tett GoFuvarból indítottad a fizetést, és ez az oldal egy másik
      böngészőben nyílt meg, térj vissza oda: ott is látod az eredményt.
    </p>
  );
}

function AltalanosHiba({ hiba }: { hiba: string }) {
  const azonositas = hiba === 'azonositas';
  return (
    <div className="card" style={KARTYA}>
      <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
        <AlertTriangle size={24} aria-hidden /> Nem tudjuk megjeleníteni az eredményt
      </h1>
      {azonositas ? (
        <p>
          Nem tudtuk azonosítani a bank válaszát. Ha fizettél, az eredményt a banktól lekérdezzük,
          és e-mailben értesítünk; a fuvar oldalán is látod. Új fizetést csak azután indíts, hogy ott
          megnézted az állapotát.
        </p>
      ) : (
        <p>
          Ez a fizetési link már nem érvényes. A fizetés állapotát és az új fizetés indítását a fuvar
          oldalán találod.
        </p>
      )}
      <Link href="/fuvarjaim" className="btn" style={{ marginTop: 8 }}>Fuvarjaim</Link>
    </div>
  );
}

function EredmenyTartalom() {
  const params = useSearchParams();
  const token = params.get('e');
  const hiba = params.get('hiba');
  const user = useCurrentUser();

  const [nezet, setNezet] = useState<Nezet>({ fajta: 'betoltes' });
  const [lassu, setLassu] = useState(false);
  /** Egymást követő, nem 404-es hibák száma (5xx, 429, hálózat). */
  const [hibaSzam, setHibaSzam] = useState(0);
  /** A 30 perces felső korlát után az automatikus lekérdezés leállt. */
  const [megallt, setMegallt] = useState(false);
  const indulas = useRef(Date.now());
  const ora = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leallt = useRef(false);
  /** Az utolsó ismert állapot — egy átmeneti hiba után is ennek az ütemével kérdezünk. */
  const utolsoAllapot = useRef<string | null>(null);

  const lekerdez = useCallback(async () => {
    if (!token || leallt.current) return;
    if (ora.current) { clearTimeout(ora.current); ora.current = null; }
    let tovabb = true;
    let hiba: unknown = null;
    try {
      const r = await api.getCibEredmeny(token);
      if (leallt.current) return;
      setHibaSzam(0);
      setNezet({ fajta: 'eredmeny', e: r });
      utolsoAllapot.current = r.allapot;
      // Az „ellenőrzés" sem végállapot a lekérdezésnek (W2, 2026-10-04): a
      // backend az egyeztetést magától lezárja, a döntésnek itt is meg kell
      // jelennie (lib: lekerdezesUtem).
      if (lekerdezesUtem(r.allapot, 0) === null) tovabb = false;
    } catch (err) {
      if (leallt.current) return;
      if ((err as { status?: number }).status === 404) {
        setNezet({ fajta: 'lejart' });
        tovabb = false;
      } else {
        // Átmeneti hiba: tovább kérdezünk (a nézet marad), de számoljuk —
        // néhány próba után kiírjuk, hogy most nem érjük el.
        setHibaSzam((n) => n + 1);
        hiba = err;
      }
    }
    if (!tovabb) { leallt.current = true; return; }
    const eltelt = Date.now() - indulas.current;
    if (eltelt >= GYORS_SZAKASZ_MS) setLassu(true);
    if (!lekerdezesFolytathato(eltelt)) {
      leallt.current = true;
      setMegallt(true);
      return;
    }
    // 429-re a szerver kérte ideig várunk (lelet 11): közös NAT mögött a
    // 3 mp-es ütem a banki visszatérés keretét is elfogyasztotta.
    const alap = lekerdezesUtem(utolsoAllapot.current, eltelt) ?? kovetkezoLekeresMs(eltelt);
    ora.current = setTimeout(() => { lekerdez(); }, hiba ? varakozasHibaUtan(hiba, alap) : alap);
  }, [token]);

  /** A „Frissítés" gomb: a felső korlát után újraindítja a lekérdezést. */
  const ujraindit = useCallback(() => {
    if (ora.current) { clearTimeout(ora.current); ora.current = null; }
    leallt.current = false;
    indulas.current = Date.now();
    setMegallt(false);
    setLassu(false);
    lekerdez();
  }, [lekerdez]);

  useEffect(() => {
    if (!token || hiba) return;
    leallt.current = false;
    indulas.current = Date.now();
    lekerdez();
    return () => {
      leallt.current = true;
      if (ora.current) clearTimeout(ora.current);
    };
  }, [token, hiba, lekerdez]);

  // Bejelentkezve a socket azonnali újrakérdezést vált ki.
  useEffect(() => {
    if (!user || !token || hiba) return;
    let socket: ReturnType<typeof getSocket> | null = null;
    const most = () => { if (!leallt.current) lekerdez(); };
    try {
      socket = getSocket();
      socket.on('cib:eredmeny', most);
      socket.on('job:paid', most);
    } catch { socket = null; }
    return () => {
      if (socket) { socket.off('cib:eredmeny', most); socket.off('job:paid', most); }
    };
  }, [user, token, hiba, lekerdez]);

  if (hiba || !token) return <AltalanosHiba hiba={hiba || 'link'} />;

  if (nezet.fajta === 'betoltes') {
    if (hibaSzam < ELERHETETLEN_HIBASZAM && !megallt) {
      return <Loading label="A fizetés eredményének betöltése…" />;
    }
    return (
      <div className="card" style={KARTYA}>
        <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
          <WifiOff size={24} aria-hidden /> Most nem érjük el az eredményt
        </h1>
        <p role="status">
          A kapcsolat a szerverrel akadozik{megallt ? '' : ' — a háttérben tovább próbálkozunk'}. Ha
          fizettél, az eredményről e-mailben is értesítünk, és a fuvar oldalán is látod. Új fizetést
          csak azután indíts, hogy ott megnézted az állapotát.
        </p>
        {megallt && <FrissitesGomb onClick={ujraindit} />}
        <div><Link href="/fuvarjaim" className="btn" style={{ marginTop: 12 }}>Fuvarjaim</Link></div>
        <KezdokepernyoTipp />
      </div>
    );
  }

  if (nezet.fajta === 'lejart') {
    return (
      <div className="card" style={KARTYA}>
        <h1 style={{ fontSize: 24 }}>Az eredmény nem érhető el</h1>
        <p>
          Ez az eredmény-link lejárt vagy érvénytelen. A fizetés állapotát a fuvar oldalán látod,
          és e-mailben is értesítünk az eredményről.
        </p>
        <Link href="/fuvarjaim" className="btn" style={{ marginTop: 8 }}>Fuvarjaim</Link>
      </div>
    );
  }

  const e = nezet.e;
  const jobId = e.job_id;

  if (e.allapot === 'feldolgozas') {
    return (
      <div className="card" style={KARTYA}>
        <h1 style={{ fontSize: 24 }}>A fizetés feldolgozása</h1>
        <ol aria-label="A fizetés lépései" style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <li style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <CircleCheck size={18} color="var(--success)" aria-hidden /> Visszatértél a banktól
          </li>
          <li style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <Hourglass size={18} aria-hidden /> A bank megerősíti a fizetést (3D Secure)…
          </li>
          <li className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Hourglass size={18} aria-hidden /> Lezárás
          </li>
        </ol>
        {megallt ? (
          <>
            <p role="status">
              Az automatikus frissítést leállítottuk. Az eredményről e-mailben értesítünk, és a fuvar
              oldalán is látod; most is lekérdezheted:
            </p>
            <FrissitesGomb onClick={ujraindit} />
          </>
        ) : (
          <>
            <Loading label="Ellenőrizzük a bank válaszát…" />
            {lassu ? (
              <p role="status">
                Még tart. Nem kell várnod: amint a bank megerősíti, e-mailt küldünk, és a fuvar oldalán is
                látod az eredményt.
              </p>
            ) : (
              <p className="muted">Nem kell itt várnod, e-mailt is küldünk.</p>
            )}
          </>
        )}
        {e.trid && (
          <p className="muted" style={{ fontSize: 13 }}>
            {CIB_FELIRATOK.trid}: <strong>{e.trid}</strong>
          </p>
        )}
        <VisszaGomb jobId={jobId} bejelentkezve={!!user} elsodleges />
        <KezdokepernyoTipp />
      </div>
    );
  }

  if (e.allapot === 'sikeres') {
    return (
      <div className="card" style={{ ...KARTYA, borderColor: 'var(--success)' }}>
        <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
          <CheckCircle2 size={24} color="var(--success)" aria-hidden /> Sikeres fizetés
        </h1>
        <p>A kapcsolatfelvételi díjat kifizetted, a szállító elérhetősége megnyílt.</p>
        <BankiTranzakcioAdatok adatok={e} mentesTipp kimenet="sikeres" />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {jobId && (
            <Link href={fuvarUt(jobId, !!user, 'elerhetoseg')} className="btn">Szállító elérhetőségének megnyitása</Link>
          )}
        </div>
        <VisszaGomb jobId={jobId} bejelentkezve={!!user} />
        <KezdokepernyoTipp />
      </div>
    );
  }

  if (e.allapot === 'ellenorzes') {
    return (
      <div className="card" style={KARTYA}>
        <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
          <ShieldAlert size={24} aria-hidden /> Ne fizess újra
        </h1>
        <p>
          A bank válaszát egyeztetjük. Legkésőbb 1 munkanapon belül rendezzük, és kétszer biztosan
          nem terhelünk — az eredményről e-mailben értesítünk.
        </p>
        <BankiTranzakcioAdatok adatok={e} mentesTipp kimenet="ellenorzes" />
        {/* W2 (2026-10-04): az egyeztetést a backend magától is lezárhatja —
            az oldal lassan tovább figyel, a plafon után kézi frissítéssel. */}
        {megallt && (
          <>
            <p role="status">
              Az automatikus frissítést leállítottuk. Az eredményről e-mailben értesítünk, és a fuvar
              oldalán is látod; most is lekérdezheted:
            </p>
            <FrissitesGomb onClick={ujraindit} />
          </>
        )}
        <p style={{ fontSize: 13 }}>
          Kérdésed van? Írj nekünk a TrID-vel: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
          {' '}vagy hívj: <a href="tel:+36203979223">+36 20 397 9223</a>
        </p>
        <VisszaGomb jobId={jobId} bejelentkezve={!!user} elsodleges />
      </div>
    );
  }

  // sikertelen / nem_terhelt / mar_fizetve / visszateritve
  // A visszatérített kísérletnél a bank TERHELT (RC=00), a díjat
  // visszautaltuk — se „nem véglegesítettük", se „nem terheltük" (2. javítókör).
  const visszaterit = visszateritett(e);
  const nemTerhelt = e.allapot === 'nem_terhelt' && !visszaterit;
  const marFizetve = e.allapot === 'mar_fizetve';
  const semleges = marFizetve || nemTerhelt || visszaterit;
  const u = ugyfelUzenet({ rc: e.rc, rc_csoport: e.rc_csoport });
  const ujraProba = e.ujra_fizetheto && !!jobId && !marFizetve;
  const cim = visszaterit
    ? 'A díjat visszatérítettük'
    : marFizetve ? 'A díjat már rendezted' : nemTerhelt ? 'A fizetést nem véglegesítettük' : 'A fizetés nem sikerült';

  return (
    <div className="card" style={{ ...KARTYA, borderColor: semleges ? 'var(--border)' : 'var(--danger)' }}>
      <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
        {visszaterit
          ? <RotateCcw size={24} color="var(--muted)" aria-hidden />
          : <XCircle size={24} color={semleges ? 'var(--muted)' : 'var(--danger)'} aria-hidden />}
        {cim}
      </h1>
      {visszaterit && <p>{visszateritesMagyarazat()}</p>}
      {marFizetve && (
        <p>
          Ezt a díjat már rendezted; ezt a próbálkozást nem véglegesítettük. Ezzel a kísérlettel nem
          terheltük a kártyádat — ha a bank zárolt összeget, azt feloldja (a kivonaton pár napig függő
          tételként látszhat).
        </p>
      )}
      {/* C5 (lelet 9): az admin-egyeztetés és a banki visszafordítás
          saját, igaz okot kap — nem „a bank nem fogadta el". */}
      {nemTerhelt && <p>{nemTerheltMagyarazat(e.ok)}</p>}
      {!semleges && (
        <>
          <p style={{ fontWeight: 600 }}>{u.cim}</p>
          <ul style={{ paddingLeft: 20, fontSize: 14 }}>
            {u.pontok.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>{BANKI_TOVABBI_INFO}</p>
        </>
      )}
      <BankiTranzakcioAdatok adatok={e} mentesTipp kimenet={visszaterit ? 'visszateritve' : 'nem_terhelt'} />

      {ujraProba && (
        user ? (
          <div style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>Új fizetés indítása</h2>
            <DijFizetesKartya
              jobId={jobId as string}
              feeHuf={e.amo == null ? null : Number(e.amo)}
              mutassElozoEredmenyt={false}
              zaroMondat={
                <>
                  ha a fuvar a szállító hibájából hiúsul meg, díjmentesen választhatok másik szállítót
                  ugyanerre a fuvarra.
                </>
              }
            />
          </div>
        ) : (
          <Link
            href={`/bejelentkezes?next=${encodeURIComponent(`/dashboard/fuvar/${jobId}?fizetes=ujra`)}`}
            className="btn"
            style={{ marginTop: 16 }}
          >
            Belépés és újrapróba
          </Link>
        )
      )}
      {/* Lelet 25c: újrapróba nélkül is megmondjuk, miért nincs (a díjat
          közben rendezte, egy másik fizetés fut, vagy a fuvar megváltozott). */}
      {!ujraProba && !marFizetve && (
        <p style={{ fontSize: 14, marginTop: 16 }}>
          {/* 2026-10-03: a backend a szünetet és a próbálkozási korlátot is
              figyelembe veszi (ujra_fizetheto) — az okok között ezek is. */}
          Ehhez a fuvarhoz most nem indítható új fizetés — például mert a díjat közben rendezted, egy
          másik fizetésed még folyamatban van, a kártyás fizetés átmenetileg szünetel, túl sok fizetési
          kísérlet volt ennél a fuvarnál, vagy a fuvar állapota megváltozott. Az aktuális állapotot a
          fuvar oldalán látod.
        </p>
      )}
      <VisszaGomb jobId={jobId} bejelentkezve={!!user} elsodleges={!ujraProba} />
      <KezdokepernyoTipp />
    </div>
  );
}

export default function FizetesEredmenyOldal() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <CibTesztJelzes />
      <Suspense fallback={<Loading label="A fizetés eredményének betöltése…" />}>
        <EredmenyTartalom />
      </Suspense>
    </div>
  );
}
