import type { Metadata } from 'next';
import LandingTemplate from '@/components/LandingTemplate';
import { getLandingBySlug } from '@/lib/landings';

const config = getLandingBySlug('butorszallitas')!;

export const metadata: Metadata = {
  title: config.metaTitle,
  description: config.metaDescription,
  openGraph: { title: config.metaTitle, description: config.metaDescription },
  alternates: { canonical: '/butorszallitas' },
};

export default function Page() {
  return <LandingTemplate config={config} />;
}
