// GoFuvar Bottom Tab Bar — az app alsó navigáció sávja.
//
// 5 tab: Főoldal, Fuvarok, + Hirdetés (kiemelt), Értesítések, Profil
//
// A tab bar MINDIG látható a fő képernyőkön, de ELTŰNIK a részletes
// oldalakon (fuvar detail, lezárás, fizetés, stb.) — ahogy az
// Uber/Bolt/Revolut is csinálja.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { colors, spacing } from '@/theme';

// Mely útvonalakon JELENJEN MEG a tab bar
const TAB_VISIBLE_ROUTES = [
  '/hub',
  '/fuvarok',
  '/feladas/utvonalak',
  '/ertesitesek',
  '/profil',
  '/hirdeteseim',
  '/sajat-fuvaraim',
  '/utvonalaim',
  '/licitjeim',
  '/feladas/foglalasaim',
  '/feladas/sajat',
  '/ai-chat',
];

type Tab = {
  route: string;
  icon: string;
  activeIcon: string;
  label: string;
  isCenter?: boolean;
  badge?: number;
};

export default function BottomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setLoggedIn(!!u);
      if (u) {
        api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
      }
    });
  }, [pathname]);

  // Ne mutassuk a tab bart ha nincs bejelentkezve vagy részletes oldalon vagyunk
  if (!loggedIn) return null;
  const shouldShow = TAB_VISIBLE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
  if (!shouldShow && pathname !== '/hub') return null;

  const tabs: Tab[] = [
    { route: '/hub', icon: '🏠', activeIcon: '🏠', label: 'Főoldal' },
    { route: '/fuvarok', icon: '🎯', activeIcon: '🎯', label: 'Fuvarok' },
    { route: '/feladas/uj', icon: '➕', activeIcon: '➕', label: 'Hirdetés', isCenter: true },
    { route: '/ertesitesek', icon: '🔔', activeIcon: '🔔', label: 'Értesítések', badge: unread },
    { route: '/profil', icon: '👤', activeIcon: '👤', label: 'Profil' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = pathname === tab.route;
          return (
            <Pressable
              key={tab.route}
              style={[styles.tab, tab.isCenter && styles.centerTab]}
              onPress={() => router.push(tab.route as any)}
            >
              {tab.isCenter ? (
                <View style={styles.centerButton}>
                  <Text style={styles.centerIcon}>{tab.icon}</Text>
                </View>
              ) : (
                <>
                  <View style={{ position: 'relative' }}>
                    <Text style={[styles.icon, isActive && styles.iconActive]}>
                      {tab.icon}
                    </Text>
                    {tab.badge && tab.badge > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {tab.badge > 99 ? '99+' : String(tab.badge)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.label, isActive && styles.labelActive]}>
                    {tab.label}
                  </Text>
                  {isActive && <View style={styles.activeIndicator} />}
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 20 : 0, // safe area
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    position: 'relative',
  },
  centerTab: {
    marginTop: -20,
  },
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  centerIcon: {
    fontSize: 22,
  },
  icon: {
    fontSize: 22,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  activeIndicator: {
    position: 'absolute',
    top: -8,
    width: 20,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#ef4444',
    borderRadius: 999,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
});
