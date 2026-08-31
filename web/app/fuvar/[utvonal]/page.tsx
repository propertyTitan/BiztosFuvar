import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingTemplate from '@/components/LandingTemplate';
import { getRouteLanding, allRouteSlugs } from '@/lib/landings';

// Statikus generálás minden top útvonalra (SEO: előre renderelt oldalak).
export function generateStaticParams() {
  return allRouteSlugs().map((utvonal) => ({ utvonal }));
}

// Next 15+ (SEC-011 migráció): a `params` aszinkron lett.
export async function generateMetadata({ params }: { params: Promise<{ utvonal: string }> }): Promise<Metadata> {
  const { utvonal } = await params;
  const c = getRouteLanding(utvonal);
  if (!c) return { title: 'Fuvar — GoFuvar' };
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    openGraph: { title: c.metaTitle, description: c.metaDescription },
    alternates: { canonical: `/fuvar/${c.slug}` },
  };
}

export default async function RouteLandingPage({ params }: { params: Promise<{ utvonal: string }> }) {
  const { utvonal } = await params;
  const c = getRouteLanding(utvonal);
  if (!c) notFound();
  return <LandingTemplate config={c} />;
}
