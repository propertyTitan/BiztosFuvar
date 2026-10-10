// =====================================================================
//  /bankkartyas-fizetes — a CIB vásárlói tájékoztatója
//
//  Forrás: a CIB SAKI 1.50 csomag „Vásárlói tájékoztatás" anyaga
//  (eCom_CIB.fiz.taj_HU + a kérdések-válaszok, eCom_CIB-fiz taj_GYFK_HU).
//  A banki teszt kötelezően nézi, hogy ez a tájékoztató a vásárló számára
//  elérhető helyen legyen, „Bankkártyás fizetés" kísérőszövegű linkkel.
//
//  2026-10-10 — A BANK ÍRÁSOS KÉRÉSE (a honlap-teszt után): „A banki
//  fizetési tájékoztató nem megfelelő. Kérjük, hogy […] az
//  „eCom_CIB.fiz.taj_HU.docx" dokumentum tartalmát használja. A fizetési
//  tájékoztató GYFK megfelelő." — a logók helyett pedig a bank egyben
//  szerkesztett logóképét kérte.
//  A fő tájékoztató ezért NEM a mi átírásunk többé. A korábbi változat (CIB
//  PR-3) a bank szövegét tegezve, a VeriSign- és a „90%"-os mondat nélkül,
//  a lépéseket a mi folyamatunkra igazítva mondta el — a bank ezt nem
//  fogadta el. Mostantól:
//   - a logó a bank egyben szerkesztett képe (CibKartyaLogok), a bank
//     honlapjára linkelve;
//   - a részletes tájékoztató a bank szövege SZÓ SZERINT
//     (lib/cibTajekoztato.ts — csak a sárgával kiemelt „Webáruház" és
//     „áru/szolgáltatás" helyén áll a GoFuvar és a kapcsolatfelvételi
//     szolgáltatás/díj), a bank címsoraival és magázó hangnemében;
//   - a GoFuvar saját mondatai KÜLÖN, „A GoFuvar kiegészítése" keretben, a
//     banki szöveg után — köztük nyíltan az ismert eltérés: a banki szöveg
//     szerint a vissza nem irányított tranzakció sikertelen, nálunk viszont
//     a lekérdező kör ilyenkor is lezárhatja a jóváhagyott fizetést (a bank
//     ezt a folyamatot elfogadta);
//   - a „Kérdések és válaszok" (GYFK) VÁLTOZATLAN — a bank megfelelőnek
//     találta; csak a 3D Secure külön logói kerültek ki belőle (a banki
//     logókép tartalmazza őket);
//   - a kereskedő adatai (országsor, elérhetőségek, ÁSZF- és adatkezelési
//     linkek) változatlanok.
//  A banki szöveg „biztonságos fizetést garantáló" mondata miatt a szövegőr
//  (e2e/13-szovegor.spec.ts) ezen az oldalon PONTOSAN ezt az egy banki
//  mondatot engedi (e2e/szovegor-banki-kivetel.ts); máshol a tiltás marad.
// =====================================================================
import Link from 'next/link';
import type { ReactNode } from 'react';
import CibKartyaLogok from '@/components/CibKartyaLogok';
import { elfogadottKartyakSzoveg, kartyaElfogadva } from '@/lib/kartyaLogok';
import { KERESKEDO_ORSZAG_SOR } from '@/lib/cibFeliratok';
import { CIB_RESZLETES_TAJEKOZTATO as BANK, CIB_ROVID_TAJEKOZTATO as ROVID, GOFUVAR_KIEGESZITES } from '@/lib/cibTajekoztato';
import { RC_CSOPORT_NEV } from '@/lib/cibRcCsoport';
import { DIJ_SZABALY_SZOVEG } from '@/lib/connectionFee';
import { KERESKEDO } from '@/lib/kereskedo';

// Címsor-hierarchia: a „Kérdések és válaszok" (h2) csoportjai h3-ak, az
// egyes kérdések alattuk h4-ek.
function Kerdes({ kerdes, children }: { kerdes: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h4 style={{ fontSize: 16, margin: '0 0 6px' }}>{kerdes}</h4>
      {children}
    </section>
  );
}

