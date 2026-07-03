'use client';

// STUB Barion fizetési oldal — KAPCSOLATFELVÉTELI DÍJ.
//
// Ez NEM a valódi Barion — egy in-app szimuláció, amit STUB módban
// (amikor nincs beállítva BARION_POS_KEY a backend-en) mutatunk,
// hogy a teljes UX flow végigjátszható legyen próba közben is.
//
// Készpénzes modell (2026-07-03): itt NEM a fuvardíjat fizeti a feladó,
// hanem a sávos kapcsolatfelvételi díjat. A fizetéshez KÖTELEZŐ a
// beleegyező checkbox (45/2014. Korm. r. 29. § (1) a)): a feladó kéri
// az azonnali teljesítést (kontakt-átadás) és tudomásul veszi, hogy a
// teljesítés után elállási joga elvész.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

type LoadedData = {
  title: string;
  feeHuf: number;
  cashHuf: number;
  pickup: string;
  dropoff: string;
  back: string;
} | null;

function FizetesStubContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const bookingId = searchParams.get('booking');
  const jobId = searchParams.get('job');

  const [data, setData] = useState<LoadedData>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<'review' | 'processing' | 'done'>('review');

  useEffect(() => {
    (async () => {
      try {
        if (bookingId) {
          const b = await api.getRouteBooking(bookingId);
          setData({
            title: b.route_title || 'Sofőri útvonal',
            feeHuf: b.connection_fee_huf || 0,
            cashHuf: b.price_huf,
            pickup: b.pickup_address,
            dropoff: b.dropoff_address,
            back: '/dashboard/foglalasaim',
          });
        } else if (jobId) {
          const j = await api.getJob(jobId);
          setData({
            title: j.title,
            feeHuf: j.connection_fee_huf || 0,
            cashHuf: j.accepted_price_huf || j.suggested_price_huf || 0,
            pickup: j.pickup_address,
            dropoff: j.dropoff_address,
            back: `/dashboard/fuvar/${jobId}`,
          });
        } else {
          setError('Hiányzó azonosító');
        }
      } catch (err: any) {
        setError(err.message);
      }
    })();
  }, [bookingId, jobId]);

  async function pay() {
    if (!consent) {
      toast.error('Beleegyezés szükséges', 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.');
      return;
    }
    setStep('processing');
    // 1.5 másodperc "feldolgozás" – mint egy valódi Barion oldal
    await new Promise((r) => setTimeout(r, 1500));

    // STUB → itt mi magunk nyugtázzuk a backend-en a fizetést.
    // Valódi Barion esetén a /payments/barion/callback IPN hívja majd
    // ugyanezt a logikát. A consent kötelezően megy a backendnek — az
    // menti a fee_consent_at időbélyeget (jogi bizonyíték).
    try {
      if (bookingId) {
        await api.confirmRouteBookingPayment(bookingId, consent);
      } else if (jobId) {
        await api.confirmJobPayment(jobId, consent);
      }
    } catch (e: any) {
      toast.error('Fizetés nyugtázása sikertelen', e.message);
      setStep('review');
      return;
    }

    setStep('done');
    toast.success('Fizetés sikeres (STUB)', `${data?.feeHuf.toLocaleString('hu-HU')} Ft kapcsolatfelvételi díj`);
    // 2 másodperc múlva visszatérünk a foglalásaim oldalra
    setTimeout(() => {
      if (data?.back) router.push(data.back);
    }, 2000);
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '32px 16px',
        minHeight: '60vh',
      }}
    >
      {/* Barion-stílusú header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0066ff 0%, var(--primary) 100%)',
          color: '#fff',
          padding: '20px 24px',
          borderRadius: '16px 16px 0 0',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
          }}
        >
          💳
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Barion fizetés</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>STUB – teszt mód</div>
        </div>
      </div>

      <div
        className="card"
        style={{
          borderRadius: '0 0 16px 16px',
          borderTop: 'none',
          padding: 24,
          marginTop: 0,
        }}
      >
        {error && (
          <div style={{ color: 'var(--danger-text)', marginBottom: 16 }}>
            Hiba: {error}
          </div>
        )}

        {!data && !error && <p>Betöltés…</p>}

        {data && step === 'review' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>FUVAR</div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{data.title}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>CÍMEK</div>
              <div>📍 {data.pickup}</div>
              <div>🏁 {data.dropoff}</div>
            </div>

            <div
              style={{
                padding: '16px 20px',
                background: 'var(--bg)',
                borderRadius: 10,
                marginBottom: 12,
                textAlign: 'center',
              }}
            >
              <div className="muted" style={{ fontSize: 12 }}>
                KAPCSOLATFELVÉTELI DÍJ (bevezető ár)
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: 'var(--primary-text)',
                  marginTop: 4,
                }}
              >
                {data.feeHuf.toLocaleString('hu-HU')} Ft
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                A díj ellenében azonnal megkapod a sofőr elérhetőségét, és
                elindul a fuvar-folyamat (SMS-ek, átvételi kód, fotó-bizonyíték).
              </div>
            </div>

            <div
              style={{
                fontSize: 13,
                background: 'var(--bg)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              💵 A fuvardíjat (
              <strong>{data.cashHuf.toLocaleString('hu-HU')} Ft</strong>
              ) NEM itt fizeted: azt <strong>készpénzben</strong> adod át a
              sofőrnek.
            </div>

            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border)',
                marginBottom: 12,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <span>
                Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása){' '}
                <strong>azonnali teljesítését</strong>, és tudomásul veszem,
                hogy a teljesítés után <strong>elállási jogomat elvesztem</strong>{' '}
                (45/2014. Korm. rendelet 29. § (1) a)). A díj nem
                visszatérítendő; ha a fuvar a sofőr hibájából hiúsul meg,
                díjmentesen választhatok másik sofőrt ugyanerre a fuvarra.
              </span>
            </label>

            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                background: 'var(--warning-light)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              ⚠️ Ez egy STUB fizetési oldal — valódi Barion kapu jön majd, ha a
              <code style={{ fontFamily: 'monospace' }}> BARION_POS_KEY</code>{' '}
              be lesz állítva a backend-en. Mostani kattintás csak szimulálja az
              élményt.
            </div>

            <button
              type="button"
              className="btn"
              onClick={pay}
              disabled={!consent}
              style={{
                width: '100%',
                background: consent ? 'var(--success-strong)' : 'var(--muted)',
                padding: '14px 24px',
                fontSize: 16,
                fontWeight: 700,
                opacity: consent ? 1 : 0.6,
                cursor: consent ? 'pointer' : 'not-allowed',
              }}
            >
              Fizetek most (STUB)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.back()}
              style={{ width: '100%', marginTop: 8 }}
            >
              Mégse
            </button>
          </>
        )}

        {data && step === 'processing' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <div style={{ fontWeight: 700 }}>Fizetés feldolgozása…</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              (kapcsolat a Barionnal szimulálva)
            </div>
          </div>
        )}

        {data && step === 'done' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Sikeres fizetés!</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 8 }}>
              {data.feeHuf.toLocaleString('hu-HU')} Ft kapcsolatfelvételi díj
              megfizetve — a sofőr elérhetősége mostantól látható
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Visszairányítás…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FizetesStub() {
  return (
    <Suspense fallback={null}>
      <FizetesStubContent />
    </Suspense>
  );
}
