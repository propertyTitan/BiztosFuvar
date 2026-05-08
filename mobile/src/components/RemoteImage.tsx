// `<RemoteImage fileId>` — privát file-rendszerből töltött kép.
//
// A backend egy rövid lejáratú (5 perc) signed URL-t ad ki a fileId-hoz.
// A komponens ezt kéri le, majd egy hagyományos <Image>-be írja.
// Ha a fileId null/undefined, a `fallback` prop renderel.
//
// Cache: a kép URL-jét (és a megjelenítést) nem cacheljük, mert a token
// úgyis lejár. A natív Image saját diszk-cache-e tartja a bytes-okat —
// erre nem támaszkodunk, csak bonus.
import { useEffect, useState } from 'react';
import { Image, ActivityIndicator, View, ImageStyle, StyleProp } from 'react-native';
import { api, fullFileUrl } from '@/api';

type Props = {
  fileId: string | null | undefined;
  /** Régi, plain URL-es record-okhoz — ha file_id null, ezt használjuk. */
  fallbackUrl?: string | null;
  style?: StyleProp<ImageStyle>;
  fallback?: React.ReactNode;
};

export default function RemoteImage({ fileId, fallbackUrl, style, fallback }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);

    if (fileId) {
      setLoading(true);
      api.getFileUrl(fileId)
        .then((r) => {
          if (!cancelled) setUri(fullFileUrl(r.url));
        })
        .catch(() => {
          // hibára nem renderelünk semmit — a fallback prop megy
          if (!cancelled) setUri(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (fallbackUrl) {
      // Régi adat backward-compat — a régi URL-eket még megjeleníti, amíg
      // a backfill / re-upload nem futott le. Élesben a publikus bucket
      // kikapcsolása után ezek 404-elnek, és a fallback-jelvény látszik.
      setUri(fallbackUrl);
    }

    return () => { cancelled = true; };
  }, [fileId, fallbackUrl]);

  if (uri) {
    return <Image source={{ uri }} style={style} />;
  }

  if (loading) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, style as any]}>
        <ActivityIndicator />
      </View>
    );
  }

  return <>{fallback || null}</>;
}
