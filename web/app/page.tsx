// SEO-barát landing page + bejelentkezett hub.
//
// Ha a user NINCS belépve → teljes értékű marketing landing oldal,
// amit a Google is indexel (server component, nem kell JS a renderhez).
// Ha a user BE VAN lépve → a korábbi kártya-rácsos hub.
import HomeHub from '@/components/HomeHub';
import LandingPage from '@/components/LandingPage';

export default function Home() {
  // A HomeHub „use client" és a useCurrentUser() hook-kal dönti el
  // bent van-e a user. Ha nincs → null-t renderel, és a LandingPage
  // jelenik meg. Ha be van lépve → a hub kártyák, a landing eltűnik.
  return (
    <>
      <HomeHub />
      <LandingPage />
    </>
  );
}
