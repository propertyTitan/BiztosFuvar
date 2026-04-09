// Egyszerű autocomplete input a mobilra, ami a Google Places API-t
// HTTP-n keresztül hívja (lásd: src/places.ts).
//
// - Debouncing 350 ms-mal, hogy ne hívjuk minden billentyűleütésre az API-t.
// - Amikor a user kiválaszt egy találatot, getPlaceDetails-szel lekérjük
//   a pontos koordinátát, és a callback-en keresztül visszaadjuk.
// - Kézi szerkesztés esetén (amikor a user ír a mezőbe) a `confirmed` flag
//   false-ra vált, és a szülő komponens tudja, hogy a koordináta elavult.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { autocompletePlaces, getPlaceDetails, PlaceSuggestion } from '@/places';
import { colors, spacing, radius } from '@/theme';

type Props = {
  label: string;
  value: string;
  onPick: (address: string, lat: number, lng: number) => void;
  onTextChange?: (address: string) => void;
  placeholder?: string;
};

export default function AddressAutocomplete({
  label,
  value,
  onPick,
  onTextChange,
  placeholder,
}: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced query
  const query = useCallback(async (input: string) => {
    if (!input.trim() || input.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const items = await autocompletePlaces(input);
      setSuggestions(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!focused) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => query(value), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, focused, query]);

  async function pick(s: PlaceSuggestion) {
    const details = await getPlaceDetails(s.placeId);
    if (details?.lat != null && details?.lng != null) {
      onPick(details.address, details.lat, details.lng);
      setSuggestions([]);
      setFocused(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(text) => {
          // A user gépel → ez implicit fókusz. Re-mount után (pl. tag
          // hozzáadás → parent clear) a natív TextInput nem tüzeli újra az
          // onFocus-t, ezért itt visszakapcsoljuk a keresést.
          setFocused(true);
          onTextChange?.(text);
        }}
        onFocus={() => setFocused(true)}
        placeholder={placeholder || 'Kezdd el beírni a címet…'}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {loading && <Text style={styles.loading}>Keresés…</Text>}
      {focused && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((s) => (
            <Pressable
              key={s.placeId}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => pick(s)}
            >
              <Text style={styles.itemText} numberOfLines={2}>
                {s.description}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  label: {
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    backgroundColor: '#fff',
    color: colors.text,
  },
  loading: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  dropdown: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: '#fff',
    marginTop: 4,
    overflow: 'hidden',
  },
  item: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemPressed: { backgroundColor: '#eef2ff' },
  itemText: { color: colors.text, fontSize: 14 },
});
