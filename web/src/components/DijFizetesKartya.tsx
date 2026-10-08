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
//
//  2026-10-03 (CIB PR-5, a web↔backend szerződés C2–C5):
//   - KUPON (C4): ha beváltható ajánlói kupon fedezi a díjat
//     (`kupon_elerheto`), a CIB felé semmi nem megy — a CIB-nyilatkozat és a
//     banki infó-blokk nem jelenik meg, a gomb az ingyenes kapcsolatfelvételt
//     kínálja, a /pay csak a 45/2014-es nyilatkozatot viszi; ha a backend
//     mégis CIB_CONSENT_REQUIRED-et ad, a CIB-nyilatkozat megjelenik (a
//     kártyás tiltás — szünetel, kísérleti korlát — a kupont nem rejti el);
//   - TILTÁS (C3): `can_pay: false` mellett NINCS fizetés-gomb; a tiltás oka
//     (`pay_blocked_reason`) a gomb helyén olvasható;
//   - a letiltott gomb mellett a hiányzó nyilatkozat neve (aria-describedby);
//   - a vissza nem tért kísérletnél nem biztatunk vakon új fizetésre, és az
//     állapotot lassan újraolvassuk.
//
//  2026-10-04 (a PR-5 web 2. javítóköre):
//   - VISSZATÉRÍTÉS: a bank terhelt, a díjat visszautaltuk (admin) — a
//     backend „nem_terhelt"-ként adja ki, a kártya eddig „Nem terheltük a
//     kártyádat"-ot írt rá; most saját, igaz szöveg (lib: visszateritett);
//   - ELHÚZÓDÓ LEZÁRÁS: a backend a lezárás alatti és a bank oldalán hagyott
//     kísérletet ugyanúgy adja; ha a lezárás-doboz egy percnél tovább áll
//     (vagy nem kártyás úton), már nem „pár másodpercet" ígér, hanem
//     percekről beszél, és kézi frissítést kínál (lib: lezarasKesik);
//   - a „nyitott" sáv tiltás mellett nem biztat új fizetésre;
//   - a lezárás lekérdezése 30 perc után leáll, utána kézi frissítés;
//   - (W2) az egyeztetés alatt („Ne fizess újra") is lassan figyelünk, kézi
//     frissítéssel: a backend a kétes kísérletet magától is lezárja.
// =====================================================================
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Ban, CheckCircle2, Clock, CreditCard, Gift, Hourglass, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { api, type FeePaymentAllapot } from '@/api';
import FeeConsentLabel from '@/components/FeeConsentLabel';
import CibAdatkezelesiNyilatkozat from '@/components/CibAdatkezelesiNyilatkozat';
import CibFizetesInfo from '@/components/CibFizetesInfo';
import BankiTranzakcioAdatok from '@/components/BankiTranzakcioAdatok';
import { useToast } from '@/components/ToastProvider';
import { getSocket } from '@/lib/socket';
import { ft } from '@/lib/connectionFee';
import { kulsoOldalraLep } from '@/lib/navigacio';
import { CIB_FELIRATOK, CIB_IDO_TIPP } from '@/lib/cibFeliratok';
import { BANKI_TOVABBI_INFO, ugyfelUzenet } from '@/lib/cibRcCsoport';
import {
  ALLAPOT_UJRAPROBA_MS, GYORS_SZAKASZ_MS, LASSU_LEKERDEZES_MS, LEKERDEZES_PLAFON_MS, LEZARAS_KESES_MS, atmenetiHiba,
  biztonsagosAtiranyitasiCel, fizetesHibaUzenet, fizetesTiltasUzenet, folyamatbanSzoveg, kartyaAllapot, lezarasKesik,
  nemTerheltMagyarazat, nyilatkozatHiany, nyitottSavSzoveg, visszateritesMagyarazat, visszateritett,
  type HibaUzenet,
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
/**
 * A vissza nem tért (vagy egy másik kísérlet miatt tiltott) fizetést ennyi
 * ideig figyeljük lassú ütemben (2026-10-03, lelet 10): a bank a magára
 * hagyott kísérletet ~9,5–11 perc után TO-val zárja, a lekérdező kör ezt
 * ~11–13 perc után látja; a visszatért kísérletet a háttér-lekérdezés percen
 * belül lezárja. 2026-10-04 (2. javítókör): 15 → 20 perc, hogy egy később
 * megnyitott oldal is kivárja; utána kézi frissítés.
 */
const NYITOTT_FIGYELES_MS = 20 * 60_000;

/**
 * W2 (2026-10-04): a backend ugyanezzel a paraméterrel küld vissza a
 * felhasznált, a lejárt, a szünet alatti (CIB_UJ_FIZETES_TILTVA) és a másik
 * kísérlet zárása miatt nem használható linkről — az „indíts újat" ezek
 * felében hamis volt. Terhelésről sem állítunk semmit (egy felhasznált link
 * mögött már elindult fizetés is lehet); a kártya maga mutatja az állapotot.
 */
function linkLejartToastSzoveg() {
  return 'Ez a fizetési link már nem használható. A díj aktuális állapotát itt látod; ha új fizetés indítható, innen indíthatod.';
}

/**
 * 2026-10-04 (PR-5, végső kör): a szünet (CIB_UJ_FIZETES_TILTVA) alatt
 * használt, még fel nem használt linkről a backend ?fizetes=szunetel-lel küld
 * vissza — eddig „lejárt link"-et mondtunk, holott a link a szünet miatt nem
 * nyitotta meg a bank oldalát. Terhelésről itt sem állítunk semmit.
 */
function szunetelToastSzoveg() {
  return 'A kártyás fizetés átmenetileg szünetel, ezért a bank fizetőoldalát most nem nyitottuk meg. Próbáld újra később — a díj aktuális állapotát itt látod.';
}

/** Kézi újraolvasás, ha az automatikus figyelés már leállt (vagy lassú). */
function AllapotFrissites({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={onClick}>
      <RefreshCw size={14} aria-hidden /> Állapot frissítése
    </button>
  );
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
  /**
   * A /pay CIB_CONSENT_REQUIRED-del válaszolt: a backend a kártyás úton van,
   * bármit mondjon is az állapot (kupon, stub). 2026-10-03 (a PR-5 web 1.
   * javítóköre): kuponos módban ez eddig zsákutca volt — a kártya továbbra
   * is elrejtette a CIB-nyilatkozatot, így a fizetés sosem indulhatott el.
   */
  const [cibKenyszer, setCibKenyszer] = useState(false);
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

  // Betöltés + URL-paraméterek (?fizetes=ujra | link-lejart | szunetel) + socket.
  useEffect(() => {
    eletben.current = true;
    allapotBetoltes();

    try {
      const url = new URL(window.location.href);
      const fizetes = url.searchParams.get('fizetes');
      if (fizetes === 'ujra' || fizetes === 'link-lejart' || fizetes === 'szunetel') {
        if (fizetes === 'link-lejart') toast.info('A fizetési link már nem érvényes', linkLejartToastSzoveg());
        if (fizetes === 'szunetel') toast.info('A kártyás fizetés átmenetileg szünetel', szunetelToastSzoveg());
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
  // C4: a kupon a bank nélkül rendezi a díjat — ilyenkor CIB-nyilatkozat
  // sem kell (nincs mit továbbítani a banknak).
  const kupon = fp?.kupon_elerheto === true && !cibKenyszer;
  const cibUt = (cib || cibKenyszer) && !kupon;
  // C3: a fizetés tiltása (can_pay=false). Ha a kártya állapota maga
  // magyaráz (lezárás / ellenőrzés / siker), a tiltást nem mondjuk el külön.
  const allapotMagyaraz = allapot === 'lezaras' || allapot === 'ellenorzes' || allapot === 'sikeres';
  // A kártyás fizetésre szóló tiltás (szünetel, kísérleti korlát) a bank
  // nélküli kupont nem érinti — függő kísérlet nélkül a kupon kínálható
  // (a PR-5 web 1. javítóköre). Függő kísérlet mellett marad a tiltás.
  const kuponKiveteles = kupon && !fp?.open_attempt
    && (fp?.pay_blocked_reason === 'szunetel' || fp?.pay_blocked_reason === 'probalkozasi_limit');
  const tiltas = allapotMagyaraz || kuponKiveteles ? null : fizetesTiltasUzenet(fp);

  // A lezárás alatt 5 mp-enként (3 perc után 20 mp-enként) újraolvasunk.
  // SIKERNÉL a fuvart EGYSZER újratöltjük (megnyílik a kontakt, a kártya
  // eltűnik), és a lekérdezés leáll — ez nem múlhat a socket-eseményen. Ha a
  // lezárás más állapotba (sikertelen, ellenőrzés) fut ki, szintén frissítünk.
  // 2026-10-04 (2. javítókör): egy perc után a doboz már nem „pár
  // másodpercet" ígér (lezarasKesik), és a lekérdezés 30 perc után leáll
  // (egy nyitva hagyott fül ne kérdezzen vég nélkül); utána kézi frissítés.
  const elozoAllapot = useRef(allapot);
  const sikerFrissitve = useRef(false);
  const [lezarasMegallt, setLezarasMegallt] = useState(false);
  const [lezarasEltelt, setLezarasEltelt] = useState(0);
  useEffect(() => {
    const elozo = elozoAllapot.current;
    elozoAllapot.current = allapot;
    setLezarasMegallt(false);
    setLezarasEltelt(0);
    if (allapot === 'sikeres') {
      if (!sikerFrissitve.current) { sikerFrissitve.current = true; onFrissites?.(); }
      return;
    }
    if (elozo === 'lezaras' && allapot !== 'lezaras') onFrissites?.();
    if (allapot !== 'lezaras') return;
    const kezdet = Date.now();
    let ora: ReturnType<typeof setTimeout> | null = null;
    const kesesOra = setTimeout(() => setLezarasEltelt(LEZARAS_KESES_MS), LEZARAS_KESES_MS);
    const utemez = () => {
      const eltelt = Date.now() - kezdet;
      if (eltelt >= LEKERDEZES_PLAFON_MS) { setLezarasMegallt(true); return; }
      const kov = eltelt < GYORS_SZAKASZ_MS ? LEZARAS_FRISSITES_MS : LASSU_LEKERDEZES_MS;
      ora = setTimeout(() => { allapotBetoltes(); utemez(); }, kov);
    };
    utemez();
    return () => { if (ora) clearTimeout(ora); clearTimeout(kesesOra); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allapot]);
  const lezarasElhuzodik = lezarasMegallt || lezarasKesik(fp, lezarasEltelt);

  // A vissza nem tért kísérletet (és a másik kísérlet miatti tiltást) lassan
  // figyeljük (2026-10-03, lelet 10): eddig ebben az állapotban a kártya csak
  // socket-eseményre frissült, és a sárga sáv akkor is új fizetésre
  // biztatott, amikor a háttér már lezárta a kísérletet.
  // W2 (2026-10-04): az egyeztetés alatti kísérletet is — a backend a kétes
  // kísérletet magától is lezárja (csak-olvasó MSGT33), nem csak az admin.
  const lassanFigyel = allapot === 'nyitott' || allapot === 'ellenorzes'
    || (!!tiltas && fp?.pay_blocked_reason === 'masik_kiserlet_folyamatban');
  useEffect(() => {
    if (!lassanFigyel) return;
    const kezdet = Date.now();
    let ora: ReturnType<typeof setTimeout> | null = null;
    const utemez = () => {
      if (Date.now() - kezdet >= NYITOTT_FIGYELES_MS) return;
      ora = setTimeout(() => { allapotBetoltes(); utemez(); }, LASSU_LEKERDEZES_MS);
    };
    utemez();
    return () => { if (ora) clearTimeout(ora); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lassanFigyel]);

  async function indit() {
    if (!betoltve || tiltas) return;
    if (!consent) {
      toast.error('Beleegyezés szükséges', 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.');
      return;
    }
    if (cibUt && !cibHozzajarulas) {
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
      // stub-út és a kupon (C4: a bankhoz semmi nem megy) kérése a régi.
      const r = cibUt ? await api.payJob(jobId, true, true) : await api.payJob(jobId, true);
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
      if (eletben.current) {
        setHiba(u);
        if ((e as { code?: string })?.code === 'CIB_CONSENT_REQUIRED') setCibKenyszer(true);
      }
      toast.error(u.cim, u.szoveg);
      if (u.teendo === 'allapot') await allapotBetoltes();
      if (u.teendo === 'fuvar') await onFrissites?.();
    } finally {
      clearTimeout(lassuOra);
      if (!elnavigal && eletben.current) setInditas('nincs');
    }
  }

  // Egységes ezres tagolás (UX A17): „1 000 Ft”, ahogy a díjkártya fejléce is.
  const fee = ft(feeHuf ?? 0);
  // can_pay=false mellett nincs gomb (lelet 25): a kattintás úgyis 409/503
  // lenne, és a hibaüzenet csak utólag mondaná el, amit előre tudunk.
  const gombLathato = !allapotMagyaraz && !tiltas;
  const foglalt = inditas !== 'nincs';
  const gombFelirat = !betoltve
    ? 'Betöltés…'
    : inditas === 'atiranyitas'
      ? 'Átirányítás a CIB Bankhoz…'
      : foglalt
        ? (cibUt ? 'Kapcsolódás a CIB Bankhoz…' : 'Fizetés indítása…')
        : kupon
          ? 'Ingyenes kapcsolatfelvétel (ajánlói jutalom)'
          : (cibUt ? `Fizetés bankkártyával (${fee} Ft)` : `Díj fizetése (${fee} Ft)`);
  // Minden szükséges nyilatkozat megvan: a 45/2014-es mindig, CIB-úton az
  // adattovábbítási hozzájárulás is (2026-10-01; kuponnál nem kell — C4).
  const nyilatkozatokMegvannak = consent && (!cibUt || cibHozzajarulas);
  const gombTiltva = !betoltve || foglalt || !nyilatkozatokMegvannak;
  // A letiltott gomb magyarázata (lelet 29): a disabled gombra kattintás nem
  // fut le, ezért a hiányzó nyilatkozatot a gomb mellett mondjuk el.
  const hianyId = useId();
  const hiany = betoltve && !foglalt ? nyilatkozatHiany({ consent, cibHozzajarulas, cibUt }) : null;

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
            Az eredményről itt és e-mailben is értesítünk.
          </p>
          {ellenorzesTrid && (
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              {CIB_FELIRATOK.trid}: <strong>{ellenorzesTrid}</strong>
            </p>
          )}
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            Kérdésed van? Írj nekünk a TrID-vel: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
          </p>
          <AllapotFrissites onClick={() => { allapotBetoltes(); }} />
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
          {/* 2026-10-04 (a PR-5 web 2. javítóköre): ha a lezárás elhúzódik
              (vagy nem kártyás úton jön), a kísérlet a bank oldalán is
              lehet — percekről beszélünk, nem másodpercekről. */}
          {lezarasElhuzodik ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
                <Hourglass size={18} aria-hidden /> <span>Egy korábbi fizetésed még folyamatban van</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>{folyamatbanSzoveg(oa?.started_at)}</p>
              {oa?.trid && (
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  {CIB_FELIRATOK.trid}: <strong>{oa.trid}</strong>
                </p>
              )}
              <AllapotFrissites onClick={() => { allapotBetoltes(); }} />
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
                <Hourglass size={18} aria-hidden /> <span>A fizetés lezárása folyamatban…</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>
                Egy fizetésed feldolgozása még tart. Ne indíts újat — pár másodperc múlva frissül az
                oldal; ha a fizetés sikerült, itt megnyílik a szállító elérhetősége.
              </p>
            </>
          )}
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
                <BankiTranzakcioAdatok adatok={lr} kimenet="sikeres" />
              </div>
            </details>
          )}
          {onFrissites ? (
            <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => { onFrissites(); }}>
              Oldal frissítése
            </button>
          ) : (
            <Link href={`/dashboard/fuvar/${jobId}#elerhetoseg`} className="btn" style={{ marginTop: 10 }}>
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
          {/* 2026-10-03 (lelet 10): a visszatért, de még nem ellenőrzött
              kísérletre ez a sáv eddig azt írta: „nyugodtan indíts újat" —
              az eredményoldal közben „A bank megerősíti a fizetést…"-et
              mutatott, és a második fizetés második zárolást tett a kártyára. */}
          {/* 2026-10-04 (2. javítókör): ha új fizetés most nem indítható
              (szünet, korlát, nem fizethető — a tiltás-doboz mondja el), a
              sáv nem biztat új fizetésre. */}
          <p style={{ margin: 0 }}>
            {nyitottSavSzoveg(oa.started_at, !tiltas, Date.now(), { szunetel: fp?.pay_blocked_reason === 'szunetel' })}
          </p>
        </div>
      )}

      {allapot === 'elozo_sikertelen' && mutassElozoEredmenyt && lr && (() => {
        // 2026-10-04 (a PR-5 web 2. javítóköre, BLOKKOLÓ): a visszatérített
        // kísérletnél a bank TERHELT — a „nem terheltük" itt hamis volna.
        const visszaterit = visszateritett(lr);
        const nemTerhelt = !visszaterit
          && (lr.allapot === 'nem_terhelt' || lr.allapot === 'mar_fizetve' || lr.allapot === 'not_closed');
        const u = ugyfelUzenet({ rc: lr.rc, rc_csoport: lr.rc_csoport });
        // C5 (2026-10-03, lelet 9): az admin-egyeztetés és a banki
        // visszafordítás saját, igaz okot kap.
        const nemTerheltSzoveg = lr.allapot === 'nem_terhelt'
          ? nemTerheltMagyarazat(lr.ok)
          : 'Nem terheltük a kártyádat; a zárolt összeget a bank feloldja (a kivonaton pár napig függő tételként látszhat).';
        const cim = visszaterit
          ? 'Az előző fizetésed díját visszatérítettük'
          : nemTerhelt ? 'Az előző fizetési kísérletet nem véglegesítettük' : 'Az előző fizetési kísérlet nem sikerült';
        return (
          <div
            style={{
              marginTop: 12, padding: 14, borderRadius: 8,
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.4)', color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
              {visszaterit ? <RotateCcw size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
              <span>{cim}</span>
            </div>
            {visszaterit ? (
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>{visszateritesMagyarazat()}</p>
            ) : nemTerhelt ? (
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>{nemTerheltSzoveg}</p>
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
                <BankiTranzakcioAdatok adatok={lr} kimenet={visszaterit ? 'visszateritve' : 'nem_terhelt'} />
              </div>
            </details>
            {gombLathato && (
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>Új fizetést azonnal indíthatsz — új tranzakcióként.</p>
            )}
          </div>
        );
      })()}

      {tiltas && (
        <div
          role="status"
          data-testid="dij-fizetes-tiltas"
          style={{
            marginTop: 12, padding: 14, borderRadius: 8,
            background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.5)', color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <Ban size={18} aria-hidden /> <span>{tiltas.cim}</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>{tiltas.szoveg}</p>
          {fp?.pay_blocked_reason === 'nem_fizetheto' && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => { allapotBetoltes(); onFrissites?.(); }}
            >
              Oldal frissítése
            </button>
          )}
        </div>
      )}

      {gombLathato && (
        <>
          {kupon && (
            <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '12px 0 0', fontSize: 14 }}>
              <Gift size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
              <span>
                Az ajánlói jutalmad fedezi a kapcsolatfelvételi díjat — bankkártyás fizetés és banki
                adattovábbítás nem történik.
              </span>
            </p>
          )}
          <FeeConsentLabel checked={consent} onChange={setConsent} zaroMondat={zaroMondat} />
          {cibUt && <CibAdatkezelesiNyilatkozat checked={cibHozzajarulas} onChange={setCibHozzajarulas} />}
          {cibUt && <CibFizetesInfo />}
          {cibUt && (
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0', lineHeight: 1.5 }}>{CIB_IDO_TIPP}</p>
          )}
          <button
            type="button"
            onClick={indit}
            disabled={gombTiltva}
            aria-describedby={hianyId}
            className="btn"
            style={{
              marginTop: 12,
              // 2026-10-08 (UX-átvizsgálás Q8): a fizetés a kártya FŐ gombja —
              // teljes szélesség, nagyobb méret; eddig ugyanakkora volt, mint a
              // „Másik szállítót választok" és a „Fuvar lemondása".
              width: '100%',
              minHeight: 48,
              fontSize: 16,
              padding: '12px 20px',
              // A .btn alapból nowrap — 390 px-en a kupon-felirat kilógna.
              whiteSpace: 'normal',
              background: nyilatkozatokMegvannak && betoltve ? 'var(--success-strong)' : 'var(--muted)',
              border: 'none',
              cursor: foglalt || !betoltve ? 'wait' : nyilatkozatokMegvannak ? 'pointer' : 'not-allowed',
              opacity: gombTiltva ? 0.7 : 1,
            }}
          >
            {kupon ? <Gift size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
            {gombFelirat}
          </button>
          {/* A hiányzó nyilatkozat neve — a tiltott gomb leírása (lelet 29). */}
          <p id={hianyId} aria-live="polite" className="muted" style={{ fontSize: 13, margin: hiany ? '8px 0 0' : 0 }}>
            {hiany}
          </p>
          {inditas === 'lassu' && (
            <p role="status" className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
              {cibUt ? 'A bank lassan válaszol, ne zárd be az oldalt.' : 'A szerver lassan válaszol, ne zárd be az oldalt.'}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            A díj ellenében azonnal megkapod a szállító telefonszámát, és
            indulhat a fuvar (fotós felvétel, átvételi kód, fotó-bizonyíték
            a lerakodáskor). A fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek.
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
