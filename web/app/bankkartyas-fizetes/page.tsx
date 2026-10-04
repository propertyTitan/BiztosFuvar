// =====================================================================
//  /bankkartyas-fizetes — a CIB vásárlói tájékoztatója, GoFuvarra kitöltve
//
//  Forrás: a CIB SAKI 1.50 csomag „Vásárlói tájékoztatás" anyaga
//  (eCom_CIB.fiz.taj_HU + a kérdések-válaszok, eCom_CIB-fiz taj_GYFK_HU).
//  A banki teszt kötelezően nézi, hogy ez a tájékoztató a vásárló számára
//  elérhető helyen legyen, „Bankkártyás fizetés" kísérőszövegű linkkel.
//
//  A kitöltés elvei:
//   - a sablon sárga helyőrzői („Webáruház", „áru/szolgáltatás") helyén a
//     GoFuvar és a kapcsolatfelvételi díj áll; a bank belső kitöltési
//     megjegyzése kimaradt;
//   - a VeriSign-/Norton-hivatkozás és a „90%" állítás KIMARADT: saját
//     tanúsítványunk nincs, és olyat nem állítunk, amit nem tudunk igazolni
//     (a bank szerint a VeriSign-logó is csak saját tanúsítvánnyal tehető ki);
//   - a „ha nem tér vissza, sikertelen" mondat a MI folyamatunkra igazítva:
//     a GoFuvar a bezárt ablak után is lekérdezi a banktól az eredményt;
//   - a GoFuvar tegező hangnemében, a tartalom a bankéval azonos;
//   - a „biztonságos fizetés" kifejezés szándékosan nincs benne (szövegőr).
//  Az elfogadott kártyák EGY konstansból jönnek (lib/kartyaLogok.ts).
// =====================================================================
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CibSzolgaltato, ElfogadottKartyak } from '@/components/CibLogok';
import { HAROMDS_LOGOK, elfogadottKartyakSzoveg, kartyaElfogadva } from '@/lib/kartyaLogok';
import { KARTYAADAT_SOR, KERESKEDO_ORSZAG_SOR } from '@/lib/cibFeliratok';
import { BANKI_TOVABBI_INFO, RC_CSOPORT_NEV } from '@/lib/cibRcCsoport';
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

const LOGO_CHIP = {
  display: 'inline-flex', background: '#ffffff', border: '1px solid rgba(15,23,42,0.12)',
  borderRadius: 6, padding: '3px 6px', lineHeight: 0, verticalAlign: 'middle', marginRight: 8,
} as const;

