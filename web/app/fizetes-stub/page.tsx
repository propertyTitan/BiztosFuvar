'use client';

// STUB Barion fizetési oldal.
//
// Ez NEM a valódi Barion — egy in-app szimuláció, amit STUB módban
// (amikor nincs beállítva BARION_POS_KEY a backend-en) mutatunk,
// hogy a teljes UX flow végigjátszható legyen próba közben is.
//
// Elér oda: a `confirmed` státuszú foglalás / fuvar `barion_gateway_url`
// mezője `stub:payment/<id>` formátumú — a foglalásaim oldalon levő
// "Fizetés" gomb erre az oldalra navigál, query paraméterekkel átadva az
// összeget és a típust (booking / job).
//
// A "Fizetek most" gomb NEM hív backend-et: csak vizuálisan mutatja a
// sikert, majd visszaküldi a felhasználót. A valódi escrow felszabadítás
// a dropoff fotó pillanatában történik, nem itt.
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

type LoadedData = {
  title: string;
  amount: number;
  pickup: string;
  dropoff: string;
  back: string;
} | null;

export default function FizetesStub() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const bookingId = searchParams.get('booking');
  const jobId = searchParams.get('job');

  const [data, setData] = useState<LoadedData>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'review' | 'processing' | 'done'>('review');

  useEffect(() => {
    (async () => {
      try {
        if (bookingId) {
          const b = await api.getRouteBooking(bookingId);
          setData({
            title: b.route_title || 'Sofőri útvonal',
            amount: b.price_huf,
            pickup: b.pickup_address,
            dropoff: b.dropoff_address,
            back: '/dashboard/foglalasaim',
          });
        } else if (jobId) {
          const j = await api.getJob(jobId);
          setData({
            title: j.title,
            amount: j.accepted_price_huf || j.suggested_price_huf || 0,
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
    setStep('processing');
    // 1.5 másodperc "feldolgozás" – mint egy valódi Barion oldal
    await new Promise((r) => setTimeout(r, 1500));

    // STUB → itt mi magunk nyugtázzuk a backend-en a fizetést.
    // Valódi Barion esetén a /payments/barion/callback IPN hívja majd
    // ugyanezt a logikát. Mindkét fizetési flow-hoz (licites fuvar +
    // fix áras foglalás) tartozik confirm-payment endpoint, ami
    // beállítja a `paid_at`-ot és értesíti a sofőrt.
    try {
      if (bookingId) {
        await api.confirmRouteBookingPayment(bookingId);
      } else if (jobId) {
        await api.confirmJobPayment(jobId);
      }
    } catch (e: any) {
      toast.error('Fizetés nyugtázása sikertelen', e.message);
      setStep('review');
      return;
    }

    setStep('done');
    toast.success('Fizetés sikeres (STUB)', `${data?.amount.toLocaleString('hu-HU')} Ft lefoglalva`);
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
          background: 'linear-gradient(135deg, #0066ff 0%, #1e40af 100%)',
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
          <div style={{ color: 'var(--danger)', marginBottom: 16 }}>
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
                background: '#f1f5f9',
                borderRadius: 10,
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              <div className="muted" style={{ fontSize: 12 }}>FIZETENDŐ ÖSSZEG</div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: 'var(--primary)',
                  marginTop: 4,
                }}
              >
                {data.amount.toLocaleString('hu-HU')} Ft
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                background: '#fef3c7',
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
              style={{
                width: '100%',
                background: '#16a34a',
                padding: '14px 24px',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              💳 Fizetek most (STUB)
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
              {data.amount.toLocaleString('hu-HU')} Ft lefoglalva a Barion letétben
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Visszairányítás a foglalásaidhoz…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
