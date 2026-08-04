// Cím-pontosság (2026-08-04, tesztelői észrevétel): a fuvar felvételi és
// lerakodási pontja nem lehet „csak Szeged" — a szállítónak házszámig
// pontos cím kell. Ez a teszt a döntési szabályt őrzi; a Google Places
// válaszait a valós address_components-alakjukban utánozzuk.
import { describe, it, expect } from 'vitest';
import { precisionError } from './AddressAutocomplete';

/** Google Places-szerű találat összeállítása a komponens-típusokból. */
function place(componentTypes: string[][], types: string[] = []) {
  return {
    types,
    address_components: componentTypes.map((t) => ({
      long_name: 'x', short_name: 'x', types: t,
    })),
  } as unknown as google.maps.places.PlaceResult;
}

describe('precisionError — házszámig pontos cím kötelező', () => {
  it('házszámos utcai cím átmegy', () => {
    const p = place(
      [['street_number'], ['route'], ['locality'], ['country']],
      ['street_address'],
    );
    expect(precisionError(p)).toBeNull();
  });

  it('üzlet / POI is átmegy, ha a Google visszaadja a házszámot (IKEA-eset)', () => {
    const p = place(
      [['street_number'], ['route'], ['locality'], ['postal_code'], ['country']],
      ['furniture_store', 'point_of_interest', 'establishment'],
    );
    expect(precisionError(p)).toBeNull();
  });

  it('épület-azonosítós cím (premise) is elfogadott', () => {
    const p = place([['premise'], ['route'], ['locality']], ['premise']);
    expect(precisionError(p)).toBeNull();
  });

  it('csak az utca (házszám nélkül) → a házszámot kéri', () => {
    const p = place([['route'], ['locality'], ['country']], ['route']);
    expect(precisionError(p)).toMatch(/házszám/i);
  });

  it('csak település → pontos címet kér', () => {
    const p = place([['locality'], ['country']], ['locality', 'political']);
    expect(precisionError(p)).toMatch(/település|terület/i);
  });

  it('csak ország → pontos címet kér', () => {
    const p = place([['country']], ['country', 'political']);
    expect(precisionError(p)).toMatch(/település|terület/i);
  });

  it('csak irányítószám → pontos címet kér', () => {
    const p = place([['postal_code'], ['country']], ['postal_code']);
    expect(precisionError(p)).toMatch(/település|terület/i);
  });

  it('megye / régió → pontos címet kér', () => {
    const p = place(
      [['administrative_area_level_1'], ['country']],
      ['administrative_area_level_1', 'political'],
    );
    expect(precisionError(p)).toMatch(/település|terület/i);
  });

  it('hiányzó address_components esetén sem dob, elutasít', () => {
    const p = { types: ['locality'] } as unknown as google.maps.places.PlaceResult;
    expect(precisionError(p)).toBeTruthy();
  });
});
