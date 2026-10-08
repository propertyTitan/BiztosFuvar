'use client';

// =====================================================================
//  KapcsolatKartya — a díj után megnyílt elérhetőség (UX Q06, 2026-10-08)
//
//  A feladó a telefonszámért fizetett, de az ~1600 px mélyen, tagolatlanul
//  és hívógomb nélkül jelent meg; a szállító a címet csak szövegként látta.
//  Most egy koppintás: teljes szélességű „Hívás: +36 30 555 1234" gomb
//  (tel:), „Üzenet" gomb (a chatre ugrik és fókuszál), e-mail link, és a
//  hívó a navigációs/szerepfüggő gombokat `children`-ként adja hozzá.
//
//  ⚠️ Csak paid_at után renderelhető — a díjkapu változatlan (a backend a
//  díj előtt a kontaktot ki sem adja; ez a kártya csak megjeleníti).
// =====================================================================
import type { ReactNode } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { telefonFormaz, telefonHref } from '@/lib/telefon';

type Props = {
  id?: string;
  /** A kártya címkéje: „A szállító elérhetősége" / „A feladó elérhetősége". */
  cimke: string;
  /** Egy mondat a teendőről. */
  bevezeto: ReactNode;
  nev?: string | null;
  telefon?: string | null;
  email?: string | null;
  /** A chat-blokk id-je — az „Üzenet" gomb oda ugrik. */
  uzenetCel?: string;
  /** A hívógomb felirata (alap: „Hívás"); a szám utána áll. */
  hivasFelirat?: string;
  children?: ReactNode;
};

export default function KapcsolatKartya({
  id, cimke, bevezeto, nev, telefon, email, uzenetCel, hivasFelirat = 'Hívás', children,
}: Props) {
  const cimkeId = id ? `${id}-cim` : undefined;

  function uzenethez() {
    if (!uzenetCel) return;
    const cel = document.getElementById(uzenetCel);
    if (!cel) return;
    cel.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    cel.querySelector<HTMLElement>('textarea, input:not([type="hidden"])')?.focus({ preventScroll: true });
  }

  return (
    <section
      id={id}
      aria-labelledby={cimkeId}
      className="card"
      style={{
        marginTop: 16,
        background: 'rgba(22,163,74,0.08)',
        border: '1px solid rgba(22,163,74,0.40)',
        scrollMarginTop: 80,
      }}
    >
      <h2
        id={cimkeId}
        style={{
          margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: 0.6,
          textTransform: 'uppercase', color: 'var(--success-text)',
        }}
      >
        {cimke}
      </h2>
      <p style={{ margin: '6px 0 10px', fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>{bevezeto}</p>
      {nev && <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{nev}</div>}

      {telefon && (
        <a
          href={telefonHref(telefon)}
          className="btn"
          data-testid="kapcsolat-hivas"
          style={{
            width: '100%', minHeight: 48, fontSize: 16, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Phone size={18} aria-hidden /> {hivasFelirat}: {telefonFormaz(telefon)}
        </a>
      )}

      {(uzenetCel || email) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {uzenetCel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={uzenethez}
              style={{ flex: '1 1 140px', minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <MessageCircle size={16} aria-hidden /> Üzenet
            </button>
          )}
          {email && (
            <a
              href={`mailto:${email}`}
              className="btn btn-secondary"
              style={{
                flex: '1 1 200px', minHeight: 44, textDecoration: 'none', minWidth: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Mail size={16} aria-hidden />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
            </a>
          )}
        </div>
      )}

      {children}
    </section>
  );
}
