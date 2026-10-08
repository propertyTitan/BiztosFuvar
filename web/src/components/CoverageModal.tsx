'use client';

// =====================================================================
//  Szolgáltatási területen kívüli cím — tájékoztató ablak.
//  Az api.ts 403 + OUTSIDE_COVERAGE válaszra nyílik.
//
//  UX-review A29 (2026-10-08): valódi párbeszédablak a közös <Modal>
//  héjjal (role=dialog, Escape, fókuszcsapda, lucide X). A szöveg is
//  igazodott a valósághoz: a korábbi változat „Szeged/Debrecen/… —
//  hamarosan” címkéket mutatott (ezek MÁR elérhetők — a lefedettség
//  Európa-szintű), és egy „Feliratkozva! Értesítünk” visszajelzést adott
//  egy olyan e-mail-mezőre, amit sehova nem küldtünk el. Most csak azt
//  mondjuk, ami igaz, és hová lehet írni.
// =====================================================================

import { useEffect, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import Modal from '@/components/Modal';

export default function CoverageModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOutsideCoverage() {
      setOpen(true);
    }
    window.addEventListener('gofuvar:outside-coverage', onOutsideCoverage);
    return () => window.removeEventListener('gofuvar:outside-coverage', onOutsideCoverage);
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="lefedettseg-cim" zIndex={99990} maxWidth={440} closeButton>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 12, color: 'var(--primary)' }}>
          <MapPinOff size={48} aria-hidden />
        </div>
        <h2 id="lefedettseg-cim" style={{ marginTop: 0, marginBottom: 8, fontSize: 24 }}>
          Ez a cím a szolgáltatási területen kívül esik
        </h2>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
          A GoFuvar jelenleg <strong>Európa</strong> területén érhető el: a felvételi
          és a lerakodási címnek is európai címnek kell lennie. Ellenőrizd a címet,
          és válassz egy európai címet a legördülő listából.
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '12px 0 20px' }}>
          Ha szerinted ez tévedés, vagy szívesen használnád a GoFuvart máshol is,
          írj nekünk: <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
        </p>
        <button type="button" className="btn" onClick={() => setOpen(false)} style={{ minHeight: 44, minWidth: 160, justifyContent: 'center' }}>
          Rendben
        </button>
      </div>
    </Modal>
  );
}
