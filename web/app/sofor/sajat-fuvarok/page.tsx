'use client';

// Áthelyezve a "Fuvarjaim" hubba — ez az útvonal átirányít a megfelelő fülre.
// (A tartalom: src/components/fuvarjaim/CarryingJobs.tsx)
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/StateView';

export default function SajatFuvarokRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/fuvarjaim?tab=vallalt'); }, [router]);
  return <Loading />;
}
