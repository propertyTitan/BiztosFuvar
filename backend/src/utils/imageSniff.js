// Kép magic-byte azonosítás (2026-07-13, biztonsági audit 2. tétel).
//
// A feltöltéseknél eddig csak a KLIENS által állított MIME-ot ellenőriztük
// (`image/*`) — egy SVG/HTML fájl `image/png`-nek hazudva átcsúszott volna,
// ami a publikus tárolási domainen stored-XSS kockázat. Mostantól a fájl
// TARTALMA dönt: csak valódi raszteres kép-aláírással kezdődő fájl megy át.
// Az SVG szándékosan NINCS a listán (script-képes formátum).

/**
 * @param {Buffer} buffer — a feltöltött fájl első bájtjai (min. 12)
 * @returns {string|null} a felismert MIME-típus, vagy null ha nem kép
 */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';

  // HEIC/HEIF/AVIF (iPhone-fotók!): [méret]"ftyp" + brand
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  // GIF: "GIF87a" / "GIF89a"
  const gif = buffer.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';

  return null;
}

module.exports = { sniffImageType };
