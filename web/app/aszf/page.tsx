import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Általános Szerződési Feltételek (ÁSZF) | GoFuvar',
  description: 'A GoFuvar platform általános szerződési feltételei.',
};

export default function AszfPage() {
  return (
    <article
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '32px 20px',
        lineHeight: 1.65,
        fontSize: 16,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Általános Szerződési Feltételek (ÁSZF)</h1>
      <p className="muted" style={{ margin: 0 }}>
        <strong>Platform:</strong> GoFuvar (gofuvar.hu és a mobilalkalmazások)<br />
        <strong>Hatályos:</strong> 2026. július 3-tól
      </p>

      <h2 style={{ marginTop: 32 }}>1. A Szolgáltató adatai és Elérhetőségei</h2>
      <p>
        Az e-Kereskedelemről szóló 2001. évi CVIII. törvény alapján a szolgáltató adatai:
      </p>
      <ul>
        <li><strong>Cégnév:</strong> Tiszta Hód Korlátolt Felelősségű Társaság (Tiszta Hód Kft.)</li>
        <li><strong>Székhely:</strong> 6800 Hódmezővásárhely, Szántó Kovács János utca 144.</li>
        <li><strong>Cégjegyzékszám:</strong> 06-09-020646</li>
        <li><strong>Adószám:</strong> 24750792-2-06</li>
        <li><strong>Képviseli:</strong> Jovány Gyula</li>
        <li><strong>Központi e-mail cím:</strong> info@gofuvar.hu</li>
        <li><strong>Panaszkezelési e-mail cím:</strong> panasz@gofuvar.hu</li>
        <li><strong>Telefonszám:</strong> +36 20 397 9223</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>2. A Szolgáltatás jellege és Közvetítői státusz</h2>
      <p>
        A Szolgáltató egy kétoldalú informatikai közvetítő platformot (<strong>Piacteret</strong>) üzemeltet.
        A Szolgáltató <strong>NEM</strong> végez fuvarozási vagy postai tevékenységet, <strong>NEM</strong> köt fuvarozási
        szerződést a Felhasználókkal a saját nevében, és <strong>NEM</strong> minősül fuvarozónak a Polgári Törvénykönyvről
        szóló 2013. évi V. törvény (Ptk.) értelmében.
      </p>
      <p>
        A fuvarozási szerződés kizárólag a csomagot feladó (továbbiakban: <strong>Feladó</strong>) és
        a fuvarozást vállaló (továbbiakban: <strong>Sofőr</strong> — a Platform felületein
        megnevezése: <strong>„Szállító"</strong>; a két fogalom azonos) között jön létre. A Szolgáltató
        szolgáltatása az <strong>összeköttetés létrehozása</strong>: az ajánlat-közvetítés, a
        kommunikációs felület biztosítása, a Felek kapcsolatfelvételi adatainak átadása (a 4. pont
        szerinti díj ellenében), az átvételi kód generálása és a vita-rendezési eljárás lefolytatása.
        A Szolgáltató a Feladó és a Sofőr közötti fuvardíjat <strong>nem kezeli, nem tartja letétben
        és nem közvetíti</strong> — azt a Felek egymás között, közvetlenül rendezik (4.2. pont).
      </p>
      <p>
        A Szolgáltató magyar székhelyű piactér; fő tevékenysége a magyarországi belföldi fuvarok
        közvetítése. Az európai (EU + EGT) viszonylatú nemzetközi fuvarokat a platform szintén támogatja,
        a Felhasználók és a Sofőrök kapacitásának függvényében.
      </p>

      <h2 style={{ marginTop: 32 }}>3. Regisztráció és Progresszív KYC</h2>
      <p>
        <strong>3.1.</strong> A regisztráció kizárólag 18. életévüket betöltött, cselekvőképes természetes
        személyek és jogi személyek számára engedélyezett.
      </p>
      <p>
        <strong>3.2.</strong> A tranzakciók megkezdése a személyazonosság (KYC) igazolásához kötött:
        minden Felhasználónak a Személyi igazolvány igazolása szükséges. A sofőri (fuvarozói)
        tevékenységhez a Felhasználó ezen felül elfogadja a jelen ÁSZF 3.4. pontja szerinti sofőri
        nyilatkozatot (minden vonatkozó jogszabály és a KRESZ betartása). Céges fiók esetén az
        Adószám megadása is szükséges.
      </p>

      <h3 style={{ marginTop: 24 }}>3.3. A Feladó felelőssége az áru jogszerű feladhatóságáért</h3>
      <p>
        A platform közvetítő természetéből adódóan a Szolgáltató <strong>NEM ellenőrzi</strong> a feladott áru
        jogszerűségét vagy a Sofőr speciális engedélyeit. A Feladó kizárólagosan és teljes körűen felel azért, hogy:
      </p>
      <ul>
        <li>
          a feladott áru a magyar és uniós jogszabályoknak megfelel (nem tiltott, nem hamisított,
          nem ellopott, nem szerzői jogot sértő)
        </li>
        <li>
          ha az áru speciális szállítási engedélyt igényel (pl. <strong>élő állat</strong>, hűtőlánc-igényes
          termék, gyógyszer, lőfegyver és lőszer érvényes engedéllyel, festék/akkumulátor és más veszélyes anyag,
          radioaktív anyag), akkor a fuvar elvállalása előtt köteles meggyőződni arról, hogy a Sofőr
          rendelkezik a vonatkozó hatósági engedéllyel és technikai feltételekkel
        </li>
        <li>
          a Sofőrnek a fuvar lényeges tulajdonságairól (méret, súly, tartalom, hűtésigény,
          értékhatár) <strong>előzetesen, valós tájékoztatást</strong> ad
        </li>
      </ul>
      <p>
        <strong>Abszolút tilos</strong> a platformon olyan áru feladása, amelynek szállítása minden engedély
        mellett is jogellenes (kábítószer, illegális fegyver, hamisított termék, ellopott vagyontárgy,
        emberi maradvány, robbanóanyag).
      </p>
      <p>
        Az engedély nélkül feladott speciális áruból, valamint a tiltott áruk feladásából eredő minden kárért,
        bírságért, hatósági eljárásért a Feladó kizárólagosan felel — ide értve a Sofőrnek okozott kárt is.
        A Szolgáltató jogosult ilyen feladás észlelésekor a fiókot azonnal felfüggeszteni, és a hatóságoknak
        a vonatkozó jogszabályok szerint adatot szolgáltatni.
      </p>

      <h3 style={{ marginTop: 24 }}>3.4. Sofőri minimumkövetelmények</h3>
      <p>
        A Sofőr a regisztrációkor és minden egyes fuvar elvállalásakor szavatol azért, hogy:
      </p>
      <ul>
        <li>18. életévét betöltötte és cselekvőképes</li>
        <li>a fuvarozás során <strong>minden vonatkozó jogszabályt és a KRESZ szabályait betartja</strong>,
          és az általa választott közlekedési móddal (pl. gépjármű, kerékpár, gyalog, tömegközlekedés)
          jogszerűen és biztonságosan közlekedik</li>
        <li>a fuvarra <strong>alkohol- és kábítószer-mentesen</strong> érkezik, és a fuvar teljes idejében
          ebben az állapotban marad</li>
        <li><strong>gépjárművel történő fuvarozás esetén</strong> érvényes, a jármű kategóriájának
          megfelelő vezetői engedéllyel és érvényes forgalmi engedéllyel rendelkezik, és nem áll
          vezetéstől eltiltás vagy a járművezetést kizáró egészségügyi állapot alatt</li>
      </ul>
      <p>
        A Szolgáltató a fenti követelményeket <strong>nem ellenőrzi tételesen</strong>, hanem a Sofőr
        nyilatkozatára támaszkodik. A Szolgáltató NEM követeli meg a Sofőröktől Casco-, árufuvarozó-
        vagy CMR-biztosítás megkötését, és nem is ellenőrzi azok meglétét. A Feladó saját mérlegelési
        jogkörében döntheti el, hogy a magas értékű fuvart kívánja-e olyan Sofőrre bízni, aki nem
        rendelkezik kiegészítő árufuvarozó-biztosítással.
      </p>
      <p>
        A fenti nyilatkozatok valótlan tartalmáért a Sofőr maga felel. A Szolgáltató fenntartja a jogot,
        hogy nyilatkozat-szerinti hiányosság észlelésekor a fiókot azonnal felfüggessze.
      </p>

      <h2 style={{ marginTop: 32 }}>4. Pénzügyi Feltételek és Számlázás</h2>
      <p>
        <strong>4.1. Kapcsolatfelvételi (közvetítési) díj:</strong> A Szolgáltató egyetlen díja a
        kapcsolatfelvételi díj, amelyet a <strong>Feladó</strong> fizet meg bankkártyával (a Barion
        Payment Zrt. fizetési rendszerén keresztül) a megállapodás létrejöttekor (licit elfogadása,
        fix áras foglalás sofőri megerősítése, illetve azonnali fuvar sofőri elvállalása után).
        A díj ellenében a Szolgáltató <strong>azonnal átadja a Feladónak a Sofőr kapcsolatfelvételi
        adatait</strong> (név, telefonszám, e-mail cím), a Sofőrnek a Feladóét, és elindítja a
        fuvar-folyamatot támogató szolgáltatásokat (címzetti SMS-értesítések, átvételi kód,
        fotó-bizonyíték, vita-funkció).
      </p>
      <p>
        A díj a megállapodott fuvardíjhoz igazodó sávos, <strong>bevezető árazású</strong> díj:
      </p>
      <ul>
        <li>50.000 Ft fuvardíjig: <strong>500 Ft</strong></li>
        <li>50.000 Ft fuvardíj felett: <strong>1.000 Ft</strong></li>
      </ul>
      <p>
        A feltüntetett díjak bruttó (ÁFA-t tartalmazó) összegek. A „bevezető ár" megjelölés arra utal,
        hogy a Szolgáltató a díjszabást a 13. pont szerinti módosítási szabályok betartásával a
        későbbiekben megváltoztathatja; a már megfizetett díjat a módosítás nem érinti.
      </p>
      <p>
        <strong>A díj nem visszatérítendő:</strong> a Szolgáltató szolgáltatása (a kapcsolatfelvételi
        adatok átadása és a fuvar-folyamat elindítása) a díj megfizetésével <strong>azonnal és teljes
        egészében teljesül</strong> (lásd 6.2. pont). Ha azonban a fuvar a kiválasztott Sofőr
        érdekkörében felmerülő okból hiúsul meg (a Sofőr visszalép vagy nem elérhető), a Feladó{' '}
        <strong>ugyanarra a fuvarra díjmentesen választhat másik Sofőrt</strong> a beérkezett ajánlatok
        közül — új díjfizetés nélkül. A megfizetett díj kizárólag arra a fuvarra (küldeményre)
        vonatkozik, amelyre a Feladó megfizette; <strong>másik fuvarra nem vihető át</strong> és
        készpénzre nem váltható.
      </p>
      <p>
        <strong>4.2. Fuvardíj — közvetlen fizetés a Felek között:</strong> A fuvardíjat a Feladó{' '}
        <strong>közvetlenül a Sofőrnek fizeti meg</strong> — jellemzően készpénzben a csomag
        átvételekor vagy kézbesítésekor, de a Felek megállapodása alapján bármely más közvetlen
        fizetési mód (például banki átutalás) is alkalmazható. A Szolgáltató a fuvardíjat semmilyen
        formában nem szedi be, nem tartja letétben, abból nem von le semmit, és a fuvardíj
        megfizetéséért vagy elmaradásáért nem felel. A fuvardíj-fizetéssel kapcsolatos igényeket a
        Felek egymás között, a Ptk. szabályai szerint rendezik.
      </p>
      <p>
        <strong>4.3. Számlázás:</strong> A fuvardíj teljes (100%) összegéről a számlát/bizonylatot
        a <strong>Sofőr állítja ki a Feladó részére</strong>. A Szolgáltató a kapcsolatfelvételi díjról
        állít ki számlát a <strong>Feladó részére</strong>.
      </p>

      <h2 style={{ marginTop: 32 }}>5. Lemondás, Kártérítési Felelősség és DAC7</h2>
      <p>
        <strong>5.1. Lemondás:</strong> A fuvar lemondásáért a Szolgáltató <strong>külön lemondási
        díjat nem számít fel</strong>.
      </p>
      <ul>
        <li>
          <strong>Feladói lemondás (felvétel előtt):</strong> díjmentes. A már megfizetett
          kapcsolatfelvételi díj azonban — mivel a Szolgáltató szolgáltatása (a kontakt-átadás)
          már teljesült — <strong>nem jár vissza</strong>, és másik fuvarra nem vihető át
          (4.1. pont).
        </li>
        <li>
          <strong>Sofőri lemondás:</strong> A fuvar díjmentesen újranyílik: a Feladó a korábban
          beérkezett ajánlatok közül új díjfizetés nélkül választhat másik Sofőrt ugyanarra a
          fuvarra (4.1. pont). A visszalépő Sofőr platformon belüli &quot;Trust Score&quot; értéke csökken;
          ismételt indokolatlan lemondás esetén a Szolgáltató a Sofőri fiókot felfüggesztheti.
        </li>
        <li>
          A fuvardíjjal a Szolgáltató nem rendelkezik (4.2. pont), így lemondás esetén a Szolgáltató
          fuvardíjat nem térít vissza és nem is tart vissza — a Felek közötti esetleges elszámolás
          (pl. már megkezdett fuvar költsége) a Felek egymás közötti ügye.
        </li>
      </ul>
      <p>
        <strong>5.2. A küldeményt érintő kár — a Felek közötti rendezés:</strong> A fuvarozási szerződés
        kizárólag a Feladó és a Sofőr között jön létre (lásd 2. pont), ezért a küldemény átvételétől a
        sikeres kézbesítésig a küldemény épségéért, hiánytalanságáért és határidőben történő átadásáért —
        a fuvarozóra vonatkozó hatályos jogszabályok, különösen a Polgári Törvénykönyv fuvarozási
        szerződésre vonatkozó rendelkezései (Ptk. 6:257.&nbsp;§ – 6:271.&nbsp;§) szerint — <strong>a Sofőr
        (fuvarozó) felel a Feladóval szemben</strong>.
      </p>
      <p>
        <strong>A Szolgáltató (Platform) a küldeményt érintő semmilyen kárért nem felel</strong> — sem a
        sérülésért, elvesztésért vagy hiányért, sem a késedelmes átadásért —, mivel a Szolgáltató nem
        fuvarozó és nem szerződő fél a fuvarozási jogviszonyban.
      </p>
      <p>
        <strong>Bármilyen káresemény esetén a kárt a Feladó és a Sofőr egymás között, közvetlenül, a
        hatályos jogszabályok alapján rendezi.</strong> A kártérítési igény jogalapját, mértékét és módját
        a Felek között a vonatkozó jog határozza meg; a Szolgáltató <strong>nem szab meg felső kárhatárt</strong>,
        és nem korlátozza a Feleket a jogszabályból eredő igényeik érvényesítésében. A Szolgáltató a
        rendezést kizárólag technikai eszközökkel segíti (felvételi és kézbesítési fotó, GPS-napló, in-app
        kommunikáció, a vita-funkció), de <strong>kártérítést nem fizet</strong>, és a Felek közötti jogvitában
        érdemben, jogerős hatállyal nem dönt. A Felek a vitájukat a hatályos jog szerint, szükség esetén
        bírósági úton érvényesíthetik (lásd 8. pont).
      </p>

      <h3 style={{ marginTop: 24 }}>5.3. Kárrendezés folyamata</h3>
      <p>
        Amennyiben a Feladó (vagy a nevében eljáró Címzett) a küldeményen sérülést, hiányt vagy más
        kárt észlel:
      </p>
      <ol>
        <li>
          <strong>Bejelentési határidő:</strong> a kárt a kézbesítést követő <strong>24 órán belül</strong>
          {' '}írásban (e-mailben a panasz@gofuvar.hu címre, vagy a Platform vita-megnyitás funkcióján
          keresztül) jelezni kell. A 24 órás határidő után érkezett bejelentéseket a Szolgáltató a Platform
          belső vita-eljárásában érdemi vizsgálat nélkül elutasíthatja; ez nem érinti a Feladó és a Sofőr
          egymással szemben, a hatályos jog szerint fennálló igényérvényesítését.
        </li>
        <li>
          <strong>Bizonyítékok:</strong> a Feladó köteles fotódokumentációval alátámasztani a kárt
          (a sérült csomag és tartalom képei), a Platformon meglévő pickup és dropoff fotókat a
          Szolgáltató automatikusan társítja. A vásárlási értéket lehetőség szerint számlával
          (vagy egyéb hitelt érdemlő dokumentummal) kell igazolni.
        </li>
        <li>
          <strong>Sofőri állásfoglalás:</strong> a Sofőr a bejelentéstől számított 7 naptári napon
          belül érdemben nyilatkozik (elismeri vagy vitatja a kárt).
        </li>
        <li>
          <strong>Pénzügyi rendezés:</strong> elismert kár esetén a kártérítést a Felek egymás között,
          közvetlenül rendezik (a Szolgáltató a fuvardíjat és a kártérítést nem kezeli). A Szolgáltató
          NEM biztosító — a kártérítést nem ő fizeti, csak a rendezést segíti a bizonyítékok
          rendelkezésre bocsátásával.
        </li>
        <li>
          <strong>Vita esetén:</strong> ha a Sofőr vitatja a kárt, vagy a felek a pénzügyi rendezésben
          nem tudnak megegyezni, a Szolgáltató belső vita-eljárást folytat le a 7. pontban leírtak szerint.
        </li>
      </ol>

      <h3 style={{ marginTop: 24 }}>5.4. Nemzetközi fuvar és vámkezelés</h3>
      <p>
        Az Európai Unión belüli (EU + EGT) viszonylatú fuvarokra a magyarországi belföldi fuvarokkal
        azonos szabályok érvényesek, azzal a kiegészítéssel, hogy a határátlépés rendészeti, közúti
        és műszaki feltételeinek (jármű-kategória, ADR-anyag-engedély, élőállat-szállítási engedély stb.)
        teljesítéséért a Sofőr, a fuvar jogszerű feladhatóságáért pedig a Feladó felel
        (a 3.3. és 3.4. pontokban foglaltak szerint).
      </p>
      <p>
        Az Európai Unión kívüli (pl. Egyesült Királyság, Svájc, nem EU-tagállam balkáni országok)
        viszonylatú fuvar esetén a <strong>vámkezelés és a vám-/illetékfizetés a Feladó kizárólagos
        felelőssége</strong>. A Szolgáltató és a Sofőr NEM jár el vámügyekben, és NEM felelnek a
        hiányos vámdokumentációból eredő késedelmért, lefoglalásért vagy a vám-hatóság által
        kiszabott bírságért.
      </p>

      <h3 style={{ marginTop: 24 }}>5.5. Vis maior</h3>
      <p>
        A Felek egyike sem felel olyan szerződésszegésért, amely előre nem látható, kívülről érkező,
        elháríthatatlan eseményből (vis maior) ered. Ide tartozik különösen: természeti katasztrófa,
        pandémia, sztrájk, hatósági korlátozás, közlekedési útzár, kibertámadás, áramkimaradás vagy
        a platform működéséhez igénybe vett külső szolgáltatások (fizetési, tárhely-, adatbázis-
        szolgáltató) tartós kiesése.
      </p>
      <p>
        Vis maior esetén a Szolgáltató jogosult az érintett fuvarokat felfüggeszteni és a Feleket a
        megoldás módjáról értesíteni. Vis maior eredetű kárért a Szolgáltatót nem terheli kártérítési
        kötelezettség.
      </p>

      <h3 style={{ marginTop: 24 }}>5.6. DAC7</h3>
      <p>
        A Szolgáltató az adózás rendjéről szóló jogszabályok és a 2011/16/EU Tanácsi irányelv (DAC7)
        szerint <strong>adatot szolgáltat a Nemzeti Adó- és Vámhivatal (NAV) felé</strong> a Sofőrök
        platformon keresztül elért bevételeiről. Mivel a fuvardíj a Felek között közvetlenül mozog
        (4.2. pont), az adatszolgáltatás a <strong>Platformon rögzített, megállapodott fuvardíjakon</strong>{' '}
        (a Szolgáltató számára ismert ellenértéken) alapul. Az adatszolgáltatás éves rendszerességgel
        történik, és a NAV-tól elvárt formátumban tartalmazza a Sofőr azonosító adatait, a tranzakciók
        számát és összegét.
      </p>

      <h2 style={{ marginTop: 32 }}>6. Fogyasztói Jogok: Elállás és Panaszkezelés</h2>
      <p>
        <strong>6.1. 14 napos elállási jog (B2C):</strong> A fogyasztó és a vállalkozás közötti
        szerződések részletes szabályairól szóló 45/2014. (II. 26.) Korm. rendelet alapján a
        fogyasztónak minősülő Feladót alapesetben 14 napos elállási jog illeti meg a Szolgáltatóval
        kötött, a kapcsolatfelvételi díj ellenében nyújtott közvetítési szolgáltatásra vonatkozó
        szerződéstől.
      </p>
      <p>
        <strong>6.2. Kivételszabály (Az elállási jog elvesztése) — azonnali teljesítés:</strong>{' '}
        A Szolgáltató szolgáltatása (a kapcsolatfelvételi adatok átadása és a fuvar-folyamat
        elindítása) a díj megfizetésével <strong>azonnal és teljes egészében teljesül</strong>.
        A fizetés előtt a Feladó — külön, kifejezett jelölőnégyzettel — nyilatkozik arról, hogy:
      </p>
      <ul>
        <li><strong>kéri a szolgáltatás azonnali megkezdését és teljesítését</strong>, és</li>
        <li>
          <strong>tudomásul veszi, hogy a szolgáltatás egészének teljesítését követően elállási /
          felmondási jogát elveszíti</strong> [Rendelet 29. &sect; (1) bek. a) pont].
        </li>
      </ul>
      <p>
        Ennek megfelelően a kapcsolatfelvételi adatok átadását követően a megfizetett díj nem
        követelhető vissza. Ez nem érinti a 4.1. pont szerinti díjmentes újraválasztás lehetőségét
        (ha a fuvar a Sofőr érdekkörében felmerülő okból hiúsul meg), és nem érinti a Feladónak a
        Sofőrrel szemben, a fuvarozási szerződésből eredő jogait, amelyeket a Felek egymás között
        érvényesítenek.
      </p>
      <p>
        <strong>6.3. Panaszkezelés:</strong> A Felhasználó panaszát a{' '}
        <strong>panasz@gofuvar.hu</strong> e-mail címen vagy a Szolgáltató székhelyére küldött postai
        levélben teheti meg. A Szolgáltató a beérkezett panaszt 30 napon belül érdemben kivizsgálja
        és írásban megválaszolja.
      </p>
      <p>
        <strong>6.4. Békéltető Testület:</strong> A panasz elutasítása esetén a fogyasztó jogosult
        a lakóhelye, vagy a Szolgáltató székhelye szerint illetékes Békéltető Testülethez fordulni.
        A Szolgáltató székhelye szerinti testület adatai:{' '}
        <strong>Csongrád-Csanád Megyei Békéltető Testület</strong> (Cím: 6721 Szeged, Párizsi krt. 8-12.,
        E-mail: bekelteto.testulet@csmkik.hu).
      </p>
      <p>
        Az Európai Unió más tagállamában élő fogyasztó Felhasználó a saját lakóhelye szerinti
        békéltető szervhez, illetve az Európai Fogyasztói Központok Hálózatához (ECC-Net) vagy
        az EU online vitarendezési platformhoz is fordulhat:{' '}
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
          ec.europa.eu/consumers/odr
        </a>.
      </p>

      <h3 style={{ marginTop: 24 }}>6.5. Automatizált értesítések és Címzetti adatok</h3>
      <p>
        <strong>Adatszolgáltatási felelősség:</strong> A Feladó kötelessége a Címzett pontos
        telefonszámának megadása. A Feladó szavatol azért, hogy rendelkezik a Címzett
        hozzájárulásával a telefonszám (és megadása esetén az email-cím) átadásához és az
        SMS-, illetve email-alapú tájékoztatáshoz.
      </p>
      <p>
        <strong>Az értesítési folyamat:</strong> A Szolgáltató a fuvar biztonsága és a hatékony
        kézbesítés érdekében az alábbi automatizált értesítéseket küldi ki a folyamat során:
      </p>
      <ol>
        <li><strong>Címzettnek (SMS):</strong> a csomag felvételekor — a 6 jegyű átvételi kód és a
          Sofőr elérhetősége (név, telefonszám).</li>
        <li><strong>Feladónak (email és platform-értesítés):</strong> visszaigazolás a sikeres
          kézbesítésről (a fuvar lezárásakor).</li>
        <li><strong>Címzettnek (email, amennyiben email-címe megadásra került):</strong> követési
          link az induló fuvarról, valamint visszaigazolás a sikeres kézbesítésről.</li>
      </ol>
      <p>
        A Szolgáltató fenntartja a jogot, hogy a folyamat támogatására további tranzakciós
        értesítéseket küldjön. Ezek az üzenetek <strong>nem reklámcélú megkeresések</strong>,
        hanem a fuvarozási szerződés teljesítéséhez szükséges tranzakciós értesítések, ezért nem
        esnek a 2008. évi XLVIII. törvény (Grtv.) hatálya alá. A Szolgáltató külön reklám-jellegű
        hírlevelet vagy promóciós SMS-t kizárólag kifejezett, dokumentált hozzájárulás alapján küld.
      </p>
      <p>
        <strong>Átvételi kód:</strong> A Címzett SMS-ben kapja meg a 6 jegyű kódot, amelynek
        közlése a Sofőrrel a teljesítés igazolásának alapfeltétele.
      </p>

      <h2 style={{ marginTop: 32 }}>7. Vita-rendezés a Platformon belül</h2>
      <p>
        A Felhasználók a köztük felmerülő vitákat elsősorban a Platformon belüli vita-funkción
        (&quot;Problémám van ezzel a fuvarral&quot;) keresztül rendezhetik.
      </p>
      <p>
        A Szolgáltató Admin-csapata a vitát a beadott bizonyítékok (fotók, GPS-log, in-app
        kommunikáció, átvételi kód státusza) alapján <strong>14 munkanapon belül</strong> bírálja
        el, és írásban közli az álláspontját a Felekkel. Mivel a Szolgáltató a fuvardíjat nem
        kezeli (4.2. pont), a döntés pénzmozgással nem jár: a döntés a Platformon belüli
        következményekre (pl. Trust Score, fiók-felfüggesztés, az eset dokumentálása), illetve a
        Felek közötti rendezés elősegítésére terjed ki. A Szolgáltató méltányosságból, saját
        döntése alapján a kapcsolatfelvételi díjat jóváírhatja vagy visszatérítheti — erre
        azonban a Felhasználónak alanyi joga nincs.
      </p>
      <p>
        Az Admin-álláspont a Feleket a bírósági igényérvényesítésben nem korlátozza (8. pont).
      </p>

      <h2 style={{ marginTop: 32 }}>8. Joghatóság, Irányadó Jog és Bíróság</h2>
      <p>
        Jelen ÁSZF-re és a Felhasználók közötti szerződésekre <strong>a magyar jog</strong> az
        irányadó. A Szolgáltató és a Felhasználó közötti vitás kérdésekben a Felek elsődlegesen
        békés egyezségre törekednek.
      </p>
      <p>
        Amennyiben békés rendezés nem lehetséges, a Felek alávetik magukat a Szolgáltató székhelye
        szerint hatáskörrel és illetékességgel rendelkező magyar bíróság (a hatáskörtől függően a{' '}
        <strong>Hódmezővásárhelyi Járásbíróság</strong> vagy a{' '}
        <strong>Szegedi Törvényszék</strong>) kizárólagos illetékességének.
      </p>
      <p>
        Fogyasztó-státuszú Felhasználó esetén a fenti illetékesség nem érinti a Polgári
        Perrendtartás (2016. évi CXXX. törvény) szerinti, a fogyasztó lakóhelye szerinti bírósági
        illetékességet, és nem érinti a fogyasztó Békéltető Testülethez fordulási jogát sem
        (lásd 6.4. pont).
      </p>
      <p>
        Az Európai Unió más tagállamában élő fogyasztó Felhasználó esetén a fogyasztói szerződésekre
        vonatkozó kötelező uniós védelmi szabályokat (a 593/2008/EK rendelet — „Róma I." — alapján)
        a jelen ÁSZF nem korlátozza. Ezeknél a Felhasználóknál a saját lakóhelye szerinti jog azon
        kógens rendelkezései, amelyektől a felek megállapodással nem térhetnek el, alkalmazandóak
        maradnak.
      </p>

      <h2 style={{ marginTop: 32 }}>9. Felhasználói Tartalom</h2>
      <p>
        A Felhasználó által feltöltött vagy közzétett tartalom (fuvar-leírás, fotók, üzenetek,
        értékelések, profil-adatok; továbbiakban: <strong>Felhasználói Tartalom</strong>) a feltöltő
        Felhasználó <strong>kizárólagos felelőssége</strong>. A Szolgáltató a Felhasználói Tartalmat
        nem ellenőrzi előzetesen, és annak valóságtartalmáért, jogszerűségéért nem felel.
      </p>
      <p>
        A Felhasználó szavatolja, hogy a feltöltött tartalomhoz a szükséges jogokkal rendelkezik, és
        az nem sért harmadik személyi vagy szerzői jogot, nem jogellenes, megtévesztő vagy sértő.
      </p>
      <p>
        A feltöltéssel a Felhasználó a Szolgáltatónak <strong>nem kizárólagos, díjmentes, a szolgáltatás
        nyújtásához szükséges felhasználási engedélyt</strong> ad a tartalom tárolására, megjelenítésére
        és kezelésére (pl. a hirdetésben való megjelenítés, illetve a vita-eljárásban bizonyítékként
        történő felhasználás). Az engedély terjedelme a szolgáltatás nyújtásához és a jogszabályi
        megőrzési időkhöz igazodik.
      </p>
      <p>
        <strong>Értékelések:</strong> a Felhasználó értékelése legyen valósághű és tárgyszerű, nem
        lehet rágalmazó vagy sértő. A Szolgáltató jogosult a nyilvánvalóan jogsértő, valótlan vagy
        sértő értékelést eltávolítani.
      </p>

      <h2 style={{ marginTop: 32 }}>10. Tiltott Magatartás és a Platform Megkerülésének Tilalma</h2>
      <p>A Platformon tilos különösen:</p>
      <ul>
        <li>hamis adatokkal vagy több párhuzamos fiók létrehozása, illetve más nevében jogosulatlan eljárás;</li>
        <li>az értékelési / Trust Score rendszer manipulálása (pl. valótlan értékelések);</li>
        <li>automatizált adatgyűjtés (scraping), a Platform biztonsági intézkedéseinek megkerülése, kártékony kód elhelyezése;</li>
        <li>más Felhasználók zaklatása, fenyegetése, megtévesztése.</li>
      </ul>
      <p>
        <strong>A Platform megkerülésének tilalma:</strong> a Felhasználók a Platformon megismert
        fuvart, megbízást vagy másik Felhasználót <strong>nem vihetik a Platformon kívülre a
        kapcsolatfelvételi díj megkerülése céljából</strong> (ide értve az elérhetőségek díjfizetés
        előtti cseréjét a chat- vagy kérdés-funkcióban). Az ilyen magatartás a 11. pont szerinti
        felfüggesztést vagy megszüntetést vonhatja maga után, és a Szolgáltató jogosult az elmaradt
        díjat érvényesíteni.
      </p>

      <h2 style={{ marginTop: 32 }}>11. Fiók Felfüggesztése és Megszüntetése</h2>
      <p>
        <strong>11.1.</strong> A Felhasználó a fiókját bármikor, indoklás nélkül megszüntetheti
        (a folyamatban lévő fuvarok lezárását követően). A személyes adatok kezelésére a megszüntetést
        követően az <a href="/adatkezeles">Adatkezelési Tájékoztatóban</a> rögzített megőrzési idők
        irányadók.
      </p>
      <p>
        <strong>11.2.</strong> A Szolgáltató jogosult a fiókot felfüggeszteni vagy megszüntetni, ha a
        Felhasználó megsérti a jelen ÁSZF-et, jogszabályt sért, tiltott árut ad fel vagy tiltott
        magatartást tanúsít (3.3., 10. pont), illetve ha a KYC-nyilatkozata valótlannak bizonyul.
      </p>
      <p>
        <strong>11.3.</strong> Nyitott (folyamatban lévő) fuvar esetén a Szolgáltató törekszik a
        tranzakció rendezett lezárására a vita-eljárás (7. pont), illetve a Felek megegyezése szerint.
        Súlyos vagy ismételt jogsértés esetén azonnali felfüggesztés alkalmazható.
      </p>
      <p>
        <strong>11.4.</strong> A platform integritásának, a Felhasználók biztonságának és a
        szolgáltatás zavartalan működésének védelme érdekében a Szolgáltató <strong>fenntartja a jogot,
        hogy bármely fiókot saját mérlegelése alapján — indokolással vagy a nélkül — felfüggesszen vagy
        megszüntessen</strong>. A Szolgáltató ezt a jogát rendeltetésszerűen, a jóhiszeműség és tisztesség
        követelménye szerint gyakorolja, és alapesetben kizárólag visszaélés gyanúja esetén alkalmazza —
        így különösen <strong>feltűnően gyakori vagy indokolatlan fuvarlemondás</strong>, tartósan alacsony
        Trust Score, csalás vagy a Felhasználók megtévesztésének gyanúja esetén.
      </p>
      <p>
        Ahol jogszabály kötelező előzetes értesítési időt vagy indokolási kötelezettséget ír elő —
        így különösen az üzleti felhasználók vonatkozásában az online közvetítő szolgáltatásokról szóló{' '}
        <strong>(EU) 2019/1150 rendelet (P2B)</strong> szerint — a Szolgáltató ezeket betartja. A fiók
        megszüntetése nem érinti a Felhasználó már megszerzett jogos követeléseit (pl. a Sofőrnek egy
        már teljesített fuvar után a Feladótól járó fuvardíjat), és nem mentesíti egyik
        Felet sem a megszüntetés előtt keletkezett kötelezettségei alól.
      </p>

      <h2 style={{ marginTop: 32 }}>12. A Felhasználó Kártalanítási Kötelezettsége</h2>
      <p>
        A Felhasználó köteles a Szolgáltatót (valamint tisztségviselőit, munkavállalóit és
        közreműködőit) <strong>mentesíteni és kártalanítani</strong> minden olyan, harmadik fél által
        támasztott igény, követelés, bírság, kár és igazolt költség (ideértve az indokolt jogi
        költségeket) alól, amely a Felhasználó következő magatartásából ered:
      </p>
      <ul>
        <li>a jelen ÁSZF megszegése;</li>
        <li>jogszabály vagy harmadik fél jogának megsértése;</li>
        <li>tiltott vagy engedély nélküli áru feladása (3.3. pont);</li>
        <li>a szolgáltatás visszaélésszerű vagy rendeltetésellenes használata.</li>
      </ul>
      <p>
        E kötelezettség a fogyasztóvédelmi és egyéb kógens jogszabályi korlátok között érvényesül,
        és nem terjed ki olyan kárra, amelyet a Szolgáltató saját felróható magatartása okozott.
      </p>

      <h2 style={{ marginTop: 32 }}>13. Az ÁSZF Módosítása</h2>
      <p>
        A Szolgáltató fenntartja a jogot az ÁSZF egyoldalú módosítására. A lényeges módosításokról
        a Felhasználókat a hatálybalépés előtt legalább 15 nappal e-mailben, vagy a platformon belüli
        (in-app) értesítés formájában tájékoztatja. Ha a Felhasználó a módosítást nem fogadja el,
        jogosult a fiókját a hatálybalépés napjáig <strong>díjmentesen, indoklás nélkül</strong>{' '}
        megszüntetni; folyamatban lévő fuvarjait a régi ÁSZF szerint végzi be.
      </p>
      <p>
        Az új ÁSZF a hatálybalépés napjától, illetve az új regisztrálók esetén a regisztráció
        pillanatától alkalmazandó.
      </p>

      <h2 style={{ marginTop: 32 }}>14. Vegyes Rendelkezések</h2>
      <p>
        <strong>14.1. Részleges érvénytelenség:</strong> ha a jelen ÁSZF bármely rendelkezése
        érvénytelennek vagy végrehajthatatlannak bizonyul, az a többi rendelkezés érvényességét nem
        érinti. Az érvénytelen rendelkezés helyébe — lehetőség szerint — a felek eredeti gazdasági
        szándékához legközelebb álló, érvényes rendelkezés lép.
      </p>
      <p>
        <strong>14.2. Teljes megállapodás:</strong> a jelen ÁSZF és az{' '}
        <a href="/adatkezeles">Adatkezelési Tájékoztató</a> együttesen képezi a Szolgáltató és a
        Felhasználó közötti teljes megállapodást a Platform használatára vonatkozóan.
      </p>
      <p>
        <strong>14.3. Engedményezés:</strong> a Felhasználó a jelen szerződésből eredő jogait és
        kötelezettségeit a Szolgáltató előzetes írásbeli hozzájárulása nélkül nem ruházhatja át.
        A Szolgáltató jogosult a szerződést jogutódlás, cégátalakulás vagy üzletág-átruházás keretében
        — a Felhasználó előzetes tájékoztatása mellett — átruházni; ez a Felhasználó jelen ÁSZF és a
        jogszabályok szerinti jogait nem csorbítja.
      </p>
      <p>
        <strong>14.4. Joglemondás kizárása:</strong> ha a Szolgáltató valamely jogát nem vagy
        késedelmesen érvényesíti, az nem minősül az adott jogról való lemondásnak.
      </p>

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/adatkezeles">Adatkezelési Tájékoztató (GDPR)</a>
      </p>
    </article>
  );
}
