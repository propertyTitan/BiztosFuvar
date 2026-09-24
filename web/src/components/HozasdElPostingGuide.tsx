'use client';

import type { HozasdElKind } from '@/lib/hozasdEl';
import styles from './HozasdElPostingGuide.module.css';

export default function HozasdElPostingGuide({ title, image, source, kind, isInstant, addressesReady, parcelReady, priceReady }: {
  title: string; image: string | null; source: string | null; kind: HozasdElKind;
  isInstant: boolean;
  addressesReady: boolean; parcelReady: boolean; priceReady: boolean;
}) {
  const steps = [
    { href: '#fuvar-felvetel', label: 'Pontos címek és átvétel', ready: addressesReady },
    { href: '#fuvar-meretek', label: 'Méret és súly', ready: parcelReady },
    { href: '#fuvar-fuvardij', label: isInstant ? 'Fix fuvardíj' : 'Javasolt fuvardíj', ready: priceReady },
  ];
  const firstMissing = steps.findIndex(step => !step.ready);
  return <section className={`card ${styles.guide}`} aria-labelledby="hozasd-guide-heading">
    <div className={styles.product}>
      {image && /* eslint-disable-next-line @next/next/no-img-element */
        <img key={image} src={image} alt="A hirdetésből átvett termékkép" referrerPolicy="no-referrer"
          onError={e => { e.currentTarget.style.display = 'none'; }} />}
      <div>
        <h2 id="hozasd-guide-heading">Ezzel a tárggyal folytatod</h2>
        <p className={styles.title}>{title.trim() || 'Add meg a tárgy megnevezését'}</p>
        <p className={styles.help}>{source ? `${source} · ` : ''}A Hozasd el adatait betöltöttük. Alább mindent ellenőrizhetsz és szerkeszthetsz.</p>
      </div>
    </div>
    <nav aria-label="A fuvarfeladás kitöltendő részei">
      <ol className={styles.steps}>{steps.map((step, index) => <li key={step.href}>
        <a href={step.href} aria-current={index === firstMissing ? 'step' : undefined}>
          <span aria-hidden="true">{step.ready ? '✓' : index + 1}</span>
          {step.label}<small>{step.ready ? 'Megadva' : 'Kitöltendő'}</small>
        </a>
      </li>)}</ol>
    </nav>
    <p className={styles.help}>Az űrlap végén a „Fuvar feladása” gombbal teszed közzé a kérést. {isInstant
      ? 'Fix díjas fuvarnál a szállító az általad megadott áron vállalhatja el a szállítást.'
      : 'Ez még nem foglalás: a szállítók ajánlatai közül később választasz.'}</p>
    {kind === 'furniture' && <details className={styles.tips}>
      <summary>Mit egyeztessek az eladóval a bútorról?</summary>
      <ul>
        <li>Összeszerelve vagy szétszerelve adják át? A szállításra előkészített állapot méretét és súlyát kérd el.</li>
        <li>Hány darabból vagy csomagból áll? Több darab méreteit és darabszámát a részletes leírásban is add meg.</li>
        <li>Mikor lehet átvenni, melyik emeleten van, és befér-e a liftbe vagy lépcsőházba?</li>
        <li>Ki segít a pakolásban a két címen? Ha a szállítótól kérsz segítséget, jelöld az alábbi cipelési mezőkben.</li>
        <li>A vásárlást és az eladónak járó vételárat külön egyeztesd; itt a szállításra kérsz ajánlatot.</li>
      </ul>
    </details>}
  </section>;
}
