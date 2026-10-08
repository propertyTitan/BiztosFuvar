'use client';

import { JARAT_ENGEDELYEZVE } from '@/lib/features';

// GoFuvar Okos Dashboard — mód-váltó (Szállító / Feladó) + állapot-alapú.
//
// Szállító mód: aktív fuvarok → 1 nagy CTA, heti kereset, közeli munkák
// Feladó mód: saját hirdetések, foglalások, átvételi kódok
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser, readStoredMode, writeStoredMode } from '@/lib/auth';
import { useTranslation, formatPrice } from '@/lib/i18n';
import {
  FileText, Route as RouteIcon, ShoppingBag, Target, BarChart3, Tag,
  Truck, RefreshCw, Plus, ClipboardList, Package, Bell, User as UserIcon,
  BadgeCheck, Star, Ticket, MapPin, Flag, Camera, Receipt, Hourglass, ShieldCheck,
} from 'lucide-react';
import { kovetkezoLepes } from '@/lib/kovetkezoLepes';
import { szia } from '@/lib/nev';
import SegmentedControl from '@/components/SegmentedControl';
import StatusPill from '@/components/StatusPill';
import { ertekeles, mertek } from '@/lib/mertek';

type Mode = 'driver' | 'shipper';

export default function HomeHub() {
  const user = useCurrentUser();
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('shipper');
  const [unread, setUnread] = useState(0);
  const [driver, setDriver] = useState<any>(null);
  const [gameStats, setGameStats] = useState<any>(null);
  const [showKycWelcome, setShowKycWelcome] = useState(false);
  // BUG-017/018 fix: a KYC-kártya a VALÓS verifikációs státuszhoz kötött,
  // nem csak a localStorage-flaghez. Verifikált usernek sosem jelenik meg
  // (akkor sem, ha a flag hiányzik — pl. másik gépen/úton verifikált);
  // nem-verifikáltnak addig látszik, amíg el nem rejti.
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  // DAC7: az első teljesített fuvar után a backend adóazonosítót kér — a
  // szállító-módban erre banner figyelmeztet (a form a profilon van)
  const [taxData, setTaxData] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    const key = `gofuvar_kyc_welcome_${user.id}`;
    if (!localStorage.getItem(key)) {
      setShowKycWelcome(true);
    }
    let cancelled = false;
    const checkKyc = () => {
      api.getMyProfile()
        .then((p: any) => {
          if (cancelled) return;
          setKycStatus(p?.identity_kyc_status || 'none');
          setTaxData(p?.tax_data || null);
        })
        .catch(() => {});
    };
    checkKyc();
    // A KYC-modal sikeres feltöltés után eseményt szór — F5 nélkül frissülünk
    window.addEventListener('gofuvar:kyc-updated', checkKyc);
    return () => {
      cancelled = true;
      window.removeEventListener('gofuvar:kyc-updated', checkKyc);
    };
  }, [user?.id]);

  // A kártya csak akkor él, ha a user TÉNYLEG nincs verifikálva
  const kycCardVisible = showKycWelcome && kycStatus !== null && kycStatus !== 'verified';

  useEffect(() => {
    if (!user) return;
    api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
    api.getDriverDashboard().then(setDriver).catch(() => {});
    api.getGameStats().then(setGameStats).catch(() => {});
    // Tárolt mód visszaolvasása — FELHASZNÁLÓHOZ kötve (GF-006): másik fiók
    // módja nem szivároghat át, a sajátja viszont megmarad.
    const saved = readStoredMode();
    setMode(saved ?? 'shipper');
  }, [user]);

  function switchMode(m: Mode) {
    setMode(m);
    // A helper a fejléc mód-chipjét is értesíti (BUG-034: a főoldalt
    // elhagyva is látszódjon, melyik mód aktív)
    writeStoredMode(m);
  }

  if (!user) return null;

  const gs = gameStats;
  const d = driver;

  return (
    <div>
      {/* ===== Mód-váltó ===== (UX A29: rádiócsoport, a kiválasztott mód hallható) */}
      <SegmentedControl
        ariaLabel="Mód"
        ertek={mode}
        onValtozas={switchMode}
        opciok={[
          { ertek: 'driver', felirat: 'Szállító', ikon: <Truck size={15} aria-hidden /> },
          { ertek: 'shipper', felirat: 'Feladó', ikon: <Package size={15} aria-hidden /> },
        ]}
        style={{ maxWidth: 320, margin: '0 auto 24px' }}
      />

      {/* ===== SZÁLLÍTÓ MÓD ===== */}
      {mode === 'driver' && (
        <>
          {/* Fejléc: üdvözlés + heti kereset */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 20, flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <h1 style={{ margin: 0 }}>{szia(user.full_name, 'Szállító')}</h1>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {d ? `${d.level}. szint — ${d.levelName}` : ''}
                {d?.isVerified ? (
                  <>{' · '}<BadgeCheck size={13} color="var(--success)" style={{ verticalAlign: -2 }} /> Ellenőrzött</>
                ) : null}
                {d?.ratingCount > 0 ? (
                  <>{' · '}<Star size={13} color="var(--warning)" fill="var(--warning)" style={{ verticalAlign: -2 }} /> {ertekeles(d.ratingAvg)}</>
                ) : null}
                {d?.availableVouchers > 0 ? (
                  <>{' · '}<Ticket size={13} style={{ verticalAlign: -2 }} /> {d.availableVouchers} ingyenes kapcsolatfelvétel</>
                ) : null}
              </p>
            </div>
            {d && (
            <div style={{
              background: 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
              color: '#fff', padding: '12px 24px', borderRadius: 14, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, opacity: 0.85 }}>Heti kereset</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>
                {formatPrice(d.weekEarnings)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>{d.weekDeliveries} fuvar</div>
            </div>
            )}
          </div>

          {/* DAC7: adóazonosító-bekérés banner (az első teljesített fuvar
              után; a kitöltő űrlap a profilon) */}
          {taxData?.needed && (
            <Link
              href="/profil"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                marginBottom: 20, padding: '14px 18px', borderRadius: 12,
                textDecoration: 'none', color: 'inherit',
                background: taxData.blocked ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${taxData.blocked ? 'var(--danger)' : 'var(--warning)'}`,
              }}
            >
              <Receipt size={22} style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: 14 }}>
                  {taxData.blocked
                    ? 'Az ajánlattételed felfüggesztve — add meg az adóazonosító jeled'
                    : 'Add meg az adóazonosító jeled a profilodon'}
                </strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  Jogszabályi kötelezettség (DAC7)
                  {taxData.deadline && !taxData.blocked
                    // Hosszú alak, mint a profil adókártyáján (UX A18): a
                    // „2026. 12. 07.” rövid alak két helyen kétféle volt.
                    ? ` — határidő: ${new Date(taxData.deadline).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })}`
                    : ''} · Kattints a megadáshoz
                </div>
              </div>
            </Link>
          )}

          {/* KYC tájékoztató — szállító módban is, első belépéskor */}
          {kycCardVisible && (
            <div
              style={{
                marginBottom: 20,
                padding: 20,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.12))',
                border: '1px solid rgba(59,130,246,0.3)',
              }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <ShieldCheck size={32} aria-hidden style={{ flexShrink: 0, color: 'var(--primary-text)' }} />
                <div>
                  <strong style={{ fontSize: 16 }}>A fuvarvállaláshoz azonosítás szükséges</strong>
                  <p style={{ fontSize: 14, margin: '8px 0 0', lineHeight: 1.6 }}>
                    Ahhoz, hogy fuvart vállalhass vagy járatot hirdethess, szükséged van
                    (fuvar-feladáshoz nem kell okmány):
                  </p>
                  <ul style={{ fontSize: 13, margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
                    <li><strong>Személyi igazolvány</strong> fotója (az adatlap-oldal)</li>
                  </ul>
                  <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem(`gofuvar_kyc_welcome_${user.id}`, '1');
                        setShowKycWelcome(false);
                        // forras: a KYC-ablak sikerképernyője ebből tudja, hogy
                        // nincs félbehagyott ajánlat, amihez vissza kellene vinni.
                        window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', {
                          detail: { code: 'IDENTITY_KYC_REQUIRED', forras: 'fooldal' },
                        }));
                      }}
                      style={{
                        padding: '10px 22px', borderRadius: 8, border: 'none',
                        background: 'var(--success-strong)', color: '#fff', fontWeight: 700,
                        fontSize: 14, cursor: 'pointer',
                      }}
                    >
                      Megcsinálom most!
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem(`gofuvar_kyc_welcome_${user.id}`, '1');
                        setShowKycWelcome(false);
                      }}
                      style={{
                        padding: '10px 22px', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'transparent',
                        color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                      }}
                    >
                      Később
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ÁLLAPOT-ALAPÚ FŐ KÁRTYA */}
          {d && d.activeJobs?.length > 0 ? (
            // Van aktív fuvar → ez a fő tartalom
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--success)', display: 'inline-block',
                }} />
                Aktív fuvarjaid
              </h2>
              {d.activeJobs.map((j: any) => {
                // KÖZÖS „következő lépés” logika a Vállalt fuvarok füllel
                // (UX-review A5, 2026-10-08): a díj előtt NINCS cselekvésre
                // hívó gomb — eddig minden elfogadott fuvaron „INDÍTÁS →” állt,
                // a fizetetlenen is, ahol a csomag még nem vehető át.
                const lepes = kovetkezoLepes(j);
                const telepules = (cim?: string) => (cim || '').split(',')[0].replace(/^\d{4,6}\s+/, '');
                return (
                <Link
                  key={j.id}
                  href={`/sofor/fuvar/${j.id}`}
                  className="card"
                  style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    borderLeft: `4px solid ${j.status === 'in_progress' ? 'var(--success)' : lepes.kod === 'dijfizetes' ? 'var(--warning)' : 'var(--primary)'}`,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{j.title}</div>
                      <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <MapPin size={13} style={{ flexShrink: 0 }} />
                        {telepules(j.pickup_address)}
                        <span aria-hidden>→</span>
                        <Flag size={13} style={{ flexShrink: 0 }} />
                        {telepules(j.dropoff_address)}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Feladó: {j.shipper_name} · {mertek(j.distance_km, 'km')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {/* UX A11/A10: a közös állapot-jelvény (lib/statusz) — a
                          fuvaroldallal és a Vállalt fuvarokkal azonos felirat.
                          Fizetetlen fuvaron a lenti „Díjfizetésre vár” jelvény
                          mondja (ne kétszer). */}
                      {!lepes.jelveny && <StatusPill job={j} nezet="szallito" />}
                      <div className="price" style={{ marginTop: 8, fontSize: 18 }}>
                        {formatPrice(j.accepted_price_huf)}
                      </div>
                      {lepes.gomb && (
                        <div style={{
                          marginTop: 8, background: 'var(--primary)', color: '#fff',
                          padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}>
                          <Camera size={14} aria-hidden /> {lepes.gomb}
                        </div>
                      )}
                      {lepes.jelveny && (
                        <div
                          title={lepes.szoveg}
                          style={{
                            marginTop: 8, background: 'rgba(245,158,11,0.16)', color: 'var(--text)',
                            border: '1px solid var(--warning)',
                            padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 12,
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                          }}
                        >
                          <Hourglass size={13} aria-hidden /> {lepes.jelveny}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
                );
              })}
            </div>
          ) : (
            // Nincs aktív fuvar → közeli munkák CTA
            <div className="card" style={{
              textAlign: 'center', padding: 32, marginBottom: 24,
              border: '2px dashed var(--border)',
              background: 'var(--bg)',
            }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--primary-text)' }}><Target size={40} aria-hidden /></div>
              <h2 style={{ margin: '0 0 8px' }}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? `${d.nearbyJobsCount} fuvar vár a közeledben!`
                  : 'Böngészd az elérhető fuvarokat!'}
              </h2>
              <p className="muted" style={{ marginBottom: 16 }}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? 'Nézd meg az elérhető fuvarokat és tegyél ajánlatot.'
                  : JARAT_ENGEDELYEZVE
                    ? 'Nézz körül a fuvarok között, vagy hirdess meg egy járatot.'
                    : 'Nézz körül a fuvarok között, és tegyél ajánlatot arra, ami útba esik.'}
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/sofor/fuvarok" className="btn" style={{ textDecoration: 'none' }}>
                  <Target size={16} /> Fuvarok böngészése
                </Link>
                {JARAT_ENGEDELYEZVE && (
                  <Link href="/sofor/uj-utvonal" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                    Járat hirdetése
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Várakozó ajánlatok */}
          {d && d.pendingBidsCount > 0 && (
            <Link
              href="/fuvarjaim?tab=licitjeim"
              className="card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                textDecoration: 'none', color: 'inherit', marginBottom: 12,
                borderLeft: '4px solid var(--warning)',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag size={15} style={{ flexShrink: 0 }} /> {d.pendingBidsCount} ajánlatod válaszra vár
                </div>
                <div className="muted" style={{ fontSize: 13 }}>Koppints a részletekhez</div>
              </div>
              <span style={{ fontSize: 20 }}>→</span>
            </Link>
          )}

          {/* Gyors szállító linkek */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            {[
              { href: '/sofor/fuvarok', icon: <Target size={18} />, label: 'Fuvarok' },
              { href: '/sofor/dashboard', icon: <BarChart3 size={18} />, label: 'Statisztikám' },
              { href: '/fuvarjaim?tab=licitjeim', icon: <Tag size={18} />, label: 'Ajánlataim' },
              { href: '/fuvarjaim?tab=vallalt', icon: <Truck size={18} />, label: t('nav.myJobs') },
              { href: '/sofor/visszafuvar', icon: <RefreshCw size={18} />, label: 'Visszafuvar' },
              ...(JARAT_ENGEDELYEZVE ? [
                { href: '/sofor/uj-utvonal', icon: <Plus size={18} />, label: 'Új járat' },
                { href: '/sofor/utvonalaim', icon: <RouteIcon size={18} />, label: 'Járataim' },
              ] : []),
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  flex: '1 1 calc(33% - 10px)', minWidth: 130,
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                }}
                className="home-hub-card"
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{l.icon}</span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.2 }}>{l.label}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ===== FELADÓ MÓD ===== */}
      {mode === 'shipper' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0 }}>{szia(user.full_name, 'Feladó')}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Mit szeretnél szállíttatni ma?
            </p>
          </div>

          {/* Feladó módban NINCS KYC-kártya (2026-07-19, user-döntés): a
              feladónak nem kell személyi igazolvány — az azonosítás-felhívás
              csak a szállító módban él (ott kötelező). */}

          {/* Fő CTA: hirdetés feladás */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 14, marginBottom: 24,
          }}>
            <Link
              href="/dashboard/uj-fuvar"
              className="card home-hub-card"
              style={{
                textDecoration: 'none', color: 'inherit', textAlign: 'center',
                padding: 28, borderTop: '4px solid var(--primary)',
              }}
            >
              <div style={{ marginBottom: 8 }}><FileText size={36} color="var(--primary)" /></div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Fuvar feladása</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Szállítók ajánlatot tesznek rá</div>
            </Link>
            {JARAT_ENGEDELYEZVE && (
            <Link
              href="/dashboard/utvonalak"
              className="card home-hub-card"
              style={{
                textDecoration: 'none', color: 'inherit', textAlign: 'center',
                padding: 28, borderTop: '4px solid var(--success)',
              }}
            >
              <div style={{ marginBottom: 8 }}><RouteIcon size={36} color="var(--success)" /></div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Induló járatok</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Foglalj helyet egy szállítónál</div>
            </Link>
            )}
            <Link
              href="/hozasd-el"
              className="card home-hub-card"
              style={{
                textDecoration: 'none', color: 'inherit', textAlign: 'center',
                padding: 28, borderTop: '4px solid var(--warning)',
              }}
            >
              <div style={{ marginBottom: 8 }}><ShoppingBag size={36} color="var(--warning)" /></div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Hozasd el</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Online vásárlás linkből</div>
            </Link>
          </div>

          {/* Feladó gyors linkek */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { href: '/fuvarjaim?tab=hirdeteseim', icon: <ClipboardList size={18} />, label: t('nav.myListings') },
              ...(JARAT_ENGEDELYEZVE ? [{ href: '/fuvarjaim?tab=foglalasaim', icon: <Package size={18} />, label: t('nav.myBookings') }] : []),
              { href: '/ertesitesek', icon: <Bell size={18} />, label: t('nav.notifications'), badge: unread },
              { href: '/profil', icon: <UserIcon size={18} />, label: t('nav.profile') },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  flex: '1 1 calc(33% - 10px)', minWidth: 130,
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '12px 14px', borderRadius: 10, position: 'relative',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                }}
                className="home-hub-card"
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{l.icon}</span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.2 }}>{l.label}</span>
                {l.badge ? (
                  <span style={{
                    position: 'absolute', top: 6, right: 8,
                    background: 'var(--danger-strong)', color: '#fff', fontSize: 11,
                    fontWeight: 800, borderRadius: 999, padding: '1px 6px',
                  }}>{l.badge}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
