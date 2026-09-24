'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Link2, ShoppingBag, Sofa } from 'lucide-react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { DIJ_SAVOK, DIJ_SAVHATAR_HUF, ft } from '@/lib/connectionFee';
import { clearHozasdEl, emptyHozasdElDraft, HOZASD_EL_DRAFT, HOZASD_EL_PREFILL,
  readHozasdEl, safeProductImage, saveHozasdEl, type HozasdElAddress } from '@/lib/hozasdEl';
import AddressAutocomplete from './AddressAutocomplete';
import styles from './HozasdElTool.module.css';

export default function HozasdElTool({ furniture = false }: { furniture?: boolean }) {
  const router = useRouter();
  const me = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyHozasdElDraft);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addressErrors, setAddressErrors] = useState({ pickup: '', dropoff: '' });
  const requestId = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const owner = me?.id ?? null;
  const ownerKey = owner ?? 'guest';

  useEffect(() => {
    setMounted(true);
    return () => { requestId.current += 1; };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    requestId.current += 1;
    setLoading(false);
    setDraft(readHozasdEl(HOZASD_EL_DRAFT, owner) ?? emptyHozasdElDraft());
    setRestoredFor(ownerKey);
  }, [mounted, owner, ownerKey]);

  useEffect(() => {
    if (restoredFor !== ownerKey) return;
    if (draft.url || draft.title || draft.ready) saveHozasdEl(HOZASD_EL_DRAFT, draft, owner);
    else clearHozasdEl(HOZASD_EL_DRAFT);
  }, [draft, owner, ownerKey, restoredFor]);

  async function loadPreview(e: React.FormEvent) {
    e.preventDefault();
    const url = draft.url.trim();
    if (!url || loading) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const p = await api.linkPreview(url);
      if (currentRequest !== requestId.current) return;
      setDraft(d => ({ ...d, url: p.url, title: (p.title || '').slice(0, 120),
        description: (p.description || '').slice(0, 500), image: safeProductImage(p.image),
        sourceName: p.source, ready: true, manual: false }));
    } catch (err: any) {
      if (currentRequest === requestId.current) {
        setError(`${err?.message || 'Az előnézet most nem tölthető be.'} Próbáld újra, vagy add meg a tárgyat link nélkül.`);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  function startManual() {
    requestId.current += 1;
    setLoading(false);
    setError('');
    setDraft(d => ({ ...d, ready: true, manual: true, sourceName: '', image: '', description: '' }));
  }

  function continueToPost(e: React.FormEvent) {
    e.preventDefault();
    if (loading || restoredFor !== ownerKey) return;
    setError('');
    if (!draft.title.trim()) {
      setError('Add meg, mit szeretnél elhozatni.');
      titleInput.current?.focus();
      return;
    }
    // Az ismeretlen linket nem másoljuk a leírásba. A kézi út csak a tárgy
    // adatait viszi tovább; a meglévő kontakt-szűrő változatlan marad.
    const payload = { ...draft, title: draft.title.trim(), url: draft.manual ? '' : draft.url,
      kind: furniture ? 'furniture' as const : 'general' as const };
    if (!saveHozasdEl(HOZASD_EL_PREFILL, payload, owner)) {
      setError('A böngésző nem tudta megőrizni az adatokat. Engedélyezd a webhelyadatok tárolását, majd próbáld újra. Az űrlapod itt megmaradt.');
      return;
    }
    const next = '/dashboard/uj-fuvar';
    router.push(me ? next : `/bejelentkezes?mode=register&next=${encodeURIComponent(next)}`);
  }

  function changeAddress(which: 'pickup' | 'dropoff', value: HozasdElAddress) {
    setAddressErrors(prev => ({ ...prev, [which]: '' }));
    setDraft(d => ({ ...d, [which]: value }));
  }

  const EntryIcon = furniture ? Sofa : ShoppingBag;
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}><EntryIcon size={17} aria-hidden="true" /> {furniture ? 'Bútorvásárláshoz' : 'Online vásárláshoz'}</span>
        <h1>{furniture ? 'Megvan a bútor, de nincs mivel elhozni?' : 'Megtaláltad a jó vételt, de nincs mivel elhozni?'} <span>Hozasd el.</span></h1>
        <p>{furniture
          ? 'Kanapé a Jófogásról, szekrény az IKEA-ból? Kezdd el a szállítás feladását a hirdetés linkjével vagy a bútor megadásával.'
          : 'Kérj szállítási ajánlatokat bútorra, háztartási gépre vagy más nagyobb tárgyra. Kezdd a hirdetés linkjével, akár vásárlás előtt.'}</p>
        <p className={styles.free}><Check size={16} aria-hidden="true" /> Ingyenes feladás és ajánlatok · Te választod a szállítót</p>
      </section>

      <ol className={styles.steps} aria-label="A feladás lépései">
        <li><span>1</span> Mit hozass el?</li><li><span>2</span> Honnan, hová?</li><li><span>3</span> Feladás</li>
      </ol>

      <section className="card" aria-labelledby="hozasd-product-heading">
        <h2 id="hozasd-product-heading" className={styles.heading}>Mit szeretnél elhozatni?</h2>
        <form onSubmit={loadPreview}>
          <label htmlFor="hozasd-url">Hirdetés vagy termék linkje</label>
          <div className={styles.linkRow}>
            <div className={styles.linkInput}>
              <Link2 size={17} aria-hidden="true" />
              <input id="hozasd-url" className="input" inputMode="url" type="url" maxLength={2048}
                disabled={!mounted || restoredFor !== ownerKey}
                placeholder="https://www.ikea.com/hu/hu/p/..." aria-describedby="hozasd-sources"
                value={draft.url} onChange={e => {
                  requestId.current += 1;
                  setLoading(false);
                  setError('');
                  setDraft(d => ({ ...d, url: e.target.value, ready: false, manual: false,
                    title: '', description: '', image: '', sourceName: '' }));
                }} />
            </div>
            <button className="btn" type="submit" disabled={!mounted || restoredFor !== ownerKey || loading || !draft.url.trim()}>
              {loading ? 'Betöltés…' : 'Előnézet'}
            </button>
          </div>
          <p id="hozasd-sources" className={styles.help}>Automatikus előnézet: IKEA · OBI · Praktiker · Jófogás</p>
          <div role="status" aria-live="polite">{loading && <p className={styles.help}>Megpróbáljuk betölteni a termék nevét és képét…</p>}</div>
        </form>
        <button type="button" className="btn btn-secondary" onClick={startManual} disabled={!mounted || restoredFor !== ownerKey}>Link nélkül adom meg</button>
        <p className={styles.help}>Facebook Marketplace-en találtad? Add meg a tárgyat kézzel, a fotót a feladásnál tudod feltölteni.</p>

        {draft.ready && <form onSubmit={continueToPost} noValidate className={styles.details}
          onKeyDown={e => {
            // A címtalálat Enterrel kiválasztása ne küldje tovább az űrlapot.
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
          }}>
          {!draft.manual && <div className={styles.preview} role="status">
            {draft.image && /* eslint-disable-next-line @next/next/no-img-element */
              <img key={draft.image} src={draft.image} alt="A hirdetés termékképe" referrerPolicy="no-referrer"
                onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <div><span className="pill pill-bidding">{draft.sourceName}</span>
              <p>{draft.title || 'A termék neve nem olvasható be. Alább kézzel megadhatod.'}</p>
              <p className={styles.help}>Az elérhető adatokat továbbvisszük a feladásba. A méretet és az átvétel részleteit ellenőrizd az eladóval.</p>
            </div>
          </div>}
          <label htmlFor="hozasd-title">A szállítandó tárgy</label>
          <input ref={titleInput} id="hozasd-title" className="input" required maxLength={120}
            placeholder={furniture ? 'Pl. kétszemélyes kanapé' : 'Pl. könyvespolc vagy mosógép'}
            value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          <h2 className={styles.heading}>Honnan, hová?</h2>
          <p className={styles.help}>Ha már tudod a címeket, add meg most. A hiányzó adatokat a következő lépésben is kitöltheted.</p>
          <div className={styles.addresses}>
            {(['pickup', 'dropoff'] as const).map(which => <div key={which}>
              <AddressAutocomplete label={which === 'pickup' ? 'Felvétel címe' : 'Érkezés címe'}
                placeholder={which === 'pickup' ? 'pl. Budapest, Váci út 1.' : 'pl. Szeged, Kossuth Lajos sugárút 1.'}
                value={draft[which].address} requirePrecise
                onChange={(address, lat, lng) => changeAddress(which, { address, lat, lng, confirmed: true })}
                onTextChange={address => changeAddress(which, { address, lat: null, lng: null, confirmed: false })}
                onImprecise={message => setAddressErrors(prev => ({ ...prev, [which]: message }))} />
              {addressErrors[which] && <p className={styles.help} role="status">{addressErrors[which]}</p>}
            </div>)}
          </div>
          <p className={styles.help}>{me
            ? 'A következő lépésben ellenőrizheted az adatokat, megadhatod a méretet és feladhatod a fuvart.'
            : 'A folytatáshoz ingyenes fiók kell. A belépés vagy regisztráció után ezekkel az adatokkal folytatod a feladást, ugyanebben a böngészőfülben.'}</p>
          <button type="submit" disabled={loading || restoredFor !== ownerKey} className={`btn ${styles.continue}`}>Folytatom a feladást <ArrowRight size={18} aria-hidden="true" /></button>
        </form>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>

      <section className={styles.explanation} aria-labelledby="hozasd-how-heading">
        <h2 id="hozasd-how-heading" className={styles.heading}>Mi történik a feladás után?</h2>
        <p>A szállítók ajánlatot tehetnek a fuvarodra. Összehasonlítod az árakat és az értékeléseket, majd kiválasztod a neked megfelelő ajánlatot.</p>
        <p>Elfogadáskor a GoFuvar kapcsolatfelvételi díja bruttó <strong>{ft(DIJ_SAVOK[0].dijHuf)} Ft {ft(DIJ_SAVHATAR_HUF)} Ft fuvardíjig, felette {ft(DIJ_SAVOK[1].dijHuf)} Ft</strong> (bevezető ár). A fuvardíjat ezen felül, közvetlenül a szállítónak fizeted. <Link href="/aszf">Díjfizetési feltételek</Link></p>
        <p>Az áru megvásárlását és az átvételi időpontot te egyezteted az eladóval. {furniture && 'Kérdezz rá a bútor méretére, szétszerelhetőségére, az emeletre és a liftre is. '}A fuvarfeladásnál jelezheted, ha pakolási segítségre van szükség.</p>
        {!furniture && <Link href="/hozasd-el/butor">Bútort vásárolsz? Kezdd itt a szállítást →</Link>}
        {furniture && <Link href="/hozasd-el">Más tárgyat hozatnál el? →</Link>}
      </section>
    </div>
  );
}
