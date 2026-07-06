import type { Metadata } from 'next';
import LandingTemplate from '@/components/LandingTemplate';
import { getLandingBySlug } from '@/lib/landings';

const config = getLandingBySlug('koltoztetes')!;

export const metadata: Metadata = {
  title: config.metaTitle,
  description: config.metaDescription,
  openGraph: { title: config.metaTitle, description: config.metaDescription },
  alternates: { canonical: '/koltoztetes' },
};

export default function Page() {
  return <LandingTemplate config={config} />;
}
