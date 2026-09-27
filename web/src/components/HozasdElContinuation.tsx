'use client';

import { useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { hozasdElContinuation } from '@/lib/hozasdEl';

function useContinuation() {
  const user = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState<{ owner: string | null; title: string | null } | null>(null);
  const owner = user?.id ?? null;
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const continuation = hozasdElContinuation(owner);
    setSaved({ owner, title: continuation?.title ?? null });
  }, [mounted, owner]);
  const ready = mounted && saved !== null && saved.owner === owner;
  return { ready, continuation: ready && saved?.title ? saved : null };
}

export function HozasdElLoginHint() {
  const { continuation } = useContinuation();
  if (!continuation) return null;
  return <aside className="callout callout-info" aria-label="A megkezdett fuvarfeladás">
    <p style={{ margin: 0, fontSize: 14 }}><strong>A feladásod megmaradt: {continuation.title}</strong></p>
    <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6 }}>Belépés után ezzel folytatod. Új fióknál előbb az email címedet kell megerősítened; utána a hiányzó fuvaradatokat töltheted ki.</p>
  </aside>;
}

export function HozasdElVerifiedContinue() {
  const { ready, continuation } = useContinuation();
  const href = '/bejelentkezes?mode=login&email_verified=1'
    + (continuation ? '&next=%2Fdashboard%2Fuj-fuvar' : '');
  useEffect(() => {
    if (!ready) return;
    // A tárolt fiók/piszkozat beolvasását megvárjuk. Teljes navigációval
    // az EmailVerifyGate is friss profilt olvas, a tokenes URL pedig kikerül
    // az aktuális előzménybejegyzésből.
    window.location.replace(href);
  }, [ready, href]);
  if (!ready) return <p>Bejelentkezés megnyitása…</p>;
  return <>
    {continuation && <p style={{ color: 'var(--text)', fontSize: 14 }}>A félbehagyott feladásod: <strong>{continuation.title}</strong>. Belépés után folytathatod.</p>}
    <a href={href} className="btn"
      style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>
      Tovább a bejelentkezéshez →
    </a>
  </>;
}
