'use client';

// =====================================================================
//  DijFizetesKartya — a kapcsolatfelvételi díj fizetése (CIB PR-3)
//
//  A feladói fuvaroldal és a /fizetes/eredmeny közös komponense.
//
//  ÚTVÁLASZTÁS (a POST /jobs/:id/pay válasza szerint, ebben a sorrendben):
//   1. `paid_via_voucher` → az ajánlói jutalom fedezte, nincs banki oldal;
//   2. `is_stub`          → a mai teszt-út: /fizetes-stub (VÁLTOZATLAN);
//   3. CIB (`provider:'cib'` / `redirect_url`) → az EGYSZER HASZNÁLATOS
//      átirányító linkre megyünk (api…/payments/cib/tovabb/<token>); a
//      banki URL-t a böngésző csak ott kapja meg;
//   4. régi válasz (`gateway_url`) → oda.
//  Átirányítani csak http(s) címre szabad.
//
//  ÁLLAPOTOK (GET /jobs/:id/fee-payment, lib/cibFizetes.ts:kartyaAllapot):
//  alap · nyitott (vissza nem tért kísérlet — újat indíthat) · lezaras (a
//  gomb rejtve, 5 mp-es frissítés) · sikeres (a fuvar EGYSZER újratöltődik,
//  megnyílik a kontakt; a lekérdezés leáll — nem a socketen múlik) ·
//  ellenorzes („Ne fizess újra") · elozo_sikertelen (az RC-csoport szerinti
//  magyarázat + a kötelező adatsor + újrapróba — a bank szerint sikertelen
//  fizetés után az újrapróbát KÖTELEZŐ felkínálni).
//
//  BETÖLTÉS: amíg a fizetési mód nem ismert, a gomb nem nyomható (CIB-módban
//  különben a banki kötelező blokk nélkül lehetne fizetni); átmeneti hibánál
//  (5xx, 429, időtúllépés, hálózat) újrapróbálunk, a 401/403/404 a mai
//  (stub) felületet adja. VISSZA A BANKTÓL (bfcache, főleg iOS Safari): a
//  `pageshow` (persisted) visszaállítja a gombot és újraolvassa az állapotot.
//
//  HIBÁK: minden /pay-hiba FIX magyar szöveget kap (lib/cibFizetes.ts) —
//  banki vagy szerver-belső szöveg soha nem jut a felhasználóhoz.
//
//  A CIB-es kötelező infó-blokk (logók, linkek, ország) CSAK CIB-módban
//  látszik; stub-üzemben (és ha a fee-payment végpont nem érhető el) a mai
//  felület marad, a gomb felirata is („Díj fizetése").
//
//  KÉT NYILATKOZAT CIB-MÓDBAN (2026-10-01, a CIB írásos válasza): a 45/2014-
//  es (FeeConsentLabel, változatlan) MELLETT egy külön, előre ki nem pipált
//  adattovábbítási hozzájárulás (CibAdatkezelesiNyilatkozat) — a bank akkor
//  is kéri, ha vásárlói adatot nem küldünk. A gomb csak mindkettővel
//  nyomható, és a /pay a `cib_adatkezelesi_hozzajarulas: true`-t is viszi
//  (nélküle a backend 400 CIB_CONSENT_REQUIRED). Stub-módban nincs ilyen.
// =====================================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, Hourglass, ShieldAlert } from 'lucide-react';
import { api, type FeePaymentAllapot } from '@/api';
import FeeConsentLabel from '@/components/FeeConsentLabel';
import CibAdatkezelesiNyilatkozat from '@/components/CibAdatkezelesiNyilatkozat';
import CibFizetesInfo from '@/components/CibFizetesInfo';
import BankiTranzakcioAdatok from '@/components/BankiTranzakcioAdatok';
import { useToast } from '@/components/ToastProvider';
import { getSocket } from '@/lib/socket';
import { kulsoOldalraLep } from '@/lib/navigacio';
import { CIB_FELIRATOK, CIB_IDO_TIPP } from '@/lib/cibFeliratok';
import { BANKI_TOVABBI_INFO, ugyfelUzenet } from '@/lib/cibRcCsoport';
import {
  ALLAPOT_UJRAPROBA_MS, GYORS_SZAKASZ_MS, LASSU_LEKERDEZES_MS, atmenetiHiba,
  biztonsagosAtiranyitasiCel, fizetesHibaUzenet, kartyaAllapot, percKiiras, type HibaUzenet,
} from '@/lib/cibFizetes';

