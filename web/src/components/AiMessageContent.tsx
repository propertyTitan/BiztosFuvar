'use client';

// Az AI segéd válaszainak megjelenítése kattintható belső linkekkel.
// A modell `[Felirat](/útvonal)` markdown-szintaxissal ad vissza linket;
// ezt itt parse-oljuk:
//   - belső útvonal (/-rel kezdődik)  → Next.js navigáció (router.push)
//   - külső http(s) link              → új lapon nyílik
//   - bármi más (pl. javascript:)     → sima szövegként jelenik meg (XSS-védelem)
import { useRouter } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';

// [label](target) – a target lehet belső út (/...) vagy http(s) URL
const LINK_RE = /\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g;

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  color: '#fff',
  background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
  padding: '4px 12px',
  borderRadius: 8,
  fontWeight: 600,
  textDecoration: 'none',
  margin: '2px 0',
  cursor: 'pointer',
};

export default function AiMessageContent({
  content,
  onNavigate,
}: {
  content: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const re = new RegExp(LINK_RE);
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{content.slice(lastIndex, match.index)}</Fragment>);
    }
    const label = match[1];
    const target = match[2];
    if (target.startsWith('/')) {
      nodes.push(
        <a
          key={key++}
          href={target}
          style={linkStyle}
          onClick={(e) => {
            e.preventDefault();
            onNavigate?.();
            router.push(target);
          }}
        >
          {label} →
        </a>,
      );
    } else {
      nodes.push(
        <a
          key={key++}
          href={target}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
        >
          {label} ↗
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(<Fragment key={key++}>{content.slice(lastIndex)}</Fragment>);
  }

  return <>{nodes}</>;
}
