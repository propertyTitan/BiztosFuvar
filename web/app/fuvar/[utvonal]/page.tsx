import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingTemplate from '@/components/LandingTemplate';
import { getRouteLanding, allRouteSlugs } from '@/lib/landings';

// Statikus generálás minden top útvonalra (SEO: előre renderelt oldalak).
export function generateStaticParams() {
  return allRouteSlugs().map((utvonal) => ({ utvonal }));
}

export function generateMetadata({ params }: { params: { utvonal: string } }): Metadata {
  const c = getRouteLanding(params.utvonal);
  if (!c) return { title: 'Fuvar — GoFuvar' };
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    openGraph: { title: c.metaTitle, description: c.metaDescription },
    alternates: { canonical: `/fuvar/${c.slug}` },
  };
}

export default function RouteLandingPage({ params }: { params: { utvonal: string } }) {
  const c = getRouteLanding(params.utvonal);
  if (!c) notFound();
  return <LandingTemplate config={c} />;
}
