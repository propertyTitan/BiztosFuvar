// GoFuvar logó natív RN komponensekkel (nincs new dependency).
// Két méret: horizontal (teljes logó szöveggel), icon (csak a négyzet).
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme';

type Props = { size?: 'sm' | 'md' | 'lg' };

export function LogoHorizontal({ size = 'md' }: Props) {
  const scale = size === 'sm' ? 0.7 : size === 'lg' ? 1.3 : 1;
  const box = 56 * scale;
  const fontSize = 34 * scale;
  return (
    <View style={[styles.row, { gap: 12 * scale }]}>
      <LogoIcon size={box} />
      <View style={styles.textRow}>
        <Text style={[styles.go, { fontSize }]}>Go</Text>
        <Text style={[styles.fuvar, { fontSize }]}>Fuvar</Text>
      </View>
    </View>
  );
}

export function LogoIcon({ size = 56 }: { size?: number }) {
  const radius = size * 0.25;
  const arrowHeight = size * 0.08;
  const barHeight = size * 0.07;
  return (
    <View
      style={[
        styles.iconBox,
        {
          width: size,
          height: size,
          borderRadius: radius,
        },
      ]}
    >
      {/* Előre nyíl – egyszerűsített natív változat */}
      <View
        style={{
          width: size * 0.55,
          height: arrowHeight,
          backgroundColor: '#fff',
          borderRadius: arrowHeight / 2,
        }}
      />
      {/* Nyíl feje – ▶ karakter */}
      <Text
        style={{
          position: 'absolute',
          right: size * 0.12,
          top: size * 0.24,
          fontSize: size * 0.5,
          color: '#fff',
          lineHeight: size * 0.52,
          fontWeight: '900',
        }}
      >
        ›
      </Text>
      {/* Alsó progress jelző */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.18,
          width: size * 0.55,
          height: barHeight,
          backgroundColor: colors.success,
          borderRadius: barHeight / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textRow: { flexDirection: 'row', alignItems: 'baseline' },
  go: { color: colors.success, fontWeight: '800', letterSpacing: -1 },
  fuvar: { color: colors.text, fontWeight: '800', letterSpacing: -1 },
});
