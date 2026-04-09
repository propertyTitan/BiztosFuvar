// A régi /dashboard URL-t meghagyjuk a bookmark-kompatibilitás miatt,
// de átirányít az új /hirdeteseim oldalra.
import { redirect } from 'next/navigation';

export default function DashboardRedirect() {
  redirect('/hirdeteseim');
}
