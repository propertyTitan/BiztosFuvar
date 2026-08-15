'use client';

// TESZT fizetési oldal — KAPCSOLATFELVÉTELI DÍJ.
//
// ⚠️ 2026-08-09: az oldalról eltűnt a Barion-branding. A Barion 2026-08-09-én
// VÉGLEG törölve a kódból (a launch fizetése a CIB vPOS), az oldal viszont
// egy meg nem lévő szolgáltató nevét mutatta a felhasználónak — épp a
// fizetés pillanatában, ami a legrosszabb hely egy hiteltelen részletnek.
//
// Ez NEM valódi fizetés — in-app szimuláció, amit stub módban
// (amikor nincs beállítva BARION_POS_KEY a backend-en) mutatunk,
// hogy a teljes UX flow végigjátszható legyen próba közben is.
//
// Készpénzes modell (2026-07-03): itt NEM a fuvardíjat fizeti a feladó,
// hanem a sávos kapcsolatfelvételi díjat. A 45/2014. 29. § (1) a) szerinti
// beleegyező nyilatkozatot a feladó MÁR a fizetés indításakor megtette
// (a /pay rögzítette a fee_consent_at-ot) — itt, a „fizetőoldalon" csak
// emlékeztetjük rá, ahogy élesben is a redirect előtt nyilatkozik.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import TesztFizetesSav from '@/components/TesztFizetesSav';

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
  const [step, setStep] = useState<'review' | 'processing' | 'done' | 'unavailable'>('review');

  useEffect(() => {
    (async () => {
      try {
        if (bookingId) {
          const b = await api.getRouteBooking(bookingId);
          setData({
            title: b.route_title || 'Szállítói útvonal',
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
    setStep('processing');
    // 1,5 másodperc „feldolgozás" – mint egy valódi fizetőoldal
    await new Promise((r) => setTimeout(r, 1500));

    // Stub módban itt mi magunk nyugtázzuk a backenden a fizetést. Éles
    // szolgáltatóval ezt a PSP callbackje végzi (/payments/cib/callback). A
    // beleegyezés (fee_consent_at) már a fizetés indításakor rögzült.
    // ⚠️ ÉLES futásban a backend ezt a kézi nyugtázást SZÁNDÉKOSAN elutasítja
    // (409) — különben bárki fizetés nélkül „fizetettnek" jelölhetné a saját
    // fuvarát. Ilyenkor nem hibát mutatunk, hanem elmondjuk, mi a helyzet.
    try {
      if (bookingId) {
        await api.confirmRouteBookingPayment(bookingId);
      } else if (jobId) {
        await api.confirmJobPayment(jobId);
      }
    } catch (e: any) {
      // A backend 409-et ad, ha éles környezetben nincs bekötve fizetési
      // szolgáltató. Ez nem a felhasználó hibája, és nem is „sikertelen
      // fizetés" — a szolgáltatás egyszerűen még nem él.
      if (/automatikusan|szolgáltat/i.test(e.message || '')) {
        setStep('unavailable');
        return;
      }
      toast.error('A fizetés nem indult el', e.message);
      setStep('review');
      return;
    }

    setStep('done');
    toast.success('Fizetés sikeres (teszt)', `${data?.feeHuf.toLocaleString('hu-HU')} Ft kapcsolatfelvételi díj`);
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
      <TesztFizetesSav />
      {/* Fizetőoldal fejléce (provider-semleges) */}
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
            fontSize: 24,
          }}
        >
          💳
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Bankkártyás fizetés</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Teszt mód — valódi terhelés nincs</div>
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
              <div style={{ fontSize: 18, fontWeight: 700 }}>{data.title}</div>
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
                A díj ellenében azonnal megkapod a szállító elérhetőségét, és
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
              szállítónak.
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border)',
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              ℹ️ A fizetés indításakor nyilatkoztál: kérted a szolgáltatás
              (kapcsolatfelvételi adatok átadása) azonnali teljesítését, és
              tudomásul vetted, hogy a teljesítés után elállási jogod elvész
              (45/2014. Korm. r. 29. § (1) a)). A díj nem visszatérítendő.
            </div>

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
              ⚠️ Ez egy <strong>teszt fizetőoldal</strong>: valódi terhelés nem
              történik. A bankkártyás fizetés a szolgáltatói szerződés
              élesítése után indul — addig a gomb csak a folyamatot mutatja be.
            </div>

            <button
              type="button"
              className="btn"
              onClick={pay}
              style={{
                width: '100%',
                background: 'var(--success-strong)',
                padding: '14px 24px',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              Fizetek most (teszt)
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
              (a fizetési szolgáltató kapcsolata szimulálva)
            </div>
          </div>
        )}

        {data && step === 'done' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Sikeres fizetés!</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 8 }}>
              {data.feeHuf.toLocaleString('hu-HU')} Ft kapcsolatfelvételi díj
              megfizetve — a szállító elérhetősége mostantól látható
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
