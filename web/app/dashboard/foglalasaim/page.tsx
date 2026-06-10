'use client';

// Áthelyezve a "Fuvarjaim" hubba — ez az útvonal átirányít a megfelelő fülre.
// (A tartalom: src/components/fuvarjaim/Bookings.tsx)
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/StateView';

export default function FoglalasaimRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/fuvarjaim?tab=foglalasaim'); }, [router]);
  return <Loading />;
}
