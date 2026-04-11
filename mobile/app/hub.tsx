// GoFuvar Okos Hub (mobil) — mód-váltó (Sofőr / Feladó) + állapot-alapú UI.
//
// Pontosan ugyanaz a logika, mint a web `HomeHub.tsx`:
// - Sofőr mód: aktív fuvar → nagy CTA, heti kereset, level/rating, gyors linkek
// - Feladó mód: 2 nagy CTA kártya (licites + fix áras) + gyors linkek
// - A mód AsyncStorage-ban él → legközelebbi indításkor visszajön
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api } from '@/api';
import { getCurrentUser, CurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius, typography, shadows } from '@/theme';

type Mode = 'driver' | 'shipper';

type QuickLink = {
  href: string;
  icon: string;
  label: string;
  badge?: number;
};

// HUF formázás (ugyanaz, mint a webes formatPrice)
function formatPrice(value?: number) {
  if (value == null) return '0 Ft';
  return `${Math.round(value).toLocaleString('hu-HU')} Ft`;
}

// Push notification regisztrálás — a user hub-ra érkezésekor
async function registerPushToken() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    const pushToken = await Notifications.getExpoPushTokenAsync();
    if (pushToken?.data) {
      await api.registerPushToken(pushToken.data).catch(() => {});
    }
  } catch {
    // Csendben: simulator-on vagy web-en nem megy a push
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function Hub() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [unread, setUnread] = useState(0);
  const [mode, setMode] = useState<Mode>('driver');
  const [driver, setDriver] = useState<any>(null);

  const load = useCallback(async () => {
    const u = await getCurrentUser();
    setUser(u);
    if (u) {
      joinUserRoom(u.id);
      try {
        const r = await api.unreadNotificationCount();
        setUnread(r.count);
      } catch {}
      api.getDriverDashboard().then(setDriver).catch(() => {});
      registerPushToken();
    }
  }, []);

  // Tárolt mód visszaolvasása
  useEffect(() => {
    AsyncStorage.getItem('gofuvar_mode').then((saved) => {
      if (saved === 'shipper' || saved === 'driver') setMode(saved as Mode);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onNew = () => setUnread((c) => c + 1);
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [user]);

  function switchMode(m: Mode) {
    setMode(m);
    AsyncStorage.setItem('gofuvar_mode', m).catch(() => {});
  }

  if (!user) {
    return <TruckLoader />;
  }

  const d = driver;

  // Sofőr gyors linkek
  const driverLinks: QuickLink[] = [
    { href: '/fuvarok',        icon: '🎯', label: 'Fuvarok' },
    { href: '/licitjeim',      icon: '🏷️', label: 'Licitjeim' },
    { href: '/sajat-fuvaraim', icon: '🚛', label: 'Saját fuvarok' },
    { href: '/uj-utvonal',     icon: '➕', label: 'Új útvonal' },
    { href: '/utvonalaim',     icon: '🛣️', label: 'Útvonalaim' },
  ];

  // Feladó gyors linkek
  const shipperLinks: QuickLink[] = [
    { href: '/hirdeteseim',         icon: '📋', label: 'Hirdetéseim' },
    { href: '/feladas/foglalasaim', icon: '📦', label: 'Foglalásaim' },
    { href: '/ertesitesek',         icon: '🔔', label: 'Értesítések', badge: unread },
    { href: '/profil',               icon: '👤', label: 'Profil' },
    { href: '/ai-chat',             icon: '🤖', label: 'AI segéd' },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />
      }
    >
      {/* ===== Mód-váltó pill ===== */}
      <View style={styles.modeSwitch}>
        <Pressable
          style={[styles.modeBtn, mode === 'driver' && styles.modeBtnActive]}
          onPress={() => switchMode('driver')}
        >
          <Text style={[styles.modeBtnText, mode === 'driver' && styles.modeBtnTextActive]}>
            🚛 Sofőr
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === 'shipper' && styles.modeBtnActive]}
          onPress={() => switchMode('shipper')}
        >
          <Text style={[styles.modeBtnText, mode === 'shipper' && styles.modeBtnTextActive]}>
            📦 Feladó
          </Text>
        </Pressable>
      </View>

      {/* ===== SOFŐR MÓD ===== */}
      {mode === 'driver' && (
        <>
          {/* Fejléc + heti kereset kártya */}
          <View style={styles.driverHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hello}>
                Szia, {user.full_name?.split(' ')[0] || 'Sofőr'}! 👋
              </Text>
              {d && (
                <Text style={styles.helloSub}>
                  Level {d.level} {d.levelName}
                  {d.isVerified ? ' · ✅' : ''}
                  {d.ratingCount > 0 ? ` · ⭐ ${Number(d.ratingAvg).toFixed(1)}` : ''}
                  {d.availableVouchers > 0 ? ` · 🎟️ ${d.availableVouchers}` : ''}
                </Text>
              )}
            </View>
            {d && (
              <View style={styles.earningsCard}>
                <Text style={styles.earningsLabel}>Heti kereset</Text>
                <Text style={styles.earningsValue}>{formatPrice(d.weekEarnings)}</Text>
                <Text style={styles.earningsLabel}>{d.weekDeliveries} fuvar</Text>
              </View>
            )}
          </View>

          {/* Állapot-alapú fő kártya */}
          {d && d.activeJobs && d.activeJobs.length > 0 ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={styles.sectionTitle}>🟢 Aktív fuvarjaid</Text>
              {d.activeJobs.map((j: any) => {
                const inProgress = j.status === 'in_progress';
                return (
                  <Pressable
                    key={j.id}
                    onPress={() => router.push(`/fuvar/${j.id}` as any)}
                    style={[
                      styles.activeJobCard,
                      { borderLeftColor: inProgress ? colors.success : colors.warning },
                    ]}
                  >
                    <Text style={styles.activeJobTitle} numberOfLines={1}>{j.title}</Text>
                    <Text style={styles.activeJobRoute} numberOfLines={1}>
                      📍 {j.pickup_address?.split(',')[0]} → 🏁 {j.dropoff_address?.split(',')[0]}
                    </Text>
                    <Text style={styles.activeJobMeta} numberOfLines={1}>
                      Feladó: {j.shipper_name} · {j.distance_km} km
                    </Text>
                    <View style={styles.activeJobFooter}>
                      <View style={[
                        styles.statusPill,
                        { backgroundColor: inProgress ? colors.successLight : colors.warningLight },
                      ]}>
                        <Text style={[
                          styles.statusPillText,
                          { color: inProgress ? colors.success : colors.warning },
                        ]}>
                          {inProgress ? '🟢 Úton' : '🟡 Elfogadva'}
                        </Text>
                      </View>
                      <Text style={styles.price}>{formatPrice(j.accepted_price_huf)}</Text>
                    </View>
                    <View style={[
                      styles.ctaButton,
                      { backgroundColor: inProgress ? colors.danger : colors.success },
                    ]}>
                      <Text style={styles.ctaButtonText}>
                        {inProgress ? '📸 LEZÁRÁS →' : '📸 INDÍTÁS →'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            // Nincs aktív fuvar → közeli munkák CTA
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji}>🎯</Text>
              <Text style={styles.emptyTitle}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? `${d.nearbyJobsCount} fuvar vár a közeledben!`
                  : 'Keress licitálható fuvarokat!'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {(d?.nearbyJobsCount || 0) > 0
                  ? 'Nézd meg a licitálható fuvarokat és tegyél ajánlatot.'
                  : 'Nézz körül, vagy hirdess meg egy fix áras útvonalat.'}
              </Text>
              <View style={styles.emptyButtons}>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => router.push('/fuvarok' as any)}
                >
                  <Text style={styles.primaryBtnText}>🎯 Fuvarok</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => router.push('/uj-utvonal' as any)}
                >
                  <Text style={styles.secondaryBtnText}>➕ Útvonal</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Várakozó licitek alert */}
          {d && d.pendingBidsCount > 0 && (
            <Pressable
              style={styles.alertCard}
              onPress={() => router.push('/licitjeim' as any)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>
                  🏷️ {d.pendingBidsCount} licitedre válaszra vár
                </Text>
                <Text style={styles.alertSubtitle}>Koppints a részletekhez</Text>
              </View>
              <Text style={styles.alertArrow}>→</Text>
            </Pressable>
          )}

          {/* Gyors sofőr linkek */}
          <View style={styles.quickLinks}>
            {driverLinks.map((l) => (
              <QuickLinkCard key={l.href} link={l} onPress={() => router.push(l.href as any)} />
            ))}
          </View>
        </>
      )}

      {/* ===== FELADÓ MÓD ===== */}
      {mode === 'shipper' && (
        <>
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.hello}>
              Szia, {user.full_name?.split(' ')[0] || 'Feladó'}! 👋
            </Text>
            <Text style={styles.helloSub}>Mit szeretnél szállíttatni ma?</Text>
          </View>

          {/* Fő CTA: 2 nagy kártya */}
          <View style={styles.shipperCtas}>
            <Pressable
              style={[styles.shipperCta, { borderTopColor: colors.primary }]}
              onPress={() => router.push('/feladas/uj' as any)}
            >
              <Text style={styles.shipperCtaIcon}>📝</Text>
              <Text style={styles.shipperCtaTitle}>Licites hirdetés</Text>
              <Text style={styles.shipperCtaSubtitle}>Sofőrök licitálnak rá</Text>
            </Pressable>
            <Pressable
              style={[styles.shipperCta, { borderTopColor: colors.success }]}
              onPress={() => router.push('/feladas/utvonalak' as any)}
            >
              <Text style={styles.shipperCtaIcon}>🛣️</Text>
              <Text style={styles.shipperCtaTitle}>Fix áras útvonal</Text>
              <Text style={styles.shipperCtaSubtitle}>Foglalj helyet sofőrnél</Text>
            </Pressable>
          </View>

          {/* Gyors feladó linkek */}
          <View style={styles.quickLinks}>
            {shipperLinks.map((l) => (
              <QuickLinkCard key={l.href} link={l} onPress={() => router.push(l.href as any)} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function QuickLinkCard({ link, onPress }: { link: QuickLink; onPress: () => void }) {
  return (
    <Pressable style={styles.quickLinkCard} onPress={onPress}>
      <Text style={styles.quickLinkIcon}>{link.icon}</Text>
      <Text style={styles.quickLinkLabel} numberOfLines={1}>{link.label}</Text>
      {link.badge && link.badge > 0 ? (
        <View style={styles.quickLinkBadge}>
          <Text style={styles.quickLinkBadgeText}>
            {link.badge > 99 ? '99+' : String(link.badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },

  // ── Mód-váltó pill ──
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    alignSelf: 'center',
    maxWidth: 320,
    width: '100%',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.primary,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  modeBtnTextActive: {
    color: '#fff',
  },

  // ── Sofőr fejléc ──
  driverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  hello: {
    ...typography.h1,
    color: colors.text,
  },
  helloSub: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  earningsCard: {
    backgroundColor: colors.success,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    ...shadows.sm,
  },
  earningsLabel: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.85,
  },
  earningsValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    marginVertical: 2,
  },

  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // ── Aktív fuvar kártya ──
  activeJobCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  activeJobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  activeJobRoute: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  activeJobMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  activeJobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  statusPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  price: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  ctaButton: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  ctaButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Üres állapot kártya ──
  emptyCard: {
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  emptyButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },

  // ── Várakozó licit alert ──
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  alertSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  alertArrow: {
    fontSize: 20,
    color: colors.textMuted,
  },

  // ── Feladó CTA-k ──
  shipperCtas: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  shipperCta: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    padding: spacing.md,
    alignItems: 'center',
    ...shadows.sm,
  },
  shipperCtaIcon: {
    fontSize: 36,
    marginBottom: 6,
  },
  shipperCtaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  shipperCtaSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  // ── Quick links grid ──
  quickLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quickLinkCard: {
    flexBasis: '31%',
    flexGrow: 1,
    minWidth: 100,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    alignItems: 'center',
    position: 'relative',
  },
  quickLinkIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  quickLinkLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  quickLinkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.danger,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  quickLinkBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
