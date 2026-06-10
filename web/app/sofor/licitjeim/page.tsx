'use client';

// Áthelyezve a "Fuvarjaim" hubba — ez az útvonal átirányít a megfelelő fülre.
// (A tartalom: src/components/fuvarjaim/MyBids.tsx)
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/StateView';

export default function LicitjeimRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/fuvarjaim?tab=licitjeim'); }, [router]);
  return <Loading />;
}
