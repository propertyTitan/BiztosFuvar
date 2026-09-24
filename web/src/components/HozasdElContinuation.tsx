'use client';

import { useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { hozasdElContinuation } from '@/lib/hozasdEl';

function useContinuation() {
  const user = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState<{ owner: string | null; title: string } | null>(null);
  const owner = user?.id ?? null;
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const continuation = hozasdElContinuation(owner);
    setSaved(continuation ? { owner, title: continuation.title } : null);
  }, [mounted, owner]);
  return saved?.owner === owner ? saved : null;
}

export function HozasdElLoginHint() {
  const continuation = useContinuation();
  if (!continuation) return null;
  return <aside className="callout callout-info" aria-label="A megkezdett fuvarfeladás">
    <p style={{ margin: 0, fontSize: 14 }}><strong>A feladásod megmaradt: {continuation.title}</strong></p>
    <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6 }}>Belépés után ezzel folytatod. Új fióknál előbb az email címedet kell megerősítened; utána a hiányzó fuvaradatokat töltheted ki.</p>
  </aside>;
}

export function HozasdElVerifiedContinue() {
  const continuation = useContinuation();
  return <>
    {continuation && <p style={{ color: 'var(--text)', fontSize: 14 }}>A félbehagyott feladásod: <strong>{continuation.title}</strong>. Folytasd a hiányzó adatokkal.</p>}
    {/* Teljes navigációval az EmailVerifyGate is újraellenőrzi a profilt. */}
    <a href={continuation ? '/dashboard/uj-fuvar' : '/'} className="btn"
      style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>
      {continuation ? 'Folytatom a fuvarfeladást →' : 'Tovább az oldalra →'}
    </a>
  </>;
}
