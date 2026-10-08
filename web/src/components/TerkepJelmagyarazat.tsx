// =====================================================================
//  TerkepJelmagyarazat — a böngésző-térképek jelmagyarázata (UX A10)
//
//  Eddig „🟢 Felvétel · 🔴 Lerakodás · 🟡 Saját poszt" emoji-körökkel: az
//  emoji platformonként más színű és méretű, és nem a térkép jelölőinek
//  színét mutatta. Most ugyanazok a literál színek, mint a jelölőkön
//  (a Google Maps API CSS-változót nem ért — ott is hex áll).
// =====================================================================
export const TERKEP_SZINEK = {
  indulas: '#16a34a',
  cel: '#dc2626',
  sajat: '#facc15',
} as const;

type Elem = { szin: string; felirat: string };

export default function TerkepJelmagyarazat({ elemek }: { elemek: Elem[] }) {
  return (
    <p className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
      {elemek.map((e) => (
        <span key={e.felirat} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}>
          <span
            aria-hidden
            style={{
              width: 10, height: 10, borderRadius: '50%', background: e.szin,
              border: '1px solid rgba(0,0,0,0.2)', display: 'inline-block',
            }}
          />
          {e.felirat}
        </span>
      ))}
      <span>Kattints bármelyik jelölőre a részletekhez.</span>
    </p>
  );
}
