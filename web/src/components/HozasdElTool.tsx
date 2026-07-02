'use client';

// "Hozasd el" — online vásárlásból induló fuvarfeladás.
// A felhasználó bemásol egy IKEA / OBI / Praktiker / Jófogás terméklinket,
// élő előnézetet kap (kép + cím), és egy kattintással a feladás-flow-ba lép,
// ahol a cím és a forrás-link már elő van töltve.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, ArrowRight, Check, ShoppingBag, Leaf, ShieldCheck } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

type Preview = {
  ok: boolean; source: string; url: string;
  title?: string | null; image?: string | null; description?: string | null;
};

export default function HozasdElTool() {
  const router = useRouter();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function loadPreview() {
    const u = url.trim();
    if (!u) return;
    setLoading(true);
    setPreview(null);
    try {
      const p = await api.linkPreview(u);
      setPreview(p);
    } catch (e: any) {
      toast.error('Nem támogatott link', e.message || 'IKEA, OBI, Praktiker vagy Jófogás linket tudunk feldolgozni.');
    } finally {
      setLoading(false);
    }
  }

  function continueToPost() {
    // A feladás-flow a sessionStorage-ből előtölti a címet + forrás-linket.
    const payload = {
      title: preview?.title || '',
      sourceUrl: preview?.url || url.trim(),
      sourceName: preview?.source || 'hirdetés',
      description: preview?.description || '',
      image: preview?.image || '',
    };
    try { sessionStorage.setItem('gofuvar_prefill', JSON.stringify(payload)); } catch {}
    router.push('/dashboard/uj-fuvar');
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px' }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '40px 0 24px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16,
          background: 'var(--primary-subtle)', color: 'var(--primary)',
          padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
          border: '1px solid var(--primary-light)',
        }}>
          <ShoppingBag size={15} /> Online vásárlásból
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: 900, letterSpacing: '-0.8px', margin: '0 auto 12px', maxWidth: 560 }}>
          Vettél valamit online? <span style={{ color: 'var(--primary)' }}>Hozasd el.</span>
        </h1>
        <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: 'var(--text-secondary)', maxWidth: 540, margin: '0 auto', lineHeight: 1.5 }}>
          Bútort, gépet, nagyobb tárgyat vettél az IKEA-ban, OBI-ban, Praktikerben
          vagy a Jófogáson? Másold be a termék linkjét — a többit elintézzük.
        </p>
      </section>

      {/* Beillesztő eszköz */}
      <div className="card">
        <label style={{ marginTop: 0 }}>Hirdetés linkje</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Link2 size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadPreview(); }}
              placeholder="https://www.ikea.com/hu/hu/p/..."
              style={{ paddingLeft: 36, marginTop: 0 }}
              inputMode="url"
            />
          </div>
          <button className="btn" onClick={loadPreview} disabled={loading || !url.trim()}>
            {loading ? 'Betöltés…' : 'Előnézet'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Támogatott: IKEA · OBI · Praktiker · Jófogás
        </p>

        {/* Előnézet */}
        {preview && (
          <div className="callout callout-info" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
              {preview.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.image}
                  alt=""
                  style={{ width: 110, height: 110, objectFit: 'cover', flexShrink: 0, background: 'var(--surface-hover)' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div style={{ padding: 14, flex: 1, minWidth: 0 }}>
                <span className="pill pill-bidding" style={{ fontSize: 11 }}>{preview.source}</span>
                <div style={{ fontWeight: 700, marginTop: 8 }}>
                  {preview.title || 'Hirdetés (cím nem tölthető be automatikusan)'}
                </div>
                {!preview.ok && (
                  <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                    A részleteket nem tudtuk automatikusan beolvasni (pl. bejelentkezést kérő oldal), de a linket megőrizzük — a feladásnál pár adatot kézzel kell megadnod.
                  </p>
                )}
              </div>
            </div>
            <div style={{ padding: 14, borderTop: '1px solid var(--border)', textAlign: 'right' }}>
              <button className="btn" onClick={continueToPost}>
                Folytatom a feladást <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Miért jó */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
        {[
          { icon: ShieldCheck, tint: 'var(--success)', title: 'Biztonságos', desc: 'A fuvardíj letétben, fotó + 6 jegyű kód az átvételhez.' },
          { icon: Leaf, tint: 'var(--success)', title: 'Zöld és olcsóbb', desc: 'Gyakran olyan sofőr viszi, aki amúgy is arra megy.' },
          { icon: Check, tint: 'var(--primary)', title: 'Pár perc', desc: 'A link beillesztése után pár kattintás az egész.' },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="card" style={{ marginBottom: 0 }}>
              <Icon size={22} color={f.tint} strokeWidth={2.2} />
              <div style={{ fontWeight: 700, marginTop: 8 }}>{f.title}</div>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{f.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
