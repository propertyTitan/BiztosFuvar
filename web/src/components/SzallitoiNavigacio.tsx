'use client';

// =====================================================================
//  SzallitoiNavigacio — egy koppintás a felvételi / lerakodási címhez
//  (UX Q06, 2026-10-08)
//
//  A szállító telefonról, vezetés előtt dolgozik: a pontos címet eddig csak
//  szövegként látta, be kellett másolnia a térképbe. Most: „Navigáció a
//  felvételhez" (felvétel előtt) / „Navigáció a lerakodáshoz" (úton) —
//  Google Maps a pontos koordinátára, mellette Waze, a cím másolása és a
//  címzett hívása. ⚠️ Csak a díj után renderelendő (előtte a cím
//  utca-szintű, a koordináta kerekített — a hívó dönt a paid_at alapján).
// =====================================================================
import { Copy, Navigation, Phone } from 'lucide-react';
import { googleNavigacio, wazeNavigacio } from '@/lib/terkepLinkek';
import { telefonFormaz, telefonHref } from '@/lib/telefon';
import { useToast } from '@/components/ToastProvider';

type Props = {
  cel: 'felvetel' | 'lerakodas';
  cim: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  cimzettTelefon?: string | null;
};

const kulso = { target: '_blank', rel: 'noopener noreferrer' } as const;

export default function SzallitoiNavigacio({ cel, cim, lat, lng, cimzettTelefon }: Props) {
  const toast = useToast();
  const google = googleNavigacio(lat, lng);
  const waze = wazeNavigacio(lat, lng);

  async function masol() {
    try {
      await navigator.clipboard.writeText(cim);
      toast.success('Cím másolva', cim);
    } catch {
      toast.error('Nem sikerült másolni', 'Jelöld ki a címet, és másold kézzel.');
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(22,163,74,0.30)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
        {cel === 'felvetel' ? 'Felvételi cím' : 'Lerakodási cím'}
      </div>
      <div style={{ fontSize: 14, marginBottom: 8, overflowWrap: 'anywhere' }}>{cim}</div>
      {google && (
        <a
          href={google}
          {...kulso}
          className="btn"
          style={{
            width: '100%', minHeight: 48, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Navigation size={18} aria-hidden /> {cel === 'felvetel' ? 'Navigáció a felvételhez' : 'Navigáció a lerakodáshoz'}
        </a>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {waze && (
          <a
            href={waze}
            {...kulso}
            className="btn btn-secondary"
            style={{ flex: '1 1 120px', minHeight: 44, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Navigation size={16} aria-hidden /> Waze
          </a>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={masol}
          style={{ flex: '1 1 120px', minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Copy size={16} aria-hidden /> Cím másolása
        </button>
        {cimzettTelefon && (
          <a
            href={telefonHref(cimzettTelefon)}
            className="btn btn-secondary"
            style={{ flex: '1 1 200px', minHeight: 44, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Phone size={16} aria-hidden /> Címzett hívása: {telefonFormaz(cimzettTelefon)}
          </a>
        )}
      </div>
    </div>
  );
}