export default function BankkartyasFizetesOldal() {
  const kartyak = elfogadottKartyakSzoveg();
  // A GYFK márka-specifikus mondatai az ELFOGADOTT_KARTYAK listát követik:
  // ha a szerződés szerint egy márka kiesik, a rá vonatkozó állítás is
  // eltűnik. (A bank részletes tájékoztatója rögzített banki szöveg — az
  // nem követi a listát, lásd lib/kartyaLogok.ts.)
  const visa = kartyaElfogadva('visa');
  const visaCsalad = visa || kartyaElfogadva('vpay');
  const mastercardCsalad = kartyaElfogadva('mastercard') || kartyaElfogadva('maestro');
  const cobrandedAlap = [kartyaElfogadva('mastercard') && 'Mastercard', visa && 'Visa']
    .filter(Boolean).join(' vagy ');
  return (
    <article style={{ maxWidth: 820, margin: '0 auto', padding: '32px 20px', lineHeight: 1.65, fontSize: 16 }}>
      <h1 style={{ marginBottom: 12 }}>Bankkártyás fizetés</h1>
      <CibKartyaLogok cel="cib" azonnal nagy />

      {/* 2026-10-10: a bank dokumentumának (eCom_CIB.fiz.taj_HU.docx) TELJES
          tartalma a nyilvános oldalon is, a docx sorrendjében: előbb a
          szaggatott vonal feletti rövid tájékoztató (eddig csak a fizetési
          kártyán állt), majd a részletes — a „részletes tájékoztatónkat"
          ide, a részletes részre mutat. */}
      <div data-testid="cib-rovid-tajekoztato" style={{ marginTop: 20 }}>
        <p>{ROVID.bekezdesek[0]}</p>
        <p>
          {ROVID.bekezdesek[1]} <a href="#reszletes">{ROVID.reszletesLink}</a>
        </p>
      </div>
      <hr style={{ border: 0, borderTop: '1px dashed var(--border)', margin: '20px 0' }} />

      {/* A CIB Bank részletes tájékoztatója — SZÓ SZERINT (lib/cibTajekoztato.ts). */}
      <div id="reszletes" data-testid="cib-reszletes-tajekoztato" style={{ marginTop: 20, scrollMarginTop: 80 }}>
        {BANK.bevezeto.map((b) => <p key={b}>{b}</p>)}

        <h2 style={{ marginTop: 32 }}>{BANK.mireFigyeljen.cim}</h2>
        <ul>
          {BANK.mireFigyeljen.pontok.map((p) => <li key={p}>{p}</li>)}
        </ul>

        <h2 style={{ marginTop: 32 }}>{BANK.biztonsag.cim}</h2>
        {BANK.biztonsag.bekezdesek.map((b) => <p key={b}>{b}</p>)}

        <h2 style={{ marginTop: 32 }}>{BANK.kartyak.cim}</h2>
        {BANK.kartyak.bekezdesek.map((b) => <p key={b}>{b}</p>)}

        <h2 style={{ marginTop: 32 }}>{BANK.lepesek.cim}</h2>
        <ul>
          {BANK.lepesek.pontok.map((p) => <li key={p}>{p}</li>)}
        </ul>
        {BANK.lepesek.utana.map((b) => <p key={b}>{b}</p>)}
      </div>

      {/* A GoFuvar saját mondatai — a banki szövegtől elválasztva. */}
      <section
        data-testid="gofuvar-kiegeszites"
        aria-labelledby="gofuvar-kiegeszites-cim"
        style={{
          marginTop: 32, padding: '4px 18px', borderRadius: 8,
          border: '1px solid var(--border)', borderLeft: '4px solid var(--primary)',
        }}
      >
        <h2 id="gofuvar-kiegeszites-cim" style={{ marginTop: 16 }}>{GOFUVAR_KIEGESZITES.cim}</h2>
        <p>{GOFUVAR_KIEGESZITES.visszateres}</p>
        <p>
          Bankkártyával kizárólag a GoFuvar kapcsolatfelvételi díját fizeti meg ({DIJ_SZABALY_SZOVEG}), az
          ajánlat elfogadása után, a fuvar oldalán; a díj ellenében megkapja a szállító elérhetőségét. A
          fuvardíjat közvetlenül a szállítónak fizeti — készpénzben vagy átutalással, ahogy a szállítóval
          megegyeztek; az nem a GoFuvaron keresztül fizetendő.
        </p>
        <p>
          A fizetés indítása előtt a fuvar oldalán két nyilatkozatot kell elfogadnia: a díjfizetési
          nyilatkozatot (kéri az azonnali teljesítést) és a CIB Bank felé történő adattovábbításról szóló
          nyilatkozatot (lásd az{' '}
          <Link href="/adatkezeles#cib-kartyas-fizetes">Adatkezelési tájékoztató bankkártyás fizetésről szóló részét</Link>).
        </p>
      </section>

      <h2 style={{ marginTop: 32 }}>Kérdések és válaszok</h2>

      <h3 style={{ fontSize: 16, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.4 }}>Kártyaelfogadás</h3>
      <Kerdes kerdes="Milyen típusú kártyákkal lehet fizetni?">
        <p style={{ margin: 0 }}>
          {kartyak} kártyával, amennyiben a kártyát kibocsátó bank internetes fizetésre engedélyezte, valamint
          a kifejezetten internetes használatra szánt webkártyákkal.
          {visa && ' A Visa Electron kártyák interneten történő használatának lehetősége a kártyát kibocsátó banktól függ.'}
        </p>
      </Kerdes>
      <Kerdes kerdes="Lehet-e vásárlókártyákkal fizetni?">
        <p style={{ margin: 0 }}>
          Hűségpontokat tartalmazó, kereskedők vagy szolgáltatók által kibocsátott pontgyűjtő kártyákkal
          interneten nem lehet fizetni.
        </p>
      </Kerdes>
      {cobrandedAlap && (
        <Kerdes kerdes="Lehet-e co-branded kártyákkal fizetni?">
          <p style={{ margin: 0 }}>
            Igen, bármilyen olyan co-branded kártyával, amely internetes fizetésre alkalmas {cobrandedAlap}{' '}
            alapú kártya.
          </p>
        </Kerdes>
      )}

      <h3 style={{ fontSize: 16, marginTop: 28, textTransform: 'uppercase', letterSpacing: 0.4 }}>A fizetés folyamata</h3>
      <Kerdes kerdes="Hogyan működik az online fizetés banki háttérfolyamata?">
        <p style={{ margin: 0 }}>
          A fuvar oldalán a bankkártyás fizetést választva átkerülsz a CIB Bank titkosított kommunikációs
          csatornával ellátott fizetőoldalára. A fizetéshez meg kell adnod a kártyaszámot, a lejárati időt és a
          kártya hátoldalán, az aláíráscsíkon található 3 jegyű érvényesítési kódot. A tranzakciót te indítod
          el; ettől kezdve a kártya valós idejű engedélyezésen megy keresztül, amelynek során a kártyaadatok
          eredetisége, a fedezet és a vásárlási limit kerül ellenőrzésre. Ha a tranzakció folytatásához minden
          adat megfelel, a fizetendő összeget a számlavezető (kártyakibocsátó) bankod zárolja a kártyádon. Az
          összeg terhelése (levonása) a számlavezető bankodtól függően néhány napon belül következik be.
        </p>
      </Kerdes>
      <Kerdes kerdes="Miben különbözik az internetes kártyás fizetés a hagyományostól?">
        <p style={{ margin: 0 }}>
          A kártya jelenlétével történő (Card Present) tranzakció POS terminálon zajlik: a kártya
          behelyezése és a PIN-kód megadása után a terminál a kártyatársaság hálózatán keresztül kapcsolatba
          lép a kártyabirtokos bankjával, ahol megtörténik az érvényesség- és fedezetvizsgálat (authorizáció).
          A kártya jelenléte nélküli (Card not Present) tranzakciónál a kártya fizikailag nincs jelen — ide
          tartoznak az interneten lebonyolított tranzakciók is, amelyeket a kártyabirtokos a 256 bites
          titkosítású fizetőoldalon megadott kártyaadatokkal indít. A sikeres tranzakcióról engedélyszámot
          kapsz, amely megegyezik a papíralapú bizonylaton található számmal.
        </p>
      </Kerdes>
      <Kerdes kerdes="Mit jelent a foglalás?">
        <p style={{ margin: 0 }}>
          A tranzakciót a bank tudomására jutásakor azonnal foglalás (zárolás) követi, hiszen a tényleges
          terheléshez előbb a hivatalos adatoknak kell beérkezniük, ami néhány napot igénybe vesz — és ez
          alatt az összeg újra elkölthető lenne. Ezért a foglalással a kifizetett összeget elkülönítik. A
          foglalt összeg a számlaegyenleghez tartozik, de még egyszer nem költhető el. A foglalás biztosítja
          azoknak a tranzakcióknak a visszautasítását, amelyekre már nincs fedezet, noha a számlaegyenleg erre
          elvben még lehetőséget adna.
        </p>
      </Kerdes>

      <h3 style={{ fontSize: 16, marginTop: 28, textTransform: 'uppercase', letterSpacing: 0.4 }}>Sikertelen fizetések és teendők</h3>
      <Kerdes kerdes="Milyen esetben lehet sikertelen egy tranzakció?">
        <p style={{ margin: '0 0 8px' }}>
          Általában a kártyát kibocsátó bank (ahol a kártyádat kaptad) nem fogadja el a fizetési megbízást;
          de előfordulhat az is, hogy távközlési vagy informatikai hiba miatt az engedélykérés nem jut el a
          kártyát kibocsátó bankhoz.
        </p>
        <p style={{ margin: '8px 0 2px', fontWeight: 700 }}>{RC_CSOPORT_NEV.kartya}</p>
        <ul style={{ marginTop: 0 }}>
          <li>A kártya nem alkalmas internetes fizetésre.</li>
          <li>A kártya internetes használatát a számlavezető bank tiltja.</li>
          <li>A kártyahasználat tiltott.</li>
          <li>A kártyaadatok (kártyaszám, lejárat, az aláíráscsíkon szereplő kód) hibásan lettek megadva.</li>
          <li>A kártya lejárt.</li>
        </ul>
        <p style={{ margin: '8px 0 2px', fontWeight: 700 }}>{RC_CSOPORT_NEV.szamla}</p>
        <ul style={{ marginTop: 0 }}>
          <li>Nincs fedezet a tranzakció végrehajtásához.</li>
          <li>A tranzakció összege meghaladja a kártya vásárlási limitjét.</li>
        </ul>
        <p style={{ margin: '8px 0 2px', fontWeight: 700 }}>{RC_CSOPORT_NEV.kapcsolat}</p>
        <ul style={{ marginTop: 0 }}>
          <li>A tranzakció során valószínűleg megszakadt a vonal. Próbáld meg újra.</li>
          <li>A tranzakció időtúllépés miatt sikertelen volt. Próbáld meg újra.</li>
        </ul>
        <p style={{ margin: '8px 0 2px', fontWeight: 700 }}>{RC_CSOPORT_NEV.technikai}</p>
        <ul style={{ marginTop: 0 }}>
          <li>
            Ha a fizetőoldalról visszatértél, de a böngésző „Vissza”, „Újratöltés” vagy „Frissítés”
            funkciójával visszaléptél a fizetőoldalra, a rendszer a tranzakciót biztonsági okokból
            automatikusan visszautasítja.
          </li>
          <li>
            Ha a kártyabirtokos-hitelesítés (3D Secure) sikertelenül zárul, a bank a tranzakciót elutasítja.
          </li>
        </ul>
      </Kerdes>
      <Kerdes kerdes="Mi a teendő, ha a fizetés sikertelen?">
        <p style={{ margin: 0 }}>
          A tranzakcióhoz minden esetben tranzakcióazonosító (TrID) tartozik, amelyet javaslunk feljegyezni —
          a GoFuvar a fizetés eredményével együtt megmutatja. Ha a fizetési kísérletet a bank visszautasítja,
          vedd fel a kapcsolatot a számlavezető bankoddal. A kapcsolatfelvételi díj fizetését a fuvar oldaláról
          bármikor újra elindíthatod, új tranzakcióként.
        </p>
      </Kerdes>
      <Kerdes kerdes="Miért a számlavezető bankkal kell felvenni a kapcsolatot, ha a fizetés sikertelen?">
        <p style={{ margin: 0 }}>
          A kártyaellenőrzés során a számlavezető (kártyakibocsátó) bank értesíti az összeget beszedő
          kereskedő (elfogadó) bankját, hogy a tranzakció elvégezhető-e. Más bank ügyfelének az elfogadó bank
          nem adhat ki bizalmas információkat — erre csak a kártyabirtokost azonosító banknak van joga.
        </p>
      </Kerdes>
      <Kerdes kerdes="SMS-t kaptam a bankomtól az összeg zárolásáról, a GoFuvar mégis azt jelzi, hogy a fizetés nem sikerült. Mit jelent ez?">
        <p style={{ margin: 0 }}>
          Ez akkor fordulhat elő, ha a kártyád ellenőrzése a fizetőoldalon megtörtént, de a fizetést nem
          véglegesítettük (például mert a folyamat közben megszakadt, vagy a díjat időközben már rendezted).
          Ilyenkor az összeg nem kerül terhelésre a kártyádon, a foglalást a bank feloldja; a kivonaton pár
          napig függő tételként látszhat.
        </p>
      </Kerdes>

      <h3 style={{ fontSize: 16, marginTop: 28, textTransform: 'uppercase', letterSpacing: 0.4 }}>Titkosítás és hitelesítés</h3>
      <Kerdes kerdes="Mit jelent a 256 bites titkosítású TLS kommunikációs csatorna?">
        <p style={{ margin: 0 }}>
          A TLS (Transport Layer Security) elfogadott titkosítási eljárás. A CIB Bank egy 256 bites
          titkosító kulccsal védi a kommunikációs csatornát. A böngésződ a TLS segítségével a kártyaadataidat
          az elküldés előtt titkosítja, így azok kódolt formában jutnak el a CIB Bankhoz, és illetéktelen
          személyek számára nem értelmezhetők.
        </p>
      </Kerdes>
      <Kerdes kerdes="Mit jelent a CVC2/CVV2 kód?">
        <p style={{ margin: 0 }}>
          A Mastercard esetében az úgynevezett Card Verification Code, a Visa esetében a Card Verification
          Value egy olyan numerikus érték, amelynek segítségével megállapítható a kártya valódisága. A
          kártyák hátoldalán, az aláíráscsíkon található számsor utolsó három számjegyét kell megadnod az
          internetes fizetésnél.
        </p>
      </Kerdes>
      {visaCsalad && (
        <Kerdes kerdes="Mit jelent a Visa Secure?">
          <p style={{ margin: 0 }}>
            A Visa Secure a Visa-kártyabirtokosok számára a kártyát kibocsátó banknál beállított, egyszeri
            kódon vagy biometrikus azonosításon (például arcfelismerésen vagy ujjlenyomaton) alapuló ellenőrzés,
            amellyel internetes fizetésnél azonosíthatod magad, és amely véd a Visa-kártyák jogosulatlan
            használata ellen. A CIB Bank elfogadja a Visa Secure rendszer keretében kibocsátott kártyákat.
          </p>
        </Kerdes>
      )}
      {mastercardCsalad && (
        <Kerdes kerdes="Mit jelent a Mastercard Identity Check (ID Check)?">
          <p style={{ margin: 0 }}>
            A Mastercard Identity Check a Mastercard- és Maestro-kártyabirtokosok számára a kártyát kibocsátó
            banknál beállított, egyszeri kódon vagy biometrikus azonosításon alapuló ellenőrzés, amellyel
            internetes fizetésnél azonosíthatod magad, és amely véd a kártyák jogosulatlan használata ellen. A CIB
            Bank elfogadja a Mastercard Identity Check rendszer keretében kibocsátott kártyákat.
          </p>
        </Kerdes>
      )}

      <h2 id="kereskedo-adatai" style={{ marginTop: 32 }}>Kapcsolat és a kereskedő adatai</h2>
      <ul>
        <li><strong>Cégnév:</strong> {KERESKEDO.teljesNev} ({KERESKEDO.rovidNev})</li>
        <li><strong>Székhely:</strong> {KERESKEDO.szekhely}</li>
        <li>{KERESKEDO_ORSZAG_SOR}</li>
        <li><strong>Cégjegyzékszám:</strong> {KERESKEDO.cegjegyzekszam}</li>
        <li><strong>Adószám:</strong> {KERESKEDO.adoszam}</li>
        <li><strong>E-mail:</strong> <a href={`mailto:${KERESKEDO.email}`}>{KERESKEDO.email}</a></li>
        <li><strong>Panasz:</strong> <a href={`mailto:${KERESKEDO.panaszEmail}`}>{KERESKEDO.panaszEmail}</a></li>
        <li><strong>Telefon:</strong> <a href={KERESKEDO.telefonHref}>{KERESKEDO.telefon}</a></li>
      </ul>
      <p>
        A kapcsolatfelvételi díjra vonatkozó feltételeket (a díj nem visszatérítendő; ha a fuvar a szállító
        hibájából hiúsul meg, díjmentesen választhatsz másik szállítót ugyanerre a fuvarra) az{' '}
        <Link href="/aszf">ÁSZF</Link> 4. pontja tartalmazza. Az elállásról (a díj megfizetésével a
        szolgáltatás azonnal teljesül, ezért az elállási jog a fizetéskor tett nyilatkozat szerint
        megszűnik), a panaszkezelésről és a békéltető testületről az ÁSZF 6. pontja szól. Panaszodat
        a <a href={`mailto:${KERESKEDO.panaszEmail}`}>{KERESKEDO.panaszEmail}</a> címen vagy a
        székhelyre küldött levélben teheted meg; 30 napon belül érdemben válaszolunk. Az adatkezelésről
        az <Link href="/adatkezeles">Adatkezelési tájékoztató</Link> szól.
      </p>
    </article>
  );
}
