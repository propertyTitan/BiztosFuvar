'use client';

// =====================================================================
//  Átvételi PIN megjelenítő
//
//  2026-08-06, user-döntés: a QR kód KIKERÜLT. Csak a 6 jegyű PIN marad.
//  Indok: fölöslegesen bonyolította a folyamatot — és a QR technikailag
//  amúgy sem működött végig: olvasó SEHOL nem volt a rendszerben
//  (a `parseQrContent` helpert semmi nem hívta), a szállító mindig kézzel
//  gépelte be a kódot. A QR tehát dísz volt, ami két úton gondolkodtatta
//  el a felhasználót ott, ahol egy sem kellett volna.
//
//  Ez a komponens SZÍNES (gradiens) kártyán belül is jól olvasható marad:
//  a számot áttetsző panelre teszi, fehér betűvel — a régi QR-komponens
//  a `var(--text)`-et használta, ami a kék háttéren gyenge kontrasztot adott.
// =====================================================================

type Props = {
  /** A 6 jegyű kód. */
  code: string;
  /** Kis magyarázó sor a szám alatt. */
  hint?: string;
  /** Sötét/színes háttéren (alap) vagy világoson jelenik meg. */
  on?: 'dark' | 'light';
};

export default function DeliveryPin({ code, hint, on = 'dark' }: Props) {
  const sotet = on === 'dark';
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-block',
          padding: '14px 22px',
          borderRadius: 14,
          background: sotet ? 'rgba(255,255,255,0.16)' : 'rgba(37,99,235,0.10)',
          border: `1px solid ${sotet ? 'rgba(255,255,255,0.3)' : 'rgba(37,99,235,0.25)'}`,
        }}
      >
        <div
          style={{
            fontSize: 'clamp(32px, 9vw, 44px)',
            fontWeight: 800,
            // A tagolás miatt a szám telefonon is könnyen leolvasható/bediktálható
            letterSpacing: '0.18em',
            // A letter-spacing az utolsó jegy után is köz -> optikai középre húzás
            textIndent: '0.18em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: sotet ? '#fff' : 'var(--primary-text)',
            lineHeight: 1.1,
          }}
        >
          {code}
        </div>
      </div>
      {hint && (
        <div
          style={{
            fontSize: 13,
            marginTop: 10,
            opacity: sotet ? 0.9 : 1,
            color: sotet ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
