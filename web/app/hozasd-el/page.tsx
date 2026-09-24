// "Hozasd el" — online vásárlásból induló fuvar (SEO-barát szerver-oldal).
// A tényleges interaktív eszköz a HozasdElTool kliens-komponens.
import type { Metadata } from 'next';
import HozasdElTool from '@/components/HozasdElTool';

export const metadata: Metadata = {
  title: 'Hozasd el az online vásárlásod',
  description:
    'Találtál egy jó vételt, de nincs mivel elhozni? Próbáld ki a terméklink előnézetét belépés nélkül, vagy add meg kézzel a tárgyat. A fuvarfeladás ingyenes.',
  alternates: { canonical: '/hozasd-el' },
  keywords: [
    'ikea szállítás', 'obi szállítás', 'praktiker szállítás', 'jófogás szállítás',
    'bútorszállítás', 'használt bútor elszállítás', 'online vásárlás fuvar', 'GoFuvar',
  ],
  openGraph: {
    title: 'Vettél valamit online? Hozasd el — GoFuvar',
    description: 'Terméklinkből fuvarfeladás: előnézet belépés nélkül, ingyenes feladás, szállítói ajánlatok. Te választod ki a megfelelő szállítót.',
    url: '/hozasd-el',
    type: 'website',
    locale: 'hu_HU',
  },
};

export default function HozasdElPage() {
  return <HozasdElTool />;
}
