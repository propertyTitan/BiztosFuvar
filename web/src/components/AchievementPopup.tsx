'use client';

// =====================================================================
//  Achievement popup — megjelenik ha valami jó történt.
//  Slide-in animáció felülről, auto-hide 4 másodperc után.
// =====================================================================

import { useEffect, useState } from 'react';

type Props = {
  icon: string;
  title: string;
  subtitle?: string;
  visible: boolean;
  onHide?: () => void;
};

export default function AchievementPopup({ icon, title, subtitle, visible, onHide }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) { setShow(false); return; }
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      onHide?.();
    }, 4000);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <div
      style={{
        position: 'fixed',
        top: show ? 20 : -120,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99998,
        transition: 'top 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        pointerEvents: show ? 'auto' : 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 24px',
          borderRadius: 16,
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          border: '2px solid #FFD700',
          boxShadow: '0 8px 32px rgba(255, 215, 0, 0.3), 0 4px 16px rgba(0,0,0,0.4)',
          color: '#fff',
          minWidth: 280,
        }}
      >
        <span style={{ fontSize: 40, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
          {icon}
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
