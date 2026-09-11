// Funkció-kapcsolók (2026-09-11, Codex-audit / user-döntés D1).
//
// JÁRAT-ÁG: a launchra ELREJTVE. Az audit 29 tételéből 9 a járat-ágra esett
// (fizetés után nincs kontakt, nincs címzett, rossz fül, vita alatt befagy,
// nincs kapacitás…), és üres járat-lista rosszabb üzenet egy új
// látogatónak, mint a „hamarosan". A funkció a kínálat sűrűsödése után,
// kijavítva kapcsolható vissza: NEXT_PUBLIC_JARAT_ENABLED=true (Vercel) +
// JARAT_ENABLED=true (Railway) — mindkettő kell.
//
// ⚠️ ALAPÉRTELMEZÉS: KI. Ha az env hiányzik, a járat rejtett — így egy
// elfelejtett beállítás a biztonságos irányba téved. Az E2E és a lokális
// fejlesztés a playwright.config / .env.local kapcsolóval látja a funkciót.
export const JARAT_ENGEDELYEZVE = process.env.NEXT_PUBLIC_JARAT_ENABLED === 'true';
