// GoFuvar logó natív RN komponensekkel (nincs új dependency).
// Stilizált kisteherautó oldalnézetből: raktér + vezetőfülke + 2 kerék,
// felül kiálló narancs és zöld csomagok, alul zöld „út" csík.
// A méretet egy `size` propsszal skálázzuk, minden belső méret ehhez arányos.
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme';

type Props = { size?: 'sm' | 'md' | 'lg' };

export function LogoHorizontal({ size = 'md' }: Props) {
  const scale = size === 'sm' ? 0.7 : size === 'lg' ? 1.3 : 1;
  const box = 68 * scale;
  const fontSize = 34 * scale;
  return (
    <View style={[styles.row, { gap: 14 * scale }]}>
      <LogoIcon size={box} />
      <View style={styles.textRow}>
        <Text style={[styles.go, { fontSize }]}>Go</Text>
        <Text style={[styles.fuvar, { fontSize }]}>Fuvar</Text>
      </View>
    </View>
  );
}

export function LogoIcon({ size = 68 }: { size?: number }) {
  const radius = size * 0.22;

  // Belső arányok (az SVG-hez igazítva)
  const cargoW = size * 0.37;
  const cargoH = size * 0.30;
  const cargoX = size * 0.22;
  const cargoY = size * 0.30;

  const cabW = size * 0.18;
  const cabH = size * 0.30;
  const cabX = cargoX + cargoW;
  const cabY = cargoY;

  const wheelSize = size * 0.14;
  const wheelY = cargoY + cargoH - wheelSize * 0.3;

  const box1W = size * 0.15;
  const box1H = size * 0.12;
  const box1X = cargoX + size * 0.04;
  const box1Y = cargoY - box1H * 0.85;

  const box2W = size * 0.12;
  const box2H = size * 0.10;
  const box2X = cargoX + cargoW - box2W - size * 0.04;
  const box2Y = cargoY - box2H * 0.85;

  return (
    <View
      style={[
        styles.iconBox,
        { width: size, height: size, borderRadius: radius },
      ]}
    >
      {/* Sebességvonalak a bal oldalon */}
      <View style={[styles.speedLine, { top: size * 0.34, left: size * 0.10, width: size * 0.12 }]} />
      <View style={[styles.speedLine, { top: size * 0.44, left: size * 0.08, width: size * 0.10 }]} />
      <View style={[styles.speedLine, { top: size * 0.54, left: size * 0.10, width: size * 0.12 }]} />

      {/* Raktér (fehér doboz) */}
      <View
        style={{
          position: 'absolute',
          left: cargoX,
          top: cargoY,
          width: cargoW,
          height: cargoH,
          backgroundColor: '#ffffff',
          borderRadius: 3,
        }}
      />
      {/* Raktér ajtó elválasztó */}
      <View
        style={{
          position: 'absolute',
          left: cargoX + cargoW * 0.5 - 0.5,
          top: cargoY + 2,
          width: 1,
          height: cargoH - 4,
          backgroundColor: '#cbd5e1',
        }}
      />

      {/* Vezetőfülke */}
      <View
        style={{
          position: 'absolute',
          left: cabX,
          top: cabY + cabH * 0.23,
          width: cabW,
          height: cabH * 0.77,
          backgroundColor: '#ffffff',
          borderTopLeftRadius: 2,
          borderTopRightRadius: size * 0.04,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
      {/* Szélvédő */}
      <View
        style={{
          position: 'absolute',
          left: cabX + 1,
          top: cabY + cabH * 0.23,
          width: cabW - 2,
          height: cabH * 0.25,
          backgroundColor: '#60a5fa',
          borderTopLeftRadius: 2,
          borderTopRightRadius: size * 0.03,
        }}
      />

      {/* Narancs csomag – bal */}
      <View
        style={{
          position: 'absolute',
          left: box1X,
          top: box1Y,
          width: box1W,
          height: box1H,
          backgroundColor: '#f59e0b',
          borderRadius: 2,
          borderWidth: 0.8,
          borderColor: '#c2710c',
        }}
      />

      {/* Zöld csomag – jobb */}
      <View
        style={{
          position: 'absolute',
          left: box2X,
          top: box2Y,
          width: box2W,
          height: box2H,
          backgroundColor: '#16a34a',
          borderRadius: 2,
          borderWidth: 0.8,
          borderColor: '#0f7a3a',
        }}
      />

      {/* Bal kerék */}
      <View
        style={{
          position: 'absolute',
          left: cargoX + cargoW * 0.2 - wheelSize / 2,
          top: wheelY,
          width: wheelSize,
          height: wheelSize,
          borderRadius: wheelSize / 2,
          backgroundColor: '#0f172a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: wheelSize * 0.4,
            height: wheelSize * 0.4,
            borderRadius: wheelSize * 0.2,
            backgroundColor: '#cbd5e1',
          }}
        />
      </View>

      {/* Jobb kerék */}
      <View
        style={{
          position: 'absolute',
          left: cabX + cabW * 0.35 - wheelSize / 2,
          top: wheelY,
          width: wheelSize,
          height: wheelSize,
          borderRadius: wheelSize / 2,
          backgroundColor: '#0f172a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: wheelSize * 0.4,
            height: wheelSize * 0.4,
            borderRadius: wheelSize * 0.2,
            backgroundColor: '#cbd5e1',
          }}
        />
      </View>

      {/* Alul „út" csík */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.10,
          right: size * 0.08,
          bottom: size * 0.10,
          height: size * 0.035,
          backgroundColor: '#86efac',
          borderRadius: size * 0.02,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    backgroundColor: colors.primary,
    overflow: 'hidden',
  },
  textRow: { flexDirection: 'row', alignItems: 'baseline' },
  go: { color: colors.success, fontWeight: '800', letterSpacing: -1 },
  fuvar: { color: colors.text, fontWeight: '800', letterSpacing: -1 },
  speedLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#60a5fa',
    borderRadius: 1,
    opacity: 0.7,
  },
});
