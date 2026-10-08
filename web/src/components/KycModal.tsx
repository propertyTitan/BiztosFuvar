'use client';
// KYC modal — progresszív onboarding-kapu.
// Globálisan nyílik: az api.ts 403 + KYC hibakód → CustomEvent → ez az ablak.
//
// UX-review A29 (2026-10-08): valódi párbeszédablak a közös <Modal> héjjal
// (role=dialog, Escape, fókuszcsapda, lucide X); mobilon „Fotó készítése” és
// „Választás a galériából”, utána bélyegkép-előnézet (az elmosódott fotó
// újrapróbálkozást vagy admin-munkát jelent — az előnézet ezt megelőzi);
// a sikerszöveg az ajánlattételről szól (a feladáshoz nem kell okmány), és
// megmondjuk, hol és meddig tároljuk a fotót. Lakcímkártyát továbbra sem kérünk.

import { useEffect, useState, useRef } from 'react';
import {
  Camera, Image as ImageIcon, AlertTriangle, Hourglass, CheckCircle2, XCircle, Lock,
} from 'lucide-react';
import { api } from '@/api';
import Modal from '@/components/Modal';

// A backend imageSniff által támogatott raszteres formátumok.
const KYC_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/gif'];
const KYC_MAX_BYTES = 15 * 1024 * 1024;

type KycType = 'identity' | 'driver' | 'company' | null;

const CODE_TO_TYPE: Record<string, KycType> = {
  IDENTITY_KYC_REQUIRED: 'identity',
  DRIVER_KYC_REQUIRED: 'driver',
  COMPANY_KYC_REQUIRED: 'company',
};

const TYPE_TO_DOC: Record<string, string> = {
  identity: 'id_card',
  // A szállítónak is a személyi igazolvány elég (2026-07-07); a backend csak
  // az 'id_card' típust fogadja — a régi 'drivers_license' 400-at kapott volna.
  driver: 'id_card',
  company: 'company_document',
};

const TYPE_TITLES: Record<string, string> = {
  identity: 'Személyazonosság igazolása',
  driver: 'Szállítói dokumentumok',
  company: 'Céges verifikáció',
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  identity:
    'A platform biztonsága érdekében szükségünk van a személyazonosító dokumentumod feltöltésére. Ez biztosítja, hogy minden felhasználó valós személy legyen.',
  // ⚠️ 2026-08-11: a jogosítvány- és a cégkivonat-szöveg TÖRÖLVE. Egyiket sem
  // kérjük (a jogosítvány 2026-07-07, a céges dokumentum 2026-07-05 óta nem
  // követelmény), és a backend `validTypes` listája sem fogadja már el őket.
  // Egy nem kért okmányt kérő felület a felhasználót fölösleges adatközlésre
  // biztatja — ez adat-minimalizálási hiba, akkor is, ha a flow nem éri el.
  driver:
    'Szállítóként a személyi igazolványod elegendő — jogosítvány nem szükséges. Ez biztosítja, hogy minden szállító valós személy legyen.',
  company:
    'Céges fióknál az adószámot a NAV nyilvántartásából ellenőrizzük — dokumentumot nem kell feltöltened.',
};

// A tárolás valós szabálya (privát R2-bucket, nyilvános URL nélkül; a döntés
// után 30 nappal a napi purgeOldKycFiles kör törli — CLAUDE.md, KYC retention).
export const KYC_TAROLAS_SZOVEG = 'A fotót nem nyilvános, titkosított tárhelyen tartjuk, és a döntés után 30 nappal töröljük.';

// Rejtett, de nem display:none fájlmező — egyes mobil böngészők a
// display:none mezőn a programozott megnyitást nem engedik.
const REJTETT_MEZO = {
  position: 'absolute' as const, width: 1, height: 1, opacity: 0,
  overflow: 'hidden' as const, clipPath: 'inset(50%)',
};

const gombStilus = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  flex: '1 1 160px', minHeight: 44,
};