type Props = {
  jobId: string;
  feeHuf: number | null | undefined;
  /** A fuvar újratöltése (kupon, állapotváltozás, lezárás vége). */
  onFrissites?: () => void | Promise<void>;
  /** A FeeConsentLabel ág-specifikus záró mondata. */
  zaroMondat?: ReactNode;
  /** Az előző sikertelen kísérlet magyarázata (az eredményoldal maga mutatja). */
  mutassElozoEredmenyt?: boolean;
};

type Inditas = 'nincs' | 'fut' | 'lassu' | 'atiranyitas';

const LASSU_UZENET_MS = 8_000;
const LEZARAS_FRISSITES_MS = 5_000;

function linkLejartToastSzoveg() {
  return 'Ez a fizetési link már elhasználódott, indíts újat.';
}

export default function DijFizetesKartya({
  jobId, feeHuf, onFrissites, zaroMondat, mutassElozoEredmenyt = true,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [fp, setFp] = useState<FeePaymentAllapot | null>(null);
  const [consent, setConsent] = useState(false);
  /** A CIB felé történő adattovábbítási hozzájárulás (csak CIB-módban kell). */
  const [cibHozzajarulas, setCibHozzajarulas] = useState(false);
  const [inditas, setInditas] = useState<Inditas>('nincs');
  const [hiba, setHiba] = useState<HibaUzenet | null>(null);
  /** Lefutott-e már legalább egy állapot-lekérdezés (sikerrel vagy hibával). */
  const [betoltve, setBetoltve] = useState(false);
  const gyokerRef = useRef<HTMLDivElement>(null);
  const eletben = useRef(true);
  const fpRef = useRef<FeePaymentAllapot | null>(null);
  const ujraprobaOra = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ujraprobaSzam = useRef(0);

  const allapotBetoltes = useCallback(async (): Promise<FeePaymentAllapot | null> => {
    try {
      // A `Promise.resolve().then` a szinkron dobást (pl. egy hiányzó metódust
      // egy régi mockban) is elutasítássá alakítja — az oldal nem törik el.
      const r = await Promise.resolve().then(() => api.getFeePayment(jobId));
      const ertek = r && typeof r === 'object' ? r : null;
      ujraprobaSzam.current = 0;
      if (eletben.current) { fpRef.current = ertek; setFp(ertek); }
      return ertek;
    } catch (err) {
      // 404/403: a mai (stub) felület marad. Egy már ismert CIB-állapotot
      // viszont nem írunk felül egy átmeneti hiba miatt. Átmeneti hibánál
      // (5xx, 429, időtúllépés, hálózat) néhányszor újrapróbálunk — különben
      // CIB-módban a banki kötelező blokk nélküli felület maradna itt.
      if (eletben.current && atmenetiHiba(err) && ujraprobaSzam.current < ALLAPOT_UJRAPROBA_MS.length) {
        const varakozas = ALLAPOT_UJRAPROBA_MS[ujraprobaSzam.current];
        ujraprobaSzam.current += 1;
        if (ujraprobaOra.current) clearTimeout(ujraprobaOra.current);
        ujraprobaOra.current = setTimeout(() => {
          ujraprobaOra.current = null;
          if (eletben.current) allapotBetoltesRef.current();
        }, varakozas);
      }
      return fpRef.current;
    } finally {
      if (eletben.current) setBetoltve(true);
    }
  }, [jobId]);
  // Az időzített újrapróba mindig a legfrissebb lekérdezőt hívja.
  const allapotBetoltesRef = useRef(allapotBetoltes);
  allapotBetoltesRef.current = allapotBetoltes;

  // Betöltés + URL-paraméterek (?fizetes=ujra | link-lejart) + socket.
  useEffect(() => {
    eletben.current = true;
    allapotBetoltes();

    try {
      const url = new URL(window.location.href);
      const fizetes = url.searchParams.get('fizetes');
      if (fizetes === 'ujra' || fizetes === 'link-lejart') {
        if (fizetes === 'link-lejart') toast.info('A fizetési link lejárt', linkLejartToastSzoveg());
        gyokerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // A paramétert levesszük, hogy egy újratöltés ne ismételje.
        url.searchParams.delete('fizetes');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch { /* nem kritikus */ }

    let socket: ReturnType<typeof getSocket> | null = null;
    const frissit = (p?: { job_id?: string }) => {
      if (!p || !p.job_id || p.job_id === jobId) allapotBetoltes();
    };
    try {
      socket = getSocket();
      socket.on('cib:eredmeny', frissit);
      socket.on('job:paid', frissit);
    } catch { socket = null; }

    // Vissza a bank oldaláról: a böngésző (főleg iOS Safari) a gyorsítótárból
    // állítja vissza az oldalt — a gomb „Átirányítás…" állapotban ragadna.
    const oldalVissza = (e: Event) => {
      if (!(e as PageTransitionEvent).persisted || !eletben.current) return;
      setInditas('nincs');
      setHiba(null);
      allapotBetoltes();
    };
    window.addEventListener('pageshow', oldalVissza);

    return () => {
      eletben.current = false;
      window.removeEventListener('pageshow', oldalVissza);
      if (ujraprobaOra.current) { clearTimeout(ujraprobaOra.current); ujraprobaOra.current = null; }
      if (socket) {
        socket.off('cib:eredmeny', frissit);
        socket.off('job:paid', frissit);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, allapotBetoltes]);

  const allapot = kartyaAllapot(fp);
  const cib = fp?.provider_kind === 'cib';

  // A lezárás alatt 5 mp-enként (3 perc után 20 mp-enként) újraolvasunk.
  // SIKERNÉL a fuvart EGYSZER újratöltjük (megnyílik a kontakt, a kártya
  // eltűnik), és a lekérdezés leáll — ez nem múlhat a socket-eseményen. Ha a
  // lezárás más állapotba (sikertelen, ellenőrzés) fut ki, szintén frissítünk.
  const elozoAllapot = useRef(allapot);
  const sikerFrissitve = useRef(false);
  useEffect(() => {
    const elozo = elozoAllapot.current;
    elozoAllapot.current = allapot;
    if (allapot === 'sikeres') {
      if (!sikerFrissitve.current) { sikerFrissitve.current = true; onFrissites?.(); }
      return;
    }
    if (elozo === 'lezaras' && allapot !== 'lezaras') onFrissites?.();
    if (allapot !== 'lezaras') return;
    const kezdet = Date.now();
    let ora: ReturnType<typeof setTimeout> | null = null;
    const utemez = () => {
      const kov = Date.now() - kezdet < GYORS_SZAKASZ_MS ? LEZARAS_FRISSITES_MS : LASSU_LEKERDEZES_MS;
      ora = setTimeout(() => { allapotBetoltes(); utemez(); }, kov);
    };
    utemez();
    return () => { if (ora) clearTimeout(ora); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allapot]);

  async function indit() {
    if (!betoltve) return;
    if (!consent) {
      toast.error('Beleegyezés szükséges', 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.');
      return;
    }
    if (cib && !cibHozzajarulas) {
      toast.error('Nyilatkozat szükséges', 'A bankkártyás fizetéshez pipáld ki a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.');
      return;
    }
    if (inditas !== 'nincs') return;
    setHiba(null);
    setInditas('fut');
    const lassuOra = setTimeout(() => {
      if (eletben.current) setInditas((x) => (x === 'fut' ? 'lassu' : x));
    }, LASSU_UZENET_MS);
    let elnavigal = false;
    try {
      // CIB-úton a hozzájárulás is megy (a gomb nélküle nem nyomható); a
      // stub-út kérése változatlan.
      const r = cib ? await api.payJob(jobId, true, true) : await api.payJob(jobId, true);
      if (r.paid_via_voucher) {
        toast.success('Ingyenes kapcsolatfelvétel!', 'Az ajánlói jutalmadat felhasználtuk — a kapcsolatfelvételi díj elmaradt, a kapcsolat megnyílt.');
        await onFrissites?.();
      } else if (r.is_stub) {
        elnavigal = true;
        router.push(`/fizetes-stub?job=${jobId}`);
      } else if (r.provider === 'cib' || r.redirect_url) {
        const cel = r.redirect_url || r.gateway_url;
        if (!biztonsagosAtiranyitasiCel(cel)) throw Object.assign(new Error('rossz cél'), { code: 'BAD_REDIRECT' });
        elnavigal = true;
        setInditas('atiranyitas');
        kulsoOldalraLep(cel);
      } else if (r.gateway_url) {
        if (!biztonsagosAtiranyitasiCel(r.gateway_url)) throw Object.assign(new Error('rossz cél'), { code: 'BAD_REDIRECT' });
        elnavigal = true;
        setInditas('atiranyitas');
        kulsoOldalraLep(r.gateway_url);
      } else {
        throw Object.assign(new Error('ismeretlen válasz'), { code: 'UNKNOWN_RESPONSE' });
      }
    } catch (e) {
      const u = fizetesHibaUzenet(e as { code?: string; status?: number; message?: string });
      if (eletben.current) setHiba(u);
      toast.error(u.cim, u.szoveg);
      if (u.teendo === 'allapot') await allapotBetoltes();
      if (u.teendo === 'fuvar') await onFrissites?.();
    } finally {
      clearTimeout(lassuOra);
      if (!elnavigal && eletben.current) setInditas('nincs');
    }
  }

  const fee = (feeHuf ?? 0).toLocaleString('hu-HU');
  const gombLathato = allapot !== 'lezaras' && allapot !== 'ellenorzes' && allapot !== 'sikeres';
  const foglalt = inditas !== 'nincs';
  const gombFelirat = !betoltve
    ? 'Betöltés…'
    : inditas === 'atiranyitas'
      ? 'Átirányítás a CIB Bankhoz…'
      : foglalt
        ? (cib ? 'Kapcsolódás a CIB Bankhoz…' : 'Fizetés indítása…')
        : (cib ? `Fizetés bankkártyával (${fee} Ft)` : `Díj fizetése (${fee} Ft)`);
  // Minden szükséges nyilatkozat megvan: a 45/2014-es mindig, CIB-módban az
  // adattovábbítási hozzájárulás is (2026-10-01).
  const nyilatkozatokMegvannak = consent && (!cib || cibHozzajarulas);
  const gombTiltva = !betoltve || foglalt || !nyilatkozatokMegvannak;

  const oa = fp?.open_attempt || null;
  const lr = fp?.last_result || null;
  const ellenorzesTrid = oa?.trid || lr?.trid || null;

  return (
    <div ref={gyokerRef} id="dij-fizetes" data-testid="dij-fizetes-kartya" style={{ scrollMarginTop: 80 }}>
      {allapot === 'ellenorzes' && (
        <div
          style={{
            marginTop: 12, padding: 14, borderRadius: 8,
            background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.5)', color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <ShieldAlert size={18} aria-hidden /> <span>Ne fizess újra</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            A bank válaszát egyeztetjük; legkésőbb 1 munkanapon belül rendezzük, és kétszer biztosan nem terhelünk.
          </p>
          {ellenorzesTrid && (
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              {CIB_FELIRATOK.trid}: <strong>{ellenorzesTrid}</strong>
            </p>
          )}
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            Kérdésed van? Írj nekünk a TrID-vel: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
          </p>
        </div>
      )}

      {allapot === 'lezaras' && (
        <div
          role="status"
          style={{
            marginTop: 12, padding: 14, borderRadius: 8,
            background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.4)', color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <Hourglass size={18} aria-hidden /> <span>A fizetés lezárása folyamatban…</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            Egy fizetésed feldolgozása még tart. Ne indíts újat — pár másodperc múlva frissül az
            oldal; ha a fizetés sikerült, itt megnyílik a szállító elérhetősége.
          </p>
        </div>
      )}

      {allapot === 'sikeres' && (
        <div
          role="status"
          style={{
            marginTop: 12, padding: 14, borderRadius: 8,
            background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.45)', color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <CheckCircle2 size={18} aria-hidden /> <span>Sikeres fizetés</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            A kapcsolatfelvételi díjat kifizetted. A szállító elérhetősége pár másodpercen belül
            megjelenik ezen az oldalon.
          </p>
          {lr && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>A banki tranzakció adatai</summary>
              <div style={{ marginTop: 8 }}>
                <BankiTranzakcioAdatok adatok={lr} />
              </div>
            </details>
          )}
          {onFrissites ? (
            <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => { onFrissites(); }}>
              Oldal frissítése
            </button>
          ) : (
            <Link href={`/dashboard/fuvar/${jobId}`} className="btn" style={{ marginTop: 10 }}>
              Szállító elérhetőségének megnyitása
            </Link>
          )}
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            Ha nem jelenik meg, írj nekünk a TrID-vel: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
          </p>
        </div>
      )}

      {allapot === 'nyitott' && oa && (
        <div
          style={{
            marginTop: 12, padding: 12, borderRadius: 8, display: 'flex', gap: 8,
            background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.5)', color: 'var(--text)',
            fontSize: 13,
          }}
        >
          <Clock size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <p style={{ margin: 0 }}>
            {`Egy korábbi fizetésed ${percKiiras(oa.started_at)} indult, és nem fejeződött be. Ha a bank oldalát bezártad, nyugodtan indíts újat, kétszer biztosan nem terhelünk.`}
          </p>
        </div>
      )}

      {allapot === 'elozo_sikertelen' && mutassElozoEredmenyt && lr && (() => {
        const nemTerhelt = lr.allapot === 'nem_terhelt' || lr.allapot === 'mar_fizetve' || lr.allapot === 'not_closed';
        const u = ugyfelUzenet({ rc: lr.rc, rc_csoport: lr.rc_csoport });
        return (
          <div
            style={{
              marginTop: 12, padding: 14, borderRadius: 8,
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.4)', color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
              <AlertTriangle size={18} aria-hidden />
              <span>{nemTerhelt ? 'Az előző fizetési kísérletet nem véglegesítettük' : 'Az előző fizetési kísérlet nem sikerült'}</span>
            </div>
            {nemTerhelt ? (
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>
                Nem terheltük a kártyádat; a zárolt összeget a bank feloldja (a kivonaton pár napig függő tételként látszhat).
              </p>
            ) : (
              <>
                <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 600 }}>{u.cim}</p>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {u.pontok.map((p) => <li key={p}>{p}</li>)}
                </ul>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>{BANKI_TOVABBI_INFO}</p>
              </>
            )}
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>A banki tranzakció adatai</summary>
              <div style={{ marginTop: 8 }}>
                <BankiTranzakcioAdatok adatok={lr} />
              </div>
            </details>
            <p style={{ margin: '8px 0 0', fontSize: 13 }}>Új fizetést azonnal indíthatsz — új tranzakcióként.</p>
          </div>
        );
      })()}

      {gombLathato && (
        <>
          <FeeConsentLabel checked={consent} onChange={setConsent} zaroMondat={zaroMondat} />
          {cib && <CibAdatkezelesiNyilatkozat checked={cibHozzajarulas} onChange={setCibHozzajarulas} />}
          {cib && <CibFizetesInfo />}
          {cib && (
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0', lineHeight: 1.5 }}>{CIB_IDO_TIPP}</p>
          )}
          <button
            type="button"
            onClick={indit}
            disabled={gombTiltva}
            className="btn"
            style={{
              marginTop: 12,
              background: nyilatkozatokMegvannak && betoltve ? 'var(--success-strong)' : 'var(--muted)',
              border: 'none',
              cursor: foglalt || !betoltve ? 'wait' : nyilatkozatokMegvannak ? 'pointer' : 'not-allowed',
              opacity: gombTiltva ? 0.7 : 1,
            }}
          >
            {gombFelirat}
          </button>
          {inditas === 'lassu' && (
            <p role="status" className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
              {cib ? 'A bank lassan válaszol, ne zárd be az oldalt.' : 'A szerver lassan válaszol, ne zárd be az oldalt.'}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            A díj ellenében azonnal megkapod a szállító telefonszámát, és
            elindul a fuvar-folyamat (SMS a címzettnek, átvételi kód,
            fotó-bizonyíték). A fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek.
          </p>
        </>
      )}

      {/* Ha a hiba után újraolvasott állapot maga magyaráz (lezárás /
          ellenőrzés doboz), ugyanazt nem mondjuk el kétszer. */}
      {hiba && !(hiba.teendo === 'allapot' && !gombLathato) && (
        <div
          role="alert"
          style={{
            marginTop: 10, padding: 12, borderRadius: 8, fontSize: 13,
            background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.4)', color: 'var(--text)',
          }}
        >
          <strong>{hiba.cim}</strong>
          <div style={{ marginTop: 2 }}>{hiba.szoveg}</div>
        </div>
      )}
    </div>
  );
}
