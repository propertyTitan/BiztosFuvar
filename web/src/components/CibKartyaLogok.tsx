// =====================================================================
//  CibKartyaLogok — a CIB Bank és a kártyatársaságok banki logóképe
//
//  2026-10-10 — a CIB írásos kérése a honlap-teszt után: a logók „nem
//  megfelelően szerepelnek", a „CIB_es_kartyalogok_85px_hrz_HU.png" vagy a
//  „CIB_es_kartyalogok_85px_vrt_HU.png" képet kell használni. Ez a komponens
//  váltja a korábbi, márkánként külön kirakott logókat (CibLogok.tsx —
//  törölve): széles képernyőn a vízszintes, 560 px alatt a függőleges
//  változat (<picture> + media query), fehér chipen (sötét témában is
//  olvasható), a forrásnál kisebb méretben (nincs felnagyítás), rögzített
//  képaránnyal (nincs elrendezés-ugrás).
//
//  A banki „Fejlesztési javaslatok" kísérőszövegei megmaradnak a kép felett:
//  „Kártyás fizetés szolgáltatója:" és „Elfogadott kártyák". A kép link: a
//  vásárlói tájékoztatóra (/bankkartyas-fizetes), a tájékoztató oldalon
//  magán pedig a bank honlapjára (`cel="cib"`) — a bank szerint a logó a
//  https://www.cib.hu/ vagy a vásárlói tájékoztató oldalra irányíthat.
//
//  Használja: a lábléc (SiteFooter), a fizetési kártya (CibFizetesInfo) és
//  a /bankkartyas-fizetes oldal.
// =====================================================================
import Link from 'next/link';
import { CIB_KARTYALOGOK_KEP as KEP } from '@/lib/kartyaLogok';
import { CIB_SZOLGALTATO_FELIRAT, ELFOGADOTT_KARTYAK_FELIRAT } from '@/lib/cibFeliratok';
import styles from './CibKartyaLogok.module.css';

type Props = {
  /** Hova visz a kép: a vásárlói tájékoztatóra (alap) vagy a bank honlapjára. */
  cel?: 'tajekoztato' | 'cib';
  igazitas?: 'bal' | 'kozep';
  /** Az oldal tetején álló kép azonnal töltődjön; egyébként (lábléc, fizetési
   *  kártya) lusta betöltés — a lábléc minden oldalon ott van. */
  azonnal?: boolean;
};

export default function CibKartyaLogok({ cel = 'tajekoztato', igazitas = 'bal', azonnal = false }: Props) {
  const kep = (
    <picture>
      <source
        media={KEP.keskenyMedia}
        srcSet={KEP.fuggoleges.src}
        width={KEP.fuggoleges.szel}
        height={KEP.fuggoleges.mag}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.kep}
        src={KEP.vizszintes.src}
        alt={KEP.alt}
        width={KEP.vizszintes.szel}
        height={KEP.vizszintes.mag}
        loading={azonnal ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
  return (
    <div
      data-testid="cib-kartyalogok"
      className={igazitas === 'kozep' ? `${styles.doboz} ${styles.kozep}` : styles.doboz}
    >
      <p className={styles.felirat}>
        <span>{CIB_SZOLGALTATO_FELIRAT}</span> CIB Bank Zrt. <span aria-hidden="true">·</span>{' '}
        <span>{ELFOGADOTT_KARTYAK_FELIRAT}</span>
      </p>
      {cel === 'cib' ? (
        <a href="https://www.cib.hu/" target="_blank" rel="noopener noreferrer" className={styles.chip}>{kep}</a>
      ) : (
        <Link href="/bankkartyas-fizetes" className={styles.chip}>{kep}</Link>
      )}
    </div>
  );
}
