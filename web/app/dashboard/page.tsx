// A régi /dashboard URL-t meghagyjuk a bookmark-kompatibilitás miatt,
// de közvetlenül a "Fuvarjaim" hub Hirdetéseim fülére irányít.
import { redirect } from 'next/navigation';

export default function DashboardRedirect() {
  redirect('/fuvarjaim?tab=hirdeteseim');
}
