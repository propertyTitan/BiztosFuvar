// "Hozasd el" — online vásárlásból induló fuvar (SEO-barát szerver-oldal).
// A tényleges interaktív eszköz a HozasdElTool kliens-komponens.
import type { Metadata } from 'next';
import HozasdElTool from '@/components/HozasdElTool';

export const metadata: Metadata = {
  title: 'Hozasd el az online vásárlásod — GoFuvar',
  description:
    'Jófogáson, Vaterán vagy Facebook Marketplace-en vásároltál bútort vagy nagyobb tárgyat? Másold be a hirdetés linkjét, és a GoFuvar sofőrjei elhozzák — biztonságos letét, élő követés, fotó + 6 jegyű átvételi kód.',
  keywords: [
    'jófogás szállítás', 'vatera szállítás', 'marketplace szállítás',
    'bútorszállítás', 'használt bútor elszállítás', 'online vásárlás fuvar', 'GoFuvar',
  ],
  openGraph: {
    title: 'Vettél valamit online? Hozasd el — GoFuvar',
    description: 'Másold be a hirdetés linkjét, és egy sofőr elhozza. Biztonságos, gyakran olcsóbb, mint egy futárszolgálat.',
    type: 'website',
    locale: 'hu_HU',
  },
};

export default function HozasdElPage() {
  return <HozasdElTool />;
}