export default function KycModal() {
  const [open, setOpen] = useState(false);
  const [kycType, setKycType] = useState<KycType>(null);
  // Honnan nyílt: a főoldali felhívásból nincs félbehagyott ajánlat.
  const [forras, setForras] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [elonezet, setElonezet] = useState<string | null>(null);
  const [elonezetHiba, setElonezetHiba] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<'verified' | 'rejected' | 'underage' | 'pending' | null>(null);
  const [aiReason, setAiReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [erintos, setErintos] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const kameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKycRequired(e: Event) {
      const detail = (e as CustomEvent).detail;
      const code = detail?.code;
      const type = CODE_TO_TYPE[code] || null;
      if (type) {
        setKycType(type);
        setForras(typeof detail?.forras === 'string' ? detail.forras : null);
        setOpen(true);
        setFile(null);
        setUploadResult(null);
        setAiReason(null);
        setError(null);
      }
    }
    window.addEventListener('gofuvar:kyc-required', onKycRequired);
    return () => window.removeEventListener('gofuvar:kyc-required', onKycRequired);
  }, []);

  // Érintőképernyőn két gomb (kamera + galéria); egérrel egy választó elég —
  // asztali gépen a „Fotó készítése” is csak a fájlválasztót nyitná.
  useEffect(() => {
    try {
      setErintos(typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
    } catch { setErintos(false); }
  }, []);

  // Bélyegkép a kiválasztott fotóról (és felszabadítás csere/bezárás után).
  useEffect(() => {
    setElonezetHiba(false);
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setElonezet(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setElonezet(url);
    return () => { URL.revokeObjectURL?.(url); };
  }, [file]);

  function handleClose() {
    setOpen(false);
    setKycType(null);
    setFile(null);
    setUploadResult(null);
    setAiReason(null);
    setError(null);
  }

  function fajlValasztva(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    if (f && (!KYC_IMAGE_TYPES.includes(f.type) || f.size > KYC_MAX_BYTES || f.size === 0)) {
      setFile(null);
      setError(!KYC_IMAGE_TYPES.includes(f.type)
        ? 'Képfájlt válassz (JPG, PNG, WebP, HEIC/HEIF, AVIF vagy GIF). PDF nem tölthető fel.'
        : f.size === 0 ? 'A kiválasztott fájl üres.' : 'A kép legfeljebb 15 MB lehet.');
      e.target.value = '';
      return;
    }
    setFile(f);
    setError(null);
  }

  async function handleUpload() {
    if (!file || !kycType) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      const res = await api.uploadKycDocument(file, TYPE_TO_DOC[kycType]);
      // A profil-oldal, a HomeHub és az ajánlattételi sáv ebből tudja, hogy a
      // státusz megváltozott — F5 nélkül frissülnek (stale UI fix). A
      // profil-cache-t is ürítjük, különben a 15 mp-es cache a régi státuszt adná.
      api.invalidateMyProfile?.();
      window.dispatchEvent(new Event('gofuvar:kyc-updated'));
      if (res.status === 'verified') {
        // Nincs automatikus bezárás: a felhasználó maga lép vissza (az időzített
        // eltűnés felolvasóval és lassú olvasóknak is elveszett).
        setUploadResult('verified');
      } else if (res.underage) {
        setUploadResult('underage');
        setAiReason(res.ai_reason || 'A születési dátumod alapján 18 év alatti vagy.');
      } else if (res.status === 'pending') {
        // Kézi (admin) ellenőrzésre került — NEM elutasítás. Eddig ez az ág
        // is „A dokumentum nem felel meg, próbáld újra" üzenetet kapott, ami
        // fölösleges újrapróbálkozásra késztette a felhasználót.
        setUploadResult('pending');
        setAiReason(res.ai_reason || 'A dokumentumodat kollégánk ellenőrzi.');
      } else {
        setUploadResult('rejected');
        setAiReason(res.ai_reason || 'A dokumentum nem felel meg. Kérjük próbáld újra.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function resetForRetry() {
    setFile(null);
    setUploadResult(null);
    setAiReason(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
    if (kameraRef.current) kameraRef.current.value = '';
  }

  if (!open || !kycType) return null;

  const allapotDoboz = {
    borderRadius: 8, padding: 16, fontSize: 14, textAlign: 'center' as const, lineHeight: 1.6,
  };

  return (
    <Modal open onClose={handleClose} labelledBy="kyc-cim" zIndex={99990} maxWidth={480} closeButton>
      <h2 id="kyc-cim" style={{ marginTop: 0, marginBottom: 8, marginRight: 40, fontSize: 20, fontWeight: 700 }}>
        {TYPE_TITLES[kycType]}
      </h2>

      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
        {TYPE_DESCRIPTIONS[kycType]}
      </p>

      {uploadResult === 'underage' ? (
        <div role="status" style={{ ...allapotDoboz, background: 'rgba(245,158,11,0.14)', border: '1px solid var(--warning)' }}>
          <AlertTriangle size={32} aria-hidden style={{ marginBottom: 8 }} />
          <div><strong>Adminisztrátori jóváhagyásra vár</strong></div>
          <p style={{ margin: '8px 0 0' }}>
            A személyi igazolványodon szereplő születési dátum alapján
            a rendszer 18 év alatti felhasználót észlelt. Az adminisztrátorok
            értesítve lettek, és manuálisan ellenőrzik a dokumentumodat.
            Amíg a jóváhagyás meg nem történik, a platform funkciói korlátozottak.
          </p>
        </div>
      ) : uploadResult === 'pending' ? (
        <div role="status" style={{ ...allapotDoboz, background: 'rgba(245,158,11,0.14)', border: '1px solid var(--warning)' }}>
          <Hourglass size={32} aria-hidden style={{ marginBottom: 8 }} />
          <div><strong>Ellenőrzés alatt</strong></div>
          <p style={{ margin: '8px 0 0' }}>
            {aiReason || 'A dokumentumodat kollégánk ellenőrzi.'}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Nem kell újra feltöltened — értesítést kapsz, amint megvan a döntés.
          </p>
        </div>
      ) : uploadResult === 'verified' ? (
        <div>
          <div role="status" style={{ ...allapotDoboz, background: 'rgba(22,163,74,0.12)', border: '1px solid var(--success)', fontSize: 16, fontWeight: 700 }}>
            <CheckCircle2 size={32} aria-hidden color="var(--success-text)" style={{ marginBottom: 8 }} />
            <div>Elfogadva! Most már tehetsz ajánlatot.</div>
          </div>
          <button type="button" className="btn" onClick={handleClose} style={{ width: '100%', justifyContent: 'center', marginTop: 16, minHeight: 44 }}>
            {forras === 'fooldal' ? 'Rendben' : 'Vissza az ajánlathoz'}
          </button>
        </div>
      ) : uploadResult === 'rejected' ? (
        <div>
          <div
            role="alert"
            style={{
              background: 'rgba(220,38,38,0.10)', border: '1px solid var(--danger)', borderRadius: 8,
              padding: '12px 16px', fontSize: 14, fontWeight: 600, marginBottom: 16,
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}
          >
            <XCircle size={18} aria-hidden color="var(--danger-text)" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{aiReason || 'A dokumentum nem megfelelő.'}</span>
          </div>
          <button type="button" className="btn" onClick={resetForRetry} style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}>
            Újra próbálom más képpel
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <span
              id="kyc-feltoltes-cim"
              style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
            >
              Dokumentum feltöltése
            </span>
            {/* Előellenőrző tippek (2026-09-11, teljes audit B2): az
                elutasítások zöme rossz fotó (tükröződés, levágott sarok,
                lakcímkártya) — előre megmondjuk, mi kell. */}
            <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <li>Személyi igazolvány <strong>elülső oldala</strong> — lakcímkártyát <strong>ne</strong> tölts fel.</li>
              <li>Jó fényben, tükröződés és vaku nélkül, éles kép.</li>
              <li>Mind a négy sarok látszódjon, a szöveg olvasható legyen.</li>
              <li>Az igazolványon lévő név egyezzen a profilod nevével.</li>
            </ul>

            {elonezet && file ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {!elonezetHiba ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={elonezet}
                    alt="A kiválasztott okmányfotó előnézete"
                    onError={() => setElonezetHiba(true)}
                    style={{
                      width: 160, maxWidth: '100%', height: 104, objectFit: 'cover',
                      borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 13 }}>Kiválasztva: <strong>{file.name}</strong></span>
                )}
                <button type="button" className="btn btn-secondary" onClick={resetForRetry} style={{ minHeight: 44 }}>
                  Másik fotó
                </button>
              </div>
            ) : (
              <div
                role="group"
                aria-labelledby="kyc-feltoltes-cim"
                aria-describedby="kyc-fajl-formatum kyc-fajl-hiba"
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
              >
                {erintos && (
                  <button type="button" className="btn" onClick={() => kameraRef.current?.click()} style={gombStilus}>
                    <Camera size={18} aria-hidden /> Fotó készítése
                  </button>
                )}
                <button
                  type="button"
                  className={erintos ? 'btn btn-secondary' : 'btn'}
                  onClick={() => inputRef.current?.click()}
                  style={gombStilus}
                >
                  <ImageIcon size={18} aria-hidden /> {erintos ? 'Választás a galériából' : 'Kép kiválasztása'}
                </button>
              </div>
            )}
            <input
              id="kyc-kamera"
              ref={kameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              tabIndex={-1}
              aria-label="Okmányfotó készítése kamerával"
              onChange={fajlValasztva}
              style={REJTETT_MEZO}
            />
            <input
              id="kyc-dokumentum"
              ref={inputRef}
              type="file"
              accept={KYC_IMAGE_TYPES.join(',')}
              tabIndex={-1}
              aria-label="Okmányfotó kiválasztása"
              aria-invalid={Boolean(error)}
              onChange={fajlValasztva}
              style={REJTETT_MEZO}
            />
            <p id="kyc-fajl-formatum" style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--muted)' }}>
              JPG, PNG, WebP, HEIC/HEIF, AVIF vagy GIF, legfeljebb 15 MB. PDF helyett az igazolvány fotóját válaszd.
            </p>
            <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Lock size={13} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} /> {KYC_TAROLAS_SZOVEG}
            </p>
          </div>

          {error && (
            <p id="kyc-fajl-hiba" role="alert" style={{ color: 'var(--danger-text)', fontSize: 13, marginBottom: 12 }}>
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn"
            onClick={handleUpload}
            disabled={!file || uploading}
            style={{ width: '100%', justifyContent: 'center', minHeight: 44, opacity: !file || uploading ? 0.55 : 1, cursor: !file || uploading ? 'not-allowed' : 'pointer' }}
          >
            {uploading ? 'Feltöltés…' : 'Dokumentum feltöltése'}
          </button>
        </>
      )}
    </Modal>
  );
}
