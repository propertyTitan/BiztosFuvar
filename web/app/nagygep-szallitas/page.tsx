import type { Metadata } from 'next';
import LandingTemplate from '@/components/LandingTemplate';
import { getLandingBySlug } from '@/lib/landings';

const config = getLandingBySlug('nagygep-szallitas')!;

export const metadata: Metadata = {
  title: config.metaTitle,
  description: config.metaDescription,
  openGraph: { title: config.metaTitle, description: config.metaDescription },
  alternates: { canonical: '/nagygep-szallitas' },
};

export default function Page() {
  return <LandingTemplate config={config} />;
}
