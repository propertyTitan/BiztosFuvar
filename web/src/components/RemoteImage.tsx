'use client';

// `<RemoteImage fileId>` — privát file-rendszerből töltött kép web-en.
// A backend signed URL-t ad vissza (5 perces token), az <img src> ezt
// használja. Ha fileId null, a `fallbackUrl`-t (régi avatar_url) próbáljuk,
// különben a `placeholder` renderel.
import { useEffect, useState } from 'react';
import { api } from '@/api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Props = {
  fileId?: string | null;
  fallbackUrl?: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: React.ReactNode;
};

export default function RemoteImage({
  fileId,
  fallbackUrl,
  alt = '',
  className,
  style,
  placeholder,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (fileId) {
      api.getFileUrl(fileId)
        .then((r) => { if (!cancelled) setSrc(`${BASE_URL}${r.url}`); })
        .catch(() => { if (!cancelled) setSrc(null); });
    } else if (fallbackUrl) {
      // Régi adat backward-compat (R2 publikus mód kikapcsolva → ezek 404-elnek
      // élesben, és a placeholder látszik).
      const full = fallbackUrl.startsWith('http') || fallbackUrl.startsWith('data:')
        ? fallbackUrl
        : `${BASE_URL}${fallbackUrl.startsWith('/') ? '' : '/'}${fallbackUrl}`;
      setSrc(full);
    }
    return () => { cancelled = true; };
  }, [fileId, fallbackUrl]);

  if (!src) return <>{placeholder || null}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={style} />;
}