export default function BankkartyasFizetesOldal() {
  const kartyak = elfogadottKartyakSzoveg();
  // A márka-specifikus mondatok az ELFOGADOTT_KARTYAK listát követik: ha a
  // szerződés szerint egy márka kiesik, a rá vonatkozó állítás is eltűnik.
  const visa = kartyaElfogadva('visa');
  const visaCsalad = visa || kartyaElfogadva('vpay');
  const mastercardCsalad = kartyaElfogadva('mastercard') || kartyaElfogadva('maestro');
  const cobrandedAlap = [kartyaElfogadva('mastercard') && 'Mastercard', visa && 'Visa']
    .filter(Boolean).join(' vagy ');
  const visaElectron = visa ? ' A Visa Electron kártyák internetes használata a kibocsátó banktól függ.' : '';
  return (
    <article style={{ maxWidth: 820, margin: '0 auto', padding: '32px 20px', lineHeight: 1.65, fontSize: 16 }}>
      <h1 style={{ marginBottom: 8 }}>Bankkártyás fizetés</h1>
      <p style={{ marginTop: 0 }}>
        A GoFuvaron a kapcsolatfelvételi díjat bankkártyával fizetheted ki. A kártyás fizetést a
        CIB Bank Zrt. biztosítja: a kártyaadataidat a CIB Bank fizetőoldalán adod meg.
      </p>
      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 8,
          border: '1px solid var(--border)', fontSize: 14,
        }}
      >
        <CibSzolgaltato kulso />
        <ElfogadottKartyak />
        <p style={{ margin: 0 }}>{KARTYAADAT_SOR}</p>
      </div>

      <h2 style={{ marginTop: 32 }}>Mit fizetsz bankkártyával?</h2>
      <p>
        Bankkártyával kizárólag a GoFuvar kapcsolatfelvételi díját fizeted ({DIJ_SZABALY_SZOVEG}), az
        ajánlat elfogadása után, a fuvar oldalán. A díj ellenében megkapod a szállító elérhetőségét. A
        fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek; az
        nem a GoFuvaron keresztül fizetendő.
      </p>

      <h2 style={{ marginTop: 32 }}>Hogyan működik a kártyás fizetés?</h2>
      <p>
        A GoFuvar a CIB Bank által biztosított bankkártyás fizetési megoldást nyújtja a feladóknak. A
        biztonságot az adatok szétválasztása alapozza meg: a GoFuvar a fuvarral kapcsolatos információkat
        kapja meg tőled, a CIB Bank pedig kizárólag a fizetési tranzakcióhoz szükséges kártyaadatokat, a 256
        bites TLS titkosítással ellátott fizetőoldalán. A fizetőoldal adattartalmáról a GoFuvar nem értesül,
        azokat csak a CIB Bank érheti el. A tranzakció eredményéről a fizetést követően a GoFuvar oldala
        tájékoztat. A kártyás fizetéshez a böngésződnek támogatnia kell a TLS titkosítást.
      </p>
      <p>
        A kapcsolatfelvételi díj összege a fizetéskor azonnal zárolásra kerül a kártyaszámládon.
      </p>

      <h2 style={{ marginTop: 32 }}>Mire figyelj a fizetéskor?</h2>
      <ul>
        <li>
          Olvasd el az <Link href="/aszf">Általános Szerződési Feltételeket (ÁSZF)</Link>: a
          kapcsolatfelvételi díj és a fizetés feltételeit a 4. pont, az elállást és a panaszkezelést a
          6. pont tartalmazza.
        </li>
        <li>
          Tanulmányozd az <Link href="/adatkezeles">Adatkezelési tájékoztatót</Link>: ebből megtudod, hogyan
          kezeljük az adataidat.
        </li>
        <li>Tartsd nyilván a fuvarral kapcsolatos adataidat!</li>
        <li>Tartsd nyilván a fizetéssel kapcsolatos tranzakciós adataidat (tranzakcióazonosító, engedélyszám)!</li>
        <li>Biztosítsd, hogy titkos kártyaadataidhoz illetéktelen személy soha ne férhessen hozzá!</li>
        <li>Használj olyan böngészőt, amely támogatja a TLS titkosításhoz szükséges opciót!</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>A titkosításról</h2>
      <p>
        A TLS (Transport Layer Security) elfogadott titkosítási eljárás. A CIB Bank egy 256 bites titkosító
        kulccsal védi a kommunikációs csatornát. A böngésződ a TLS segítségével a kártyaadataidat az
        elküldés előtt titkosítja, így azok kódolt formában jutnak el a CIB Bankhoz, és illetéktelen
        személyek számára nem értelmezhetők.
      </p>

      <h2 style={{ marginTop: 32 }}>Elfogadott kártyák</h2>
      <p>
        A CIB Bank internetes fizetési rendszerén keresztül {kartyak} kártyával fizethetsz, ha a kártyád
        kibocsátó bankja engedélyezte az internetes fizetést, valamint internetes használatra alkalmas
        webkártyával.{visaElectron}
      </p>
      <ElfogadottKartyak />

      <h2 style={{ marginTop: 32 }}>A fizetés lépései</h2>
      <ol>
        <li>
          A fuvarod oldalán, az ajánlat elfogadása után mindkét nyilatkozatot kipipálod: a díjfizetési
          nyilatkozatot (kéred az azonnali teljesítést) és a CIB Bank felé történő adattovábbításról szóló
          nyilatkozatot (lásd az <Link href="/adatkezeles#cib-kartyas-fizetes">Adatkezelési tájékoztató</Link>{' '}
          bankkártyás fizetésről szóló részét), majd a „Fizetés bankkártyával” gombra kattintasz.
        </li>
        <li>Ezután átkerülsz a CIB Bank fizetőoldalára, ahol a fizetés megkezdéséhez meg kell adnod a kártyaadataidat.</li>
        <li>A kártyaadatok megadása után a Fizetés gombra kattintva indíthatod el a tranzakciót.</li>
        <li>
          A sikeres hitelesítést (például a bankodtól kapott kód vagy a bankod alkalmazásában adott
          jóváhagyás) követően folytatódik a fizetési folyamat.
        </li>
        <li>
          A fizetést követően visszatérsz a GoFuvar oldalára, ahol a tranzakció eredményéről visszaigazolást
          kapsz: a tranzakció azonosítóját (TrID), az eredmény kódját (RC) és szöveges ismertetését (RT), a
          fizetett összeget (AMO), sikeres fizetésnél pedig a kibocsátó bank által adott engedélyszámot (ANUM).
        </li>
      </ol>
      <p>
        Bankkártyás fizetés esetén a sikeres tranzakciót követően – ez a bankkártya érvényességének és a
        fedezetnek az ellenőrzése utáni elfogadást jelenti – a CIB Bank elindítja a kártyabirtokos számlájának
        megterhelését a kapcsolatfelvételi díj összegével.
      </p>
      <p>
        Ha a banki fizetőoldalon a böngésző „Vissza” vagy „Frissítés” gombjára kattintasz, a rendszer a
        tranzakciót biztonsági okokból automatikusan visszautasítja, és a fizetés sikertelennek minősül.
        Ha a jóváhagyás után bezárod a böngészőablakot, mielőtt visszakerülnél a GoFuvar oldalára, a fizetés
        eredményét a banktól lekérdezzük, és e-mailben, valamint a fuvar oldalán tájékoztatunk róla.
        Sikertelen fizetés után a fuvar oldaláról bármikor új fizetést indíthatsz.
      </p>
      <p>{BANKI_TOVABBI_INFO}</p>

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
            <span style={LOGO_CHIP}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={HAROMDS_LOGOK[0].src} alt={HAROMDS_LOGOK[0].nev} width={HAROMDS_LOGOK[0].szel} height={HAROMDS_LOGOK[0].mag} />
            </span>
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
            <span style={LOGO_CHIP}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={HAROMDS_LOGOK[1].src} alt={HAROMDS_LOGOK[1].nev} width={HAROMDS_LOGOK[1].szel} height={HAROMDS_LOGOK[1].mag} />
            </span>
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
