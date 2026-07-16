// "Hozasd el" — online vásárlásból induló fuvar (SEO-barát szerver-oldal).
// A tényleges interaktív eszköz a HozasdElTool kliens-komponens.
import type { Metadata } from 'next';
import HozasdElTool from '@/components/HozasdElTool';

export const metadata: Metadata = {
  title: 'Hozasd el az online vásárlásod — GoFuvar',
  description:
    'IKEA-ban, OBI-ban, Praktikerben vagy a Jófogáson vásároltál bútort vagy nagyobb tárgyat? Másold be a termék linkjét, és a GoFuvar szállítójai elhozzák — készpénzes fizetés a szállítónak, fotó bizonyíték + 6 jegyű átvételi kód.',
  keywords: [
    'ikea szállítás', 'obi szállítás', 'praktiker szállítás', 'jófogás szállítás',
    'bútorszállítás', 'használt bútor elszállítás', 'online vásárlás fuvar', 'GoFuvar',
  ],
  openGraph: {
    title: 'Vettél valamit online? Hozasd el — GoFuvar',
    description: 'Másold be a termék linkjét (IKEA, OBI, Praktiker, Jófogás), és egy szállító elhozza. Biztonságos, és a szállítók versenye miatt gyakran kedvező áron.',
    type: 'website',
    locale: 'hu_HU',
  },
};

export default function HozasdElPage() {
  return <HozasdElTool />;
}
