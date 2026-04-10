// Guruló teherautó loading animáció — a GoFuvar védjegye.
//
// Használat: <TruckLoader /> bárhol ahol "Betöltés..." szöveg volt.
// Egy kis 🚛 gurul balról jobbra egy útvonal mentén, alatta "Betöltés…".
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { colors, spacing } from '@/theme';

export default function TruckLoader({ text = 'Betöltés…' }: { text?: string }) {
  const truckX = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(truckX, {
          toValue: 220,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(truckX, {
          toValue: -20,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [truckX]);

  return (
    <View style={styles.container}>
      <View style={styles.roadWrap}>
        {/* Útvonal */}
        <View style={styles.road} />
        {/* Teherautó */}
        <Animated.Text
          style={[styles.truck, { transform: [{ translateX: truckX }] }]}
        >
          🚛
        </Animated.Text>
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  roadWrap: {
    width: 260,
    height: 50,
    position: 'relative',
    overflow: 'hidden',
  },
  road: {
    position: 'absolute',
    bottom: 6,
    left: 20,
    right: 20,
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 999,
  },
  truck: {
    position: 'absolute',
    bottom: 10,
    fontSize: 32,
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
