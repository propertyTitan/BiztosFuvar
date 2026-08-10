// Rövid átirányítás a címzetti adatkezelési tájékoztatásra.
//
// ⚠️ 2026-08-10: a csak TELEFONSZÁMMAL megadott címzett — akinek nincs
// fiókja, nem fogadott el semmit, és az adatait valaki más adta meg — az
// SMS-ből tudja meg, ki kezeli az adatait (GDPR 14. cikk (3) b): „legkésőbb
// az első közléskor"). Az SMS 2 UCS-2 szegmensbe fér, ezért kell a lehető
// legrövidebb URL — innen a `/a`.
import { redirect } from 'next/navigation';

export default function AdatkezelesRovidLink() {
  redirect('/adatkezeles#cimzett');
}
