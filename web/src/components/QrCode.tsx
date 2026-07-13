'use client';

// =====================================================================
//  QR kód megjelenítő — valódi, beolvasható QR kód generálás.
//
//  Kliensoldalon a `qrcode` npm csomaggal rajzoljuk (a korábbi Google
//  Charts QR API 2019-ben leállt, törött képet adott).
//
//  A QR tartalom: gofuvar:deliver:<jobId>:<code>
//  A sofőr appja ezt parse-olja, és a kódot automatikusan elküldi.
// =====================================================================

import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

type Props = {
  jobId: string;
  deliveryCode: string;
  size?: number;
};

export default function QrCode({ jobId, deliveryCode, size = 220 }: Props) {
  const content = `gofuvar:deliver:${jobId}:${deliveryCode}`;
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toDataURL(content, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [content, size]);

  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-block',
          padding: 12,
          background: '#FFFFFF',
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="QR kód az átvételhez"
            width={size}
            height={size}
            style={{ display: 'block', imageRendering: 'pixelated' }}
          />
        ) : (
          <div
            aria-hidden
            style={{ width: size, height: size, background: '#F3F4F6', borderRadius: 8 }}
          />
        )}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: 6,
          fontFamily: 'monospace',
          color: 'var(--text)',
        }}
      >
        {deliveryCode}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Mutasd meg vagy diktáld be a sofőrnek a kódot
      </div>
    </div>
  );
}
