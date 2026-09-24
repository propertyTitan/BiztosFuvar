const sharp = require('sharp');
const { sniffImageType } = require('../utils/imageSniff');

const MAX_PIXELS = 64_000_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

// Csak a NYILVÁNOS listing/avatar példányt alakítjuk át. A bizonyító fotó és
// a KYC eredeti bájtjai külön életciklushoz tartoznak, itt nem járhatnak át.
// Sharp alapból eldobja az EXIF/IPTC/XMP adatot; autoOrient előtte alkalmazza
// a tájolást. withMetadata/keepMetadata itt szándékosan NINCS.
async function sanitizePublicImage(file) {
  try {
    if (!Buffer.isBuffer(file?.buffer) || !sniffImageType(file.buffer)) throw new Error('Not a raster image');
    const pipeline = sharp(file.buffer, { animated: true, limitInputPixels: MAX_PIXELS, failOn: 'warning' })
      .autoOrient().timeout({ seconds: 10 });
    const metadata = await pipeline.metadata();
    let format = metadata.format;
    // A gyári libvips AVIF-et kezel. HEVC/HEIC csak az azt támogató builden
    // dekódolható; siker esetén JPEG lesz, kudarc esetén nincs raw fallback.
    if (format === 'heif') format = metadata.compression === 'av1' ? 'avif' : 'jpeg';
    const formats = {
      jpeg: { mime: 'image/jpeg', ext: 'jpg', options: { quality: 95, chromaSubsampling: '4:4:4' } },
      png: { mime: 'image/png', ext: 'png', options: {} },
      webp: { mime: 'image/webp', ext: 'webp', options: { quality: 95 } },
      gif: { mime: 'image/gif', ext: 'gif', options: {} },
      avif: { mime: 'image/avif', ext: 'avif', options: { quality: 90, effort: 2 } },
    };
    const output = formats[format];
    if (!output) throw new Error('Unsupported public image format');
    const buffer = await pipeline.toFormat(format, output.options).toBuffer();
    if (buffer.length > MAX_OUTPUT_BYTES) throw new Error('Public image output too large');
    return { ...file, buffer, mimetype: output.mime, originalname: `public.${output.ext}`, size: buffer.length };
  } catch {
    // A dekóder részletei és a metaadatok nem kerülnek sem a válaszba, sem
    // a naplóba. Hibánál az eredeti érzékeny fájl nem publikálható.
    const error = new Error('A képet nem sikerült biztonságosan feldolgozni. Mentsd JPG vagy PNG formátumban, legfeljebb 64 megapixeles felbontással, majd töltsd fel újra.');
    error.code = 'INVALID_PUBLIC_IMAGE';
    throw error;
  }
}

module.exports = { sanitizePublicImage };
