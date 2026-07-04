'use client';
// KYC modal — progressziv onboarding gate.
// Globalisan triggereloodik: az api.ts 403 + KYC hibakod -> CustomEvent -> ez a modal megnyilik.

import { useEffect, useState, useRef } from 'react';
import { api } from '@/api';

type KycType = 'identity' | 'driver' | 'company' | null;

const CODE_TO_TYPE: Record<string, KycType> = {
  IDENTITY_KYC_REQUIRED: 'identity',
  DRIVER_KYC_REQUIRED: 'driver',
  COMPANY_KYC_REQUIRED: 'company',
};

const TYPE_TO_DOC: Record<string, string> = {
  identity: 'id_card',
  driver: 'drivers_license',
  company: 'company_document',
};

const TYPE_TITLES: Record<string, string> = {
  identity: 'Személyazonosság igazolása',
  driver: 'Sofőri dokumentumok',
  company: 'Céges verifikáció',
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  identity:
    'A platform biztonsága érdekében szükségünk van a személyazonosító dokumentumod feltöltésére. Ez biztosítja, hogy minden felhasználó valós személy legyen.',
  driver:
    'Sofőrként szükséges a jogosítványod feltöltése. Ez a felhasználók biztonságát szolgálja és igazolja, hogy érvényes jogosítvánnyal rendelkezel.',
  company:
    'Céges fiók használatához szükséges a cég igazoló dokumentumainak feltöltése (pl. cégkivonat, adóbejelentés). Ez biztosítja a céges tranzakciók hitelességét.',
};

export default function KycModal() {
  const [open, setOpen] = useState(false);
  const [kycType, setKycType] = useState<KycType>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<'verified' | 'rejected' | 'underage' | null>(null);
  const [aiReason, setAiReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKycRequired(e: Event) {
      const detail = (e as CustomEvent).detail;
      const code = detail?.code;
      const type = CODE_TO_TYPE[code] || null;
      if (type) {
        setKycType(type);
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

  function handleClose() {
    setOpen(false);
    setKycType(null);
    setFile(null);
    setUploadResult(null);
    setAiReason(null);
    setError(null);
  }

  async function handleUpload() {
    if (!file || !kycType) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      const res = await api.uploadKycDocument(file, TYPE_TO_DOC[kycType]);
      // A profil-oldal és a HomeHub KYC-kártyája ebből tudja, hogy a
      // státusz megváltozott — F5 nélkül frissülnek (stale UI fix)
      window.dispatchEvent(new Event('gofuvar:kyc-updated'));
      if (res.status === 'verified') {
        setUploadResult('verified');
        setTimeout(() => handleClose(), 2500);
      } else if (res.underage) {
        setUploadResult('underage' as any);
        setAiReason(res.ai_reason || 'A születési dátumod alapján 18 év alatti vagy.');
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
  }

  if (!open || !kycType) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          maxWidth: 480,
          width: '90%',
          position: 'relative',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          color: '#1a1a1a',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'none',
            border: 'none',
            fontSize: 22,
            cursor: 'pointer',
            color: '#666',
            lineHeight: 1,
            padding: 4,
          }}
          aria-label="Bezárás"
        >
          x
        </button>

        {/* Title */}
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>
          {TYPE_TITLES[kycType]}
        </h2>

        {/* Description */}
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.5, marginBottom: 20 }}>
          {TYPE_DESCRIPTIONS[kycType]}
        </p>

        {uploadResult === 'underage' ? (
          <div
            style={{
              background: 'var(--warning-light)',
              color: '#92400e',
              borderRadius: 8,
              padding: '16px 16px',
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <strong style={{ color: '#92400e' }}>Adminisztrátori jóváhagyásra vár</strong>
            <p style={{ margin: '8px 0 0', color: '#92400e' }}>
              A személyi igazolványodon szereplő születési dátum alapján
              a rendszer 18 év alatti felhasználót észlelt. Az adminisztrátorok
              értesítve lettek, és manuálisan ellenőrzik a dokumentumodat.
              Amíg a jóváhagyás meg nem történik, a platform funkciói korlátozottak.
            </p>
          </div>
        ) : uploadResult === 'verified' ? (
          <div
            style={{
              background: 'var(--success-light)',
              color: '#166534',
              borderRadius: 8,
              padding: '16px 16px',
              fontSize: 15,
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            ✅ Dokumentum elfogadva! Most már feladhatsz fuvart.
          </div>
        ) : uploadResult === 'rejected' ? (
          <div>
            <div
              style={{
                background: '#fef2f2',
                color: '#991b1b',
                borderRadius: 8,
                padding: '12px 16px',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              ❌ {aiReason || 'A dokumentum nem megfelelő.'}
            </div>
            <button
              type="button"
              onClick={resetForRetry}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 10,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Újra próbálom más képpel
            </button>
          </div>
        ) : (
          <>
            {/* File input */}
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 6,
                  color: '#333',
                }}
              >
                Dokumentum feltöltése
              </label>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  setError(null);
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                }}
              />
              {file && (
                <p style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 0 }}>
                  Kiválasztva: {file.name}
                </p>
              )}
            </div>

            {error && (
              <p style={{ color: 'var(--danger-text)', fontSize: 13, marginBottom: 12 }}>
                {error}
              </p>
            )}

            {/* Upload button */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 10,
                border: 'none',
                background: !file || uploading ? '#d1d5db' : '#2563eb',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: !file || uploading ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {uploading ? 'Feltöltés…' : 'Dokumentum feltöltése'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
