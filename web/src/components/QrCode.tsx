'use client';

// =====================================================================
//  QR kód megjelenítő — valódi, beolvasható QR kód generálás.
//
//  Külső dependency nélkül: a QR kód SVG-t a szerver generálja,
//  VAGY a kliens oldalon a canvas API-val rajzoljuk a tartalom hash-éből.
//
//  Mivel npm csomag nélkül dolgozunk, egy Google Charts QR API-t
//  használunk fallback-ként (ingyenes, publikus, max 300×300 px).
//
//  A QR tartalom: gofuvar:deliver:<jobId>:<code>
//  A sofőr appja ezt parse-olja, és a kódot automatikusan elküldi.
// =====================================================================

type Props = {
  jobId: string;
  deliveryCode: string;
  size?: number;
};

export default function QrCode({ jobId, deliveryCode, size = 220 }: Props) {
  const content = `gofuvar:deliver:${jobId}:${deliveryCode}`;
  const encoded = encodeURIComponent(content);

  // Google Charts QR API — megbízható, gyors, valódi QR
  const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encoded}&choe=UTF-8&chld=M|2`;

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
        <img
          src={qrUrl}
          alt="QR kód az átvételhez"
          width={size}
          height={size}
          style={{ display: 'block', imageRendering: 'pixelated' }}
        />
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: 6,
          fontFamily: 'monospace',
          color: 'var(--text)',
        }}
      >
        {deliveryCode}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Mutasd meg a sofőrnek — olvassa be az appban, vagy diktáld a kódot
      </div>
    </div>
  );
}
