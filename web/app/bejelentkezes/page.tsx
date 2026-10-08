'use client';

// Bejelentkezés + Regisztráció egyben — toggle-lel váltogatható.
// A Vercel-es prod deployhoz kellett a regisztráció, mert a seed
// felhasználók nem léteznek a Neon DB-ben, és új usert csak curl-lel
// lehetett korábban létrehozni.
//
// Query param-mal lehet előre beállítani a fület:
//   /bejelentkezes              → alapból "login"
//   /bejelentkezes?mode=register → alapból "register" (landing CTA-hoz)
//   …&next=/dashboard/uj-fuvar   → belépés/regisztráció után oda (B2)
//   …&szerep=szallito            → szállító módban indul, kötelező telefon (UX Q3)
//   …&fiok=ceg                   → a „Cégként" fül van kiválasztva (UX Q3)
//
// UX-kör A10 (2026-10-08): elöl a lényeg (e-mail-cím, jelszó, név), a hiba a
// saját mezője alatt jelenik meg, és hibás űrlapnál kérés sem indul (eddig
// minden próba a szerverig ment, és beleszámított az óránként 5 regisztráció
// / IP limitbe — egy háztartás egy órára kizárhatta magát).
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { biztonsagosBelsoUt } from '@/lib/navigacio';
import { CircleAlert, Eye, EyeOff, Gift } from 'lucide-react';
import { api } from '@/api';
import { HozasdElLoginHint } from '@/components/HozasdElContinuation';
import FieldError from '@/components/FieldError';
import SegmentedControl from '@/components/SegmentedControl';
import { setCurrentUser, homeForRole, initStoredModeFromProfile, Role } from '@/lib/auth';
import {
  requiredEmailError, newPasswordError, loginPasswordError, registrationNameError,
  optionalPhoneError, requiredPhoneError, companyNameError, taxIdError,
} from '@/lib/formValidation';

type Mode = 'login' | 'register';
type Mezo = 'email' | 'password' | 'fullName' | 'companyName' | 'taxId' | 'phone';

/** A mezők DOM-sorrendje — a fókusz az ELSŐ hibásra ugrik. */
const MEZO_SORREND: Mezo[] = ['email', 'password', 'fullName', 'phone', 'companyName', 'taxId'];
const MEZO_ID: Record<Mezo, string> = {
  email: 'auth-email', password: 'auth-password', fullName: 'reg-name',
  phone: 'reg-phone', companyName: 'reg-cegnev', taxId: 'reg-adoszam',
};

/** A backend hibakódjai → melyik mező alatt jelenjen meg az üzenet. */
function szerverHibaMezo(err: { code?: string; status?: number }): Mezo | null {
  if (err.code === 'NAME_HAS_DIGITS') return 'fullName';
  if (err.code === 'EMAIL_TAKEN' || err.status === 409) return 'email';
  return null;
}

function BejelentkezesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailVerified = searchParams.get('email_verified') === '1';
  const initialMode: Mode = !emailVerified && searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<Mode>(initialMode);
  // A szállítói landingről érkezett (Q3): szállító módban indul, a telefon kötelező.
  const szallito = searchParams.get('szerep') === 'szallito';
  // Ajánlói kód: a linkből (?ref=…) előtöltve, de a regisztrációs mezőben
  // kézzel is beírható/módosítható (akinek csak a kódot adták, nem a linket).
  const refALinkbol = (searchParams.get('ref') || '').trim().toUpperCase();
  const [refCode, setRefCode] = useState(refALinkbol);
  // A ritkábban kellő mezők (ajánlói kód, opcionális telefon) összecsukva —
  // ajánlói linkkel érkezve nyitva, kitöltve.
  const [extraNyitva, setExtraNyitva] = useState(Boolean(refALinkbol));
  // GF-014 (Manus, 2026-08-30): a zöld „Meghívóval regisztrálsz!" jelvény
  // eddig BÁRMILYEN beírt kódra megjelent, szerver-ellenőrzés nélkül — az
  // elgépelt kóddal regisztráló azt hitte, jár a jutalom, pedig az
  // attribúció némán elmaradt. Most debounce-os szerver-ellenőrzés fut, és
  // a jelvény csak IGAZOLT kódra zöld; ismeretlen kódnál szelíd
  // figyelmeztetés (a regisztrációt nem blokkolja — a backend enélkül is
  // átengedi, csak attribúció nélkül).
  const [refStatus, setRefStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  useEffect(() => {
    if (!refCode) { setRefStatus('idle'); return; }
    setRefStatus('checking');
    let elavult = false;
    const t = setTimeout(() => {
      api.referralCheck(refCode)
        .then((r) => { if (!elavult) setRefStatus(r.valid ? 'valid' : 'invalid'); })
        // Hálózati hibánál nem ijesztgetünk: semleges állapot marad.
        .catch(() => { if (!elavult) setRefStatus('idle'); });
    }, 400);
    return () => { elavult = true; clearTimeout(t); };
  }, [refCode]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  // Céges regisztráció
  const [accountType, setAccountType] = useState<'individual' | 'company'>(
    searchParams.get('fiok') === 'ceg' ? 'company' : 'individual',
  );
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [companyRegNumber, setCompanyRegNumber] = useState('');
  const [euVatNumber, setEuVatNumber] = useState('');
  const [billingAddress, setBillingAddress] = useState('');

  const [error, setError] = useState<string | null>(null);
  // A szerver által egy konkrét mezőhöz kötött hiba (pl. foglalt e-mail-cím).
  const [szerverHiba, setSzerverHiba] = useState<{ mezo: Mezo; uzenet: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // Mezőszintű hibák: a beküldési próba UTÁN mind, előtte csak az elhagyott
  // (blur) mezőké — gépelés közben nem kiabálunk.
  const [probalt, setProbalt] = useState(false);
  const [erintett, setErintett] = useState<Partial<Record<Mezo, boolean>>>({});

  const register = mode === 'register';
  const ceg = register && accountType === 'company';
  // A telefon szállítóként kötelező: a díj után a feladó ezen éri el (a
  // szállítói kapu amúgy is bekéri — itt egy lépéssel előbb kérjük).
  const telefonKotelezo = register && szallito;

  const hibak: Partial<Record<Mezo, string | null>> = {
    email: requiredEmailError(email),
    password: register ? newPasswordError(password) : loginPasswordError(password),
    ...(register ? {
      fullName: registrationNameError(fullName),
      phone: telefonKotelezo ? requiredPhoneError(phone) : optionalPhoneError(phone),
      ...(ceg ? { companyName: companyNameError(companyName), taxId: taxIdError(taxId) } : {}),
    } : {}),
  };
  const mutat = (m: Mezo): string | null => {
    if (szerverHiba?.mezo === m) return szerverHiba.uzenet;
    return probalt || erintett[m] ? hibak[m] ?? null : null;
  };
  const elhagy = (m: Mezo) => () => setErintett((e) => ({ ...e, [m]: true }));
  const mezoProps = (m: Mezo) => {
    const h = mutat(m);
    return {
      id: MEZO_ID[m],
      onBlur: elhagy(m),
      'aria-invalid': h ? true : undefined,
      'aria-describedby': h ? `${MEZO_ID[m]}-hiba` : undefined,
    } as const;
  };

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSzerverHiba(null);
    setProbalt(true);
    // Hibás űrlap NEM megy a szerverre (a regisztrációs limit 5/óra/IP).
    const elsoHibas = MEZO_SORREND.find((m) => hibak[m]);
    if (elsoHibas) {
      // A telefon az összecsukott részben lehet — előbb kinyitjuk.
      if (elsoHibas === 'phone' && !telefonKotelezo) setExtraNyitva(true);
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>(`#${MEZO_ID[elsoHibas]}`);
        el?.focus();
      });
      return;
    }
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({
              email: email.trim(),
              password,
              full_name: fullName.trim(),
              phone: phone.trim(),
              account_type: accountType,
              ...(refCode ? { ref: refCode } : {}),
              ...(accountType === 'company' ? {
                company_name: companyName.trim(),
                tax_id: taxId.trim(),
                company_reg_number: companyRegNumber.trim() || undefined,
                eu_vat_number: euVatNumber.trim() || undefined,
                billing_address: billingAddress.trim() || undefined,
              } : {}),
            });

      belepesUtan(res);
    } catch (err: any) {
      // GF-001/002 (Manus-regresszió, 2026-08-30): cold startnál a kérés a
      // kliens időkereténél tovább tarthat, MIKÖZBEN a szerver feldolgozza —
      // regisztrációnál a fiók ilyenkor MÁR LÉTREJÖTT, csak a válasz veszett
      // el. Időtúllépés után ezért egy csendes belépési próbát teszünk
      // ugyanazokkal az adatokkal: ha él a fiók, be is léptetjük, nem hamis
      // hibát mutatunk.
      const idotullepes = /nem válaszolt időben/i.test(err?.message || '');
      if (idotullepes) {
        try {
          const res2 = await api.login(email, password);
          belepesUtan(res2);
          return;
        } catch { /* marad az eredeti hibaüzenet */ }
      }
      const mezo = register ? szerverHibaMezo(err || {}) : null;
      if (mezo) {
        setSzerverHiba({ mezo, uzenet: err.message });
        requestAnimationFrame(() => {
          formRef.current?.querySelector<HTMLElement>(`#${MEZO_ID[mezo]}`)?.focus();
        });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function belepesUtan(res: { token: string; user: any }) {
      setCurrentUser(
        {
          id: res.user.id,
          email: (res.user as any).email,
          role: res.user.role as Role,
          full_name: (res.user as any).full_name,
          account_type: (res.user as any).account_type,
          // ⚠️ 2026-08-16: EZ A MEZŐ HIÁNYZOTT — és emiatt a fejléc-avatar
          // javítása (PR #182) NEM MŰKÖDÖTT. A backend a login-válaszban már
          // küldte az avatar_url-t, de ez a kézzel írt mező-lista itt a
          // küszöbön ELDOBTA: a tárolt user-objektumba nem került be, a
          // fejléc pedig abból dolgozik. Ezért nem segített a ki- és
          // bejelentkezés sem. Tanulság: a válasz „tartalmazza" még nem
          // jelenti, hogy a kliens „eltárolja" — a láncot a TÁROLÁSIG kell
          // követni.
          avatar_url: (res.user as any).avatar_url ?? null,
        },
        res.token,
      );
      // GF-006: első belépéskor (nincs mentett mód) a szerver-adat dönt —
      // egy szállító fiókja szállító-módban nyíljon, ne „Feladó mód"-ban.
      // UX-kör Q3: a szállítói landingről regisztráló szállító módban kezd.
      initStoredModeFromProfile(res.user as any, register && szallito ? 'driver' : undefined);
      // ?next= (2026-09-11, B2): a védett oldal, ahonnan a belépéshez küldtük —
      // CSAK belső, relatív cél (nyílt átirányítás ellen: lib/navigacio.ts).
      const cel = biztonsagosBelsoUt(searchParams.get('next')) ?? homeForRole(res.user.role as Role);
      router.push(cel);
      // GF-002 (Manus 3. futás, INTERMITTÁLÓ): ritkán a kliens-oldali
      // navigáció elakad — a session él, de az oldal a login-űrlapon marad.
      // A gyökér nem-determinisztikus router-race; a watchdog a gyökértől
      // függetlenül garantálja a továbblépést: ha 2 mp múlva még mindig a
      // belépés-oldalon állunk, kemény navigációval pótoljuk (a teljes
      // újratöltés friss bundle-t és friss socketet is hoz — csak nyerünk).
      setTimeout(() => {
        if (window.location.pathname.startsWith('/bejelentkezes')) {
          window.location.assign(cel);
        }
      }, 2000);
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setSzerverHiba(null);
    setProbalt(false);
    setErintett({});
  }

  const telefonMezo = (
    <>
      <label htmlFor="reg-phone">
        Telefonszám {telefonKotelezo
          ? <span style={{ color: 'var(--danger-text)', fontWeight: 700 }}>(szállítóként kötelező)</span>
          : '(opcionális)'}
      </label>
      <input
        {...mezoProps('phone')}
        className="input"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="next"
        value={phone}
        onChange={(e) => { setPhone(e.target.value); if (szerverHiba?.mezo === 'phone') setSzerverHiba(null); }}
        placeholder="+36 30 123 4567"
      />
      <FieldError id="reg-phone-hiba">{mutat('phone')}</FieldError>
    </>
  );

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      {emailVerified && mode === 'login' && (
        <div role="status" className="callout" style={{
          background: 'var(--success-light)', border: '1px solid var(--success)',
          color: 'var(--success-text)', marginBottom: 20,
        }}>
          Az e-mail-címedet sikeresen megerősítettük. Bejelentkezhetsz!
        </div>
      )}
      {/* ── Tab-váltó ── (UX A29: valódi fülsor — role=tab + aria-selected,
          a /fuvarjaim mintájára; az aria-pressed „be/ki" kapcsolót jelentett) */}
      <div
        role="tablist"
        aria-label="Belépés vagy regisztráció"
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 4,
          border: '1px solid var(--border)',
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          aria-controls="auth-urlap"
          onClick={() => switchMode('login')}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 10,
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: mode === 'login' ? 'var(--primary)' : 'transparent',
            color: mode === 'login' ? '#fff' : 'var(--muted)',
          }}
        >
          Belépés
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          aria-controls="auth-urlap"
          onClick={() => switchMode('register')}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 10,
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: mode === 'register' ? 'var(--primary)' : 'transparent',
            color: mode === 'register' ? '#fff' : 'var(--muted)',
          }}
        >
          Regisztráció
        </button>
      </div>

      <h1 style={{ marginTop: 0 }}>
        {mode === 'login' ? 'Üdv újra!' : szallito ? 'Csatlakozz szállítóként' : 'Csatlakozz a GoFuvarhoz'}
      </h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>
        {mode === 'login'
          ? 'Lépj be a fiókodba a folytatáshoz.'
          : 'Pár másodperc az egész. Ingyenes, és nincs havidíj.'}
      </p>

      {searchParams.get('next') === '/dashboard/uj-fuvar' && <HozasdElLoginHint />}

      <form id="auth-urlap" ref={formRef} noValidate onSubmit={onSubmit} className="card">
        {register && refCode && refStatus === 'valid' && (
          <div style={{
            background: 'var(--success-light)', border: '1px solid var(--success)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14,
            color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <Gift size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Meghívóval regisztrálsz! Miután teljesíted az első fuvarodat,
              az ismerősöd egy ingyenes kapcsolatfelvételt kap.
            </span>
          </div>
        )}
        {register && refCode && refStatus === 'invalid' && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14,
            color: 'var(--muted)',
          }}>
            Ezt az ajánlói kódot nem találjuk — ellenőrizd, jól írtad-e be.
            A regisztráció enélkül is működik.
          </div>
        )}

        {/* ── A lényeg elöl: e-mail-cím + jelszó (mobilon is az első képernyőn) ── */}
        <label htmlFor="auth-email">E-mail-cím</label>
        <input
          {...mezoProps('email')}
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          enterKeyHint="next"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (szerverHiba?.mezo === 'email') setSzerverHiba(null); }}
          placeholder="pelda@email.hu"
          required
        />
        <FieldError id="auth-email-hiba">{mutat('email')}</FieldError>

        <label htmlFor="auth-password">Jelszó</label>
        <div style={{ position: 'relative' }}>
          <input
            {...mezoProps('password')}
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={register ? 'Legalább 8 karakter' : ''}
            minLength={register ? 8 : undefined}
            autoComplete={register ? 'new-password' : 'current-password'}
            enterKeyHint={register ? 'next' : 'go'}
            required
            style={{ paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', padding: 6, display: 'flex', marginTop: 2,
            }}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <FieldError id="auth-password-hiba">{mutat('password')}</FieldError>

        {register && (
          <>
            <label htmlFor="reg-name">Teljes név</label>
            <input
              {...mezoProps('fullName')}
              className="input"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              value={fullName}
              maxLength={100}
              onChange={(e) => { setFullName(e.target.value); if (szerverHiba?.mezo === 'fullName') setSzerverHiba(null); }}
              placeholder="Pl. Kovács Péter"
              required
            />
            <FieldError id="reg-name-hiba">{mutat('fullName')}</FieldError>

            {/* Szállítóként a telefon kötelező, ezért nem rejtjük el */}
            {telefonKotelezo && telefonMezo}

            {/* Magánszemély / Cég — rádiócsoport (UX A29): a „Fiók típusa"
                címke a csoport neve, a kiválasztott elem hallható. */}
            <div id="fiok-tipusa-cimke" className="mezo-cimke" style={{ marginTop: 14 }}>Fiók típusa</div>
            <SegmentedControl
              cimkeId="fiok-tipusa-cimke"
              ertek={accountType}
              onValtozas={setAccountType}
              opciok={[
                { ertek: 'individual', felirat: 'Magánszemélyként' },
                { ertek: 'company', felirat: 'Cégként' },
              ]}
              style={{ borderRadius: 10, padding: 3, marginTop: 4, marginBottom: 8 }}
              gombStilus={{ padding: '8px 0', borderRadius: 8, fontSize: 13 }}
            />

            {accountType === 'company' && (
              <div style={{
                padding: 16,
                background: 'rgba(37,99,235,0.05)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                marginBottom: 8,
              }}>
                <label htmlFor="reg-cegnev">Cégnév <span style={{ color: 'var(--danger-text)', fontWeight: 700 }}>*</span></label>
                <input
                  {...mezoProps('companyName')}
                  className="input"
                  type="text"
                  autoComplete="organization"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  // NEM „GoFuvar Kft." — nincs ilyen cég (az üzemeltető a
                  // Tiszta Hód Kft.), és a példa azt sugallná, hogy van.
                  placeholder="Pl. Példa Kereskedelmi Kft."
                  required
                />
                <FieldError id="reg-cegnev-hiba">{mutat('companyName')}</FieldError>
                <label htmlFor="reg-adoszam">Adószám <span style={{ color: 'var(--danger-text)', fontWeight: 700 }}>*</span></label>
                <input
                  {...mezoProps('taxId')}
                  className="input"
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="Pl. 12345678-1-42"
                  required
                />
                <FieldError id="reg-adoszam-hiba">{mutat('taxId')}</FieldError>
                <label htmlFor="reg-cegjegyzek">Cégjegyzékszám</label>
                <input
                  id="reg-cegjegyzek"
                  className="input"
                  type="text"
                  value={companyRegNumber}
                  onChange={(e) => setCompanyRegNumber(e.target.value)}
                  placeholder="Pl. 01-09-123456"
                />
                <label htmlFor="reg-eu-afa">EU ÁFA szám</label>
                <input
                  id="reg-eu-afa"
                  className="input"
                  type="text"
                  autoCapitalize="characters"
                  value={euVatNumber}
                  onChange={(e) => setEuVatNumber(e.target.value)}
                  placeholder="Pl. HU12345678"
                />
                <label htmlFor="reg-szamlazasi-cim">Számlázási cím</label>
                <input
                  id="reg-szamlazasi-cim"
                  className="input"
                  type="text"
                  autoComplete="street-address"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  placeholder="Pl. 1051 Budapest, Nádor utca 1."
                />
              </div>
            )}

            {/* Ritkábban kell: ajánlói kód (+ feladónak az opcionális telefon).
                Ajánlói linkkel érkezve nyitva, kitöltve. */}
            <details
              open={extraNyitva}
              onToggle={(e) => setExtraNyitva((e.currentTarget as HTMLDetailsElement).open)}
              style={{ marginTop: 14 }}
            >
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--primary-text)' }}>
                {telefonKotelezo ? 'Van ajánlói kódod?' : 'Van ajánlói kódod, vagy megadnád a telefonszámod?'}
              </summary>
              {!telefonKotelezo && telefonMezo}
              <label htmlFor="reg-ref">Ajánlói kód (opcionális)</label>
              <input
                id="reg-ref"
                className="input"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={refCode}
                maxLength={16}
                onChange={(e) => setRefCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="Pl. BXWZ3LM"
                style={{ letterSpacing: 1, textTransform: 'uppercase' }}
              />
            </details>
          </>
        )}

        {error && (
          <p role="alert" style={{
            color: 'var(--danger-text)', marginTop: 12, fontSize: 14,
            display: 'flex', gap: 6, alignItems: 'flex-start',
          }}>
            <CircleAlert size={16} aria-hidden style={{ flexShrink: 0, marginTop: 3 }} />
            <span>{error}</span>
          </p>
        )}

        <button
          className="btn"
          type="submit"
          disabled={loading}
          style={{ marginTop: 16, width: '100%' }}
        >
          {loading
            ? mode === 'login'
              ? 'Belépés…'
              : 'Regisztráció…'
            : mode === 'login'
            ? 'Belépés →'
            : 'Fiók létrehozása →'}
        </button>

        {mode === 'login' && (
          <p style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
            <a href="/elfelejtett-jelszo" style={{ color: 'var(--primary-text)', textDecoration: 'none', fontWeight: 600 }}>
              Elfelejtetted a jelszót?
            </a>
          </p>
        )}

        {register && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            A regisztrációval elfogadod az{' '}
            <a href="/aszf" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
              ÁSZF-et
            </a>{' '}
            és az{' '}
            <a href="/adatkezeles" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
              Adatkezelési tájékoztatót
            </a>.
          </p>
        )}
      </form>
    </div>
  );
}

export default function Bejelentkezes() {
  return (
    <Suspense fallback={null}>
      <BejelentkezesContent />
    </Suspense>
  );
}
