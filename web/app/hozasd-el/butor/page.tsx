import type { Metadata } from 'next';
import HozasdElTool from '@/components/HozasdElTool';

export const metadata: Metadata = {
  title: 'Megvan a bútor? Hozasd el',
  description: 'Kanapé a Jófogásról, szekrény az IKEA-ból? Kezdd a bútorszállítás feladását terméklinkkel vagy kézzel. Az előnézethez nem kell regisztrálni.',
  alternates: { canonical: '/hozasd-el/butor' },
  openGraph: {
    title: 'Megvan a bútor, de nincs mivel elhozni? | GoFuvar',
    description: 'Kezdd el a szállítás feladását a bútor linkjével vagy megnevezésével. Ingyenes feladás, szállítói ajánlatok, te választasz.',
    url: '/hozasd-el/butor', type: 'website', locale: 'hu_HU',
  },
};

export default function FurniturePickupPage() {
  return <HozasdElTool furniture />;
}
