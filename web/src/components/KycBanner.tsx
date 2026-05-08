'use client';

// KYC nudge banner web változat — paritás a mobile/src/components/KycBanner.tsx-szel.
//
// Önállóan tölti be a státuszt a `/kyc/me`-ből. Ha verified és a lejárat
// nem közelít → null-t renderel, így nyugodtan beilleszthető HomeHub és
// profil oldalra anélkül, hogy felül üresen megjelenne.
//
// Variantok:
//   - `compact`: 1-soros sáv, hub tetejére (Link → /profil/kyc)
//   - `card`:    nagyobb info-kártya, profil oldalra
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, KycMe } from '@/api';

type Variant = 'compact' | 'card';
type Tone = 'warn' | 'danger' | 'info' | 'success';

type Cta = {
  tone: Tone;
  emoji: string;
  title: string;
  body: string;
  action: string;
};

const EXPIRY_WARN_DAYS = 30;

function ctaFor(kyc: KycMe | null): Cta | null {
  if (!kyc) return null;
  const status = kyc.kyc_status;
  const docStatus = kyc.document?.status;

  if (status === 'verified') {
    if (kyc.license_expiry) {
      const days = Math.floor(
        (new Date(kyc.license_expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (days < 0) {
        return {
          tone: 'danger',
          emoji: '🚫',
          title: 'A jogosítványod lejárt',
          body: 'A licitálás letiltva, amíg fel nem töltesz egy érvényes jogosítványt.',
          action: 'Új jogosítvány feltöltése',
        };
      }
      if (days <= 7) {
        return {
          tone: 'danger',
          emoji: '🔴',
          title: `Jogosítványod ${days} napon belül lejár`,
          body: 'Ha nem frissíted, a lejárat napján automatikusan letiltjuk a licitálást.',
          action: 'Frissítés',
        };
      }
      if (days <= EXPIRY_WARN_DAYS) {
        return {
          tone: 'warn',
          emoji: '⚠️',
          title: `Jogosítványod ${days} napon belül lejár`,
          body: 'Érdemes hamarosan frissíteni, hogy ne álljon meg a licitálás.',
          action: 'Frissítés',
        };
      }
    }
    return null;
  }

  if (status === 'pending' || docStatus === 'pending') {
    return {
      tone: 'info',
      emoji: '⏳',
      title: 'Jogosítványod ellenőrzés alatt',
      body: 'Az adminok rövidesen átnézik. Erről értesítést is kapsz.',
      action: 'Részletek',
    };
  }

  if (docStatus === 'rejected') {
    return {
      tone: 'danger',
      emoji: '⚠️',
      title: 'A feltöltött jogosítvány elutasítva',
      body: kyc.document?.rejection_reason
        ? `Indok: ${kyc.document.rejection_reason}`
        : 'Kérjük tölts fel egy másik képet.',
      action: 'Új feltöltés',
    };
  }

  return {
    tone: 'warn',
    emoji: '🪪',
    title: 'Hitelesítsd magad',
    body: 'A licitáláshoz töltsd fel a jogosítványod fotóját. Kb. 1 perc.',
    action: 'Hitelesítés indítása',
  };
}

const TONE_BG: Record<Tone, string> = {
  warn:    '#FEF3C7',
  danger:  '#FEE2E2',
  info:    '#DBEAFE',
  success: '#DCFCE7',
};
const TONE_BORDER: Record<Tone, string> = {
  warn:    '#F59E0B',
  danger:  '#DC2626',
  info:    '#1E40AF',
  success: '#16A34A',
};
const TONE_TEXT: Record<Tone, string> = {
  warn:    '#92400E',
  danger:  '#991B1B',
  info:    '#1E3A8A',
  success: '#166534',
};

export default function KycBanner({ variant = 'compact' }: { variant?: Variant }) {
  const [kyc, setKyc] = useState<KycMe | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getKycStatus().then((r) => { setKyc(r); }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  const cta = ctaFor(kyc);
  if (!cta) return null;

  const bg = TONE_BG[cta.tone];
  const border = TONE_BORDER[cta.tone];
  const color = TONE_TEXT[cta.tone];

  if (variant === 'compact') {
    return (
      <Link
        href="/profil/kyc"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          background: bg,
          borderLeft: `4px solid ${border}`,
          borderRadius: 12,
          marginBottom: 16,
          textDecoration: 'none',
          color,
        }}
      >
        <div style={{ fontSize: 24 }}>{cta.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{cta.title}</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{cta.body}</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>→</div>
      </Link>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        color,
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 4 }}>{cta.emoji}</div>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{cta.title}</div>
      <div style={{ fontSize: 14, marginBottom: 12 }}>{cta.body}</div>
      <Link
        href="/profil/kyc"
        style={{
          display: 'inline-block',
          padding: '10px 16px',
          borderRadius: 8,
          background: border,
          color: '#fff',
          fontWeight: 800,
          fontSize: 14,
          textDecoration: 'none',
        }}
      >
        {cta.action} →
      </Link>
    </div>
  );
}
