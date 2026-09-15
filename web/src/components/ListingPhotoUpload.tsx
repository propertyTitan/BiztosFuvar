'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';

type FailedPhoto = { file: File; message: string };

/** A fuvar ekkor már létezik: az újrapróbálás csak a hibás fotókat küldi. */
export default function ListingPhotoUpload({ jobId, photos, onContinue }: {
  jobId: string;
  photos: File[];
  onContinue: (uploaded: number) => void;
}) {
  const started = useRef(false);
  const busy = useRef(false);
  const [uploading, setUploading] = useState(true);
  const [uploaded, setUploaded] = useState(0);
  const [failed, setFailed] = useState<FailedPhoto[]>([]);
  const [progress, setProgress] = useState('');

  async function upload(files: File[], previousCount: number) {
    if (busy.current) return;
    busy.current = true;
    setUploading(true);
    const failures: FailedPhoto[] = [];
    let count = previousCount;
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Fotó feltöltése: ${index + 1} / ${files.length}…`);
        try {
          await api.uploadJobPhoto(jobId, file, 'listing');
          count++;
          setUploaded(count);
        } catch (error) {
          failures.push({ file, message: error instanceof Error ? error.message : 'A feltöltés nem sikerült.' });
        }
      }
      setFailed(failures);
      if (failures.length === 0) onContinue(count);
    } finally {
      busy.current = false;
      setUploading(false);
    }
  }

  useEffect(() => {
    // StrictMode effekt-újraindításkor sem indítunk második feltöltést.
    if (started.current) return;
    started.current = true;
    void upload(photos, 0);
    // A létrehozott fuvar és a kiválasztott képek ehhez a feltöltéshez tartoznak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h1>A fuvarod létrejött</h1>
      <p role="status">{uploaded} / {photos.length} fotó feltöltve.{uploading ? ` ${progress}` : ''}</p>
      {!uploading && failed.length > 0 && (
        <>
          <div role="alert">
            <p>{failed.length} fotó feltöltését nem sikerült visszaigazolni. A fuvarod már megjelent a listában.</p>
            <ul>{failed.map(({ file, message }, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}>{file.name}: {message}</li>)}</ul>
          </div>
          <p>Újrapróbálhatod ezeket a képeket, vagy továbbléphetsz a már feltöltött fotókkal. A lap bezárásával a még fel nem töltött képek elvesznek.</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <button type="button" className="btn" onClick={() => void upload(failed.map(f => f.file), uploaded)}>Sikertelen fotók újrapróbálása</button>
            <button type="button" className="btn btn-secondary" onClick={() => onContinue(uploaded)}>Tovább a fuvarhoz</button>
          </div>
        </>
      )}
    </div>
  );
}
