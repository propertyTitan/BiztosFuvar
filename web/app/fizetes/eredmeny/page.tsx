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
//  leáll, és 30 perc után is (a token 24 órás — egy nyitva hagyott fül ne
//  kérdezzen addig; utána „Frissítés" gomb). Tartós, nem 404-es hibánál
//  (5xx, 429, hálózat) három próba után kiírjuk, hogy most nem érjük el, és
//  kiutat adunk — a háttérben tovább próbálkozunk. Bejelentkezve a
//  socket-események (`cib:eredmeny`, `job:paid`) azonnali újrakérdezést
//  váltanak ki. A lekérdezés csak a DB-t olvassa; a banki lekérdezés ütemét
//  a backend fékezi. ⚠️ A 3 mp-es ütem ~20 kérés/perc/IP — a backend
//  IP-limitjének ezt el kell bírnia.
//
//  „Vissza a fuvarhoz" gomb MINDIG van: a böngésző Vissza gombja a bank
//  oldalára vinne (amit a bank biztonsági okból elutasít). Kijelentkezve a
//  fuvar-linkek a belépésen át (`?next=`) visznek a fuvarhoz.
// =====================================================================
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, CircleCheck, Hourglass, RefreshCw, ShieldAlert, WifiOff, XCircle } from 'lucide-react';
import { api, type CibEredmeny } from '@/api';
import { Loading } from '@/components/StateView';
import BankiTranzakcioAdatok from '@/components/BankiTranzakcioAdatok';
import DijFizetesKartya from '@/components/DijFizetesKartya';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import { CIB_FELIRATOK } from '@/lib/cibFeliratok';
import { BANKI_TOVABBI_INFO, ugyfelUzenet } from '@/lib/cibRcCsoport';
import {
  ELERHETETLEN_HIBASZAM, GYORS_SZAKASZ_MS, kovetkezoLekeresMs, lekerdezesFolytathato, vegleges,
} from '@/lib/cibFizetes';

type Nezet =
  | { fajta: 'betoltes' }
  | { fajta: 'eredmeny'; e: CibEredmeny }
  | { fajta: 'lejart' };

const KARTYA = { marginTop: 16 } as const;

/**
 * A fuvar oldala. Kijelentkezve a belépésen át (`?next=`) visz oda: a
 * fuvaroldal 401-e különben cél nélkül dobná a belépésre.
 */
function fuvarUt(jobId: string | null | undefined, bejelentkezve: boolean): string {
  if (!jobId) return '/fuvarjaim';
  const ut = `/dashboard/fuvar/${jobId}`;
  return bejelentkezve ? ut : `/bejelentkezes?next=${encodeURIComponent(ut)}`;
}

function VisszaGomb({ jobId, bejelentkezve }: { jobId: string | null | undefined; bejelentkezve: boolean }) {
  return (
    <Link href={fuvarUt(jobId, bejelentkezve)} className="btn btn-secondary" style={{ marginTop: 12 }}>
      Vissza a fuvarhoz
    </Link>
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

  const lekerdez = useCallback(async () => {
    if (!token || leallt.current) return;
    if (ora.current) { clearTimeout(ora.current); ora.current = null; }
    let tovabb = true;
    try {
      const r = await api.getCibEredmeny(token);
      if (leallt.current) return;
      setHibaSzam(0);
      setNezet({ fajta: 'eredmeny', e: r });
      if (vegleges(r.allapot)) tovabb = false;
    } catch (err) {
      if (leallt.current) return;
      if ((err as { status?: number }).status === 404) {
        setNezet({ fajta: 'lejart' });
        tovabb = false;
      } else {
        // Átmeneti hiba: tovább kérdezünk (a nézet marad), de számoljuk —
        // néhány próba után kiírjuk, hogy most nem érjük el.
        setHibaSzam((n) => n + 1);
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
    ora.current = setTimeout(() => { lekerdez(); }, kovetkezoLekeresMs(eltelt));
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
        <VisszaGomb jobId={jobId} bejelentkezve={!!user} />
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
        <BankiTranzakcioAdatok adatok={e} mentesTipp />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {jobId && (
            <Link href={fuvarUt(jobId, !!user)} className="btn">Szállító elérhetőségének megnyitása</Link>
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
        <BankiTranzakcioAdatok adatok={e} mentesTipp />
        <p style={{ fontSize: 13 }}>
          Kérdésed van? Írj nekünk a TrID-vel: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
          {' '}vagy hívj: <a href="tel:+36203979223">+36 20 397 9223</a>
        </p>
        <VisszaGomb jobId={jobId} bejelentkezve={!!user} />
      </div>
    );
  }

  // sikertelen / nem_terhelt / mar_fizetve
  const nemTerhelt = e.allapot === 'nem_terhelt';
  const marFizetve = e.allapot === 'mar_fizetve';
  const u = ugyfelUzenet({ rc: e.rc, rc_csoport: e.rc_csoport });
  const ujraProba = e.ujra_fizetheto && !!jobId && !marFizetve;

  return (
    <div className="card" style={{ ...KARTYA, borderColor: marFizetve || nemTerhelt ? 'var(--border)' : 'var(--danger)' }}>
      <h1 style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 24 }}>
        <XCircle size={24} color={marFizetve || nemTerhelt ? 'var(--muted)' : 'var(--danger)'} aria-hidden />
        {marFizetve ? 'A díjat már rendezted' : nemTerhelt ? 'A fizetést nem véglegesítettük' : 'A fizetés nem sikerült'}
      </h1>
      {marFizetve && (
        <p>
          Ezt a díjat már rendezted; ezt a próbálkozást nem véglegesítettük. Ezzel a kísérlettel nem
          terheltük a kártyádat — ha a bank zárolt összeget, azt feloldja (a kivonaton pár napig függő
          tételként látszhat).
        </p>
      )}
      {nemTerhelt && (
        <p>
          Nem terheltük a kártyádat. A zárolt összeget a bank feloldja (a kivonaton pár napig függő
          tételként látszhat).
        </p>
      )}
      {!marFizetve && !nemTerhelt && (
        <>
          <p style={{ fontWeight: 600 }}>{u.cim}</p>
          <ul style={{ paddingLeft: 20, fontSize: 14 }}>
            {u.pontok.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>{BANKI_TOVABBI_INFO}</p>
        </>
      )}
      <BankiTranzakcioAdatok adatok={e} mentesTipp />

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
      <div><VisszaGomb jobId={jobId} bejelentkezve={!!user} /></div>
      <KezdokepernyoTipp />
    </div>
  );
}

export default function FizetesEredmenyOldal() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Suspense fallback={<Loading label="A fizetés eredményének betöltése…" />}>
        <EredmenyTartalom />
      </Suspense>
    </div>
  );
}
