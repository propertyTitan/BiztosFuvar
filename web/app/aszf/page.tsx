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
        fontSize: 15,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Általános Szerződési Feltételek (ÁSZF)</h1>
      <p className="muted" style={{ margin: 0 }}>
        <strong>Platform:</strong> GoFuvar (gofuvar.hu és a mobilalkalmazások)<br />
        <strong>Hatályos:</strong> 2026. május 12-től
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
        a fuvarozást vállaló (továbbiakban: <strong>Sofőr</strong>) között jön létre. A Szolgáltató szerepe
        az ajánlat-közvetítésre, a kommunikációs felület biztosítására, az átvételi kód generálására,
        a Barion letét kezelésének közvetítésére és a vita-rendezési eljárás lefolytatására korlátozódik.
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
        <strong>3.2.</strong> A tranzakciók megkezdése a személyazonosság (KYC) igazolásához kötött
        (Személyi igazolvány, Sofőröknél + Jogosítvány, Cégeknél + Cégkivonat és Adószám).
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
        <li>érvényes, az általa használt jármű kategóriájának megfelelő vezetői engedéllyel rendelkezik</li>
        <li>az általa használt jármű érvényes forgalmi engedéllyel és érvényes
          <strong> kötelező gépjármű felelősségbiztosítással (KGFB)</strong> rendelkezik (a KGFB a kötelező
          gépjármű-felelősségbiztosításról szóló 2009. évi LXII. törvény alapján a magyar jogban kötelező)</li>
        <li>a fuvarra <strong>alkohol- és kábítószer-mentesen</strong> érkezik, és a fuvar teljes idejében
          ebben az állapotban marad</li>
        <li>nem áll vezetéstől eltiltás vagy a járművezetést kizáró egészségügyi állapot alatt</li>
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
        <strong>4.1. Fizetés (Barion Escrow):</strong> A fuvardíjat a Feladó a Barion Payment Zrt.
        letéti rendszerén keresztül egyenlíti ki. A letét a sikeres kézbesítés (átvételi kód beolvasása)
        pillanatában szabadul fel a Sofőr részére.
      </p>
      <p>
        <strong>4.2. Platformhasználati díj:</strong> A Szolgáltató a Sofőr felé a teljes fuvardíj{' '}
        <strong>10%-a + 400 Ft fix adminisztrációs díjat</strong> számít fel, amely a Sofőr részére kifizetésre
        kerülő összegből kerül levonásra.
      </p>
      <p>
        <strong>4.3. Számlázás:</strong> A fuvardíj teljes (100%) összegéről a számlát/bizonylatot
        a <strong>Sofőr állítja ki a Feladó részére</strong>. A Szolgáltató a Platformhasználati díjról
        állít ki számlát a <strong>Sofőr részére</strong>.
      </p>

      <h2 style={{ marginTop: 32 }}>5. Lemondás, Kártérítési Felelősség és DAC7</h2>
      <p>
        <strong>5.1. Lemondás:</strong>
      </p>
      <ul>
        <li>
          <strong>Feladói lemondás (felvétel előtt):</strong> Amennyiben a fuvardíj letétbe helyezése
          (fizetés) már megtörtént, a Szolgáltató 8.000 Ft alatti fuvardíj esetén 400 Ft fix
          adminisztrációs díjat, 8.000 Ft feletti fuvardíj esetén a fuvardíj 5%-át vonja le.
          Fizetés előtti lemondás esetén díjmentes.
        </li>
        <li>
          <strong>Sofőri lemondás:</strong> A Feladó a kifizetett letét 100%-át maradéktalanul
          visszakapja, a Sofőr platformon belüli &quot;Trust Score&quot; értéke csökken; ismételt indokolatlan
          lemondás esetén a Szolgáltató a Sofőri fiókot felfüggesztheti.
        </li>
      </ul>
      <p>
        <strong>5.2. A Sofőr kártérítési felelőssége:</strong> A küldemény épségéért és hiánytalan
        átadásáért a fuvar átvételétől a sikeres kézbesítésig <strong>a Sofőr felel</strong>. A
        kártérítési felelősség felső határa a Feladó által a fuvar feladásakor megadott deklarált
        érték. Amennyiben a Feladó nem adott meg deklarált értéket, a Sofőr felelősségének alapértelmezett
        felső határa egységesen <strong>bruttó 50.000 Ft</strong>. A Szolgáltató a csomagok sérüléséért,
        elvesztéséért, késedelmes átadásáért nem felel.
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
          keresztül) jelezni kell. A 24 órás határidő után érkezett bejelentéseket a Szolgáltató jogosult
          érdemi vizsgálat nélkül elutasítani.
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
          <strong>Pénzügyi rendezés:</strong> elismert kár esetén a Szolgáltató közvetít a Felek között
          a fizetés módjáról; ha a fuvar még nyitott letéttel rendelkezik, a Sofőr hozzájárulásával
          a kártérítés a letétből vonható le. A Szolgáltató NEM biztosító — a kártérítést nem ő fizeti,
          csak a tranzakciót segíti.
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
        a Barion / Vercel / Supabase szolgáltatás tartós kiesése.
      </p>
      <p>
        Vis maior esetén a Szolgáltató jogosult az érintett fuvarokat felfüggeszteni, az escrow-t
        biztosítani, és a Feleket a megoldás módjáról értesíteni. Vis maior eredetű kárért a
        Szolgáltatót nem terheli kártérítési kötelezettség.
      </p>

      <h3 style={{ marginTop: 24 }}>5.6. DAC7</h3>
      <p>
        A Szolgáltató az adózás rendjéről szóló jogszabályok és a 2011/16/EU Tanácsi irányelv (DAC7)
        szerint <strong>adatot szolgáltat a Nemzeti Adó- és Vámhivatal (NAV) felé</strong> a Sofőrök
        platformon keresztül elért bevételeiről. Az adatszolgáltatás éves rendszerességgel történik,
        és a NAV-tól elvárt formátumban tartalmazza a Sofőr azonosító adatait, a tranzakciók számát
        és összegét.
      </p>

      <h2 style={{ marginTop: 32 }}>6. Fogyasztói Jogok: Elállás és Panaszkezelés</h2>
      <p>
        <strong>6.1. 14 napos elállási jog (B2C):</strong> A fogyasztó és a vállalkozás közötti
        szerződések részletes szabályairól szóló 45/2014. (II. 26.) Korm. rendelet alapján a
        fogyasztónak minősülő Feladót alapesetben 14 napos elállási jog illeti meg.
      </p>
      <p>
        <strong>6.2. Kivételszabály (Az elállási jog elvesztése):</strong> Tekintettel arra, hogy a
        platformon a fuvarozási szolgáltatás a Feladó kifejezett, előzetes beleegyezésével kezdődik meg,
        a Feladó elveszíti a 14 napos elállási jogát abban a pillanatban, amikor a szolgáltatás egésze
        teljesítésre kerül (a csomag sikeres kézbesítése megtörténik) [Rendelet 29. &sect; (1) bek. a) pont].
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

      <h3 style={{ marginTop: 24 }}>6.5. Automatizált SMS-értesítések és Címzetti adatok</h3>
      <p>
        <strong>Adatszolgáltatási felelősség:</strong> A Feladó kötelessége a Címzett pontos
        telefonszámának megadása. A Feladó szavatol azért, hogy rendelkezik a Címzett
        hozzájárulásával a telefonszám átadásához és az SMS-alapú tájékoztatáshoz.
      </p>
      <p>
        <strong>Az értesítési folyamat:</strong> A Szolgáltató a fuvar biztonsága és a hatékony
        kézbesítés érdekében összesen 5 db automatizált SMS-értesítést küld ki a folyamat során:
      </p>
      <ol>
        <li><strong>Címzettnek:</strong> Értesítés a csomag felvételéről (sofőr adatai + átvételi kód).</li>
        <li><strong>Címzettnek:</strong> Értesítés, amikor a sofőr 5 km-es körzeten belülre ér.</li>
        <li><strong>Címzettnek:</strong> Értesítés, amikor a sofőr 300 méteres körzeten belülre ér (&quot;A saroknál van&quot;).</li>
        <li><strong>Címzettnek:</strong> Visszaigazolás a sikeres kézbesítésről (a fuvar lezárásakor).</li>
        <li><strong>Feladónak:</strong> Visszaigazolás a sikeres kézbesítésről (a fuvar lezárásakor).</li>
      </ol>
      <p>
        Ezek az SMS-ek <strong>nem reklámcélú megkeresések</strong>, hanem a fuvarozási szerződés
        teljesítéséhez szükséges tranzakciós értesítések, ezért nem esnek a 2008. évi XLVIII. törvény
        (Grtv.) hatálya alá. A Szolgáltató külön reklám-jellegű hírlevelet vagy promóciós SMS-t kizárólag
        kifejezett, dokumentált hozzájárulás alapján küld.
      </p>
      <p>
        <strong>Átvételi kód:</strong> A Címzett az SMS-ben kapja meg a 6 jegyű kódot, amelynek
        közlése a Sofőrrel a teljesítés igazolásának alapfeltétele.
      </p>

      <h2 style={{ marginTop: 32 }}>7. Vita-rendezés a Platformon belül</h2>
      <p>
        A Felhasználók a köztük felmerülő vitákat elsősorban a Platformon belüli vita-funkción
        (&quot;Problémám van ezzel a fuvarral&quot;) keresztül rendezhetik. A vita megnyitásával az érintett
        fuvar escrow letéte automatikusan befagyasztásra kerül a vita lezárásáig.
      </p>
      <p>
        A Szolgáltató Admin-csapata a vitát a beadott bizonyítékok (fotók, GPS-log, in-app
        kommunikáció, átvételi kód státusza) alapján <strong>14 munkanapon belül</strong> bírálja
        el, és írásban közli a döntést a Felekkel. A döntés alapján a letét felszabadításra,
        részben vagy egészben visszatérítésre kerül.
      </p>
      <p>
        Az Admin-döntést a vesztes fél jogosult a következő pontban szabályozott bírósági úton
        támadni; a letét státusza azonban az Admin-döntés szerint alakul.
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

      <h2 style={{ marginTop: 32 }}>9. Az ÁSZF Módosítása</h2>
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

      <hr style={{ margin: '48px 0 24px', opacity: 0.3 }} />
      <p className="muted" style={{ fontSize: 13 }}>
        Kapcsolódó dokumentum: <a href="/adatkezeles">Adatkezelési Tájékoztató (GDPR)</a>
      </p>
    </article>
  );
}
