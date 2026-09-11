import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Minden teszt után takarítjuk a DOM-ot, hogy ne szivárogjon át a render.
afterEach(() => {
  cleanup();
});

// Járat-ág kapcsoló (2026-09-11, D1): élesben rejtett; a unit-tesztek a teljes funkciót mérik.
process.env.NEXT_PUBLIC_JARAT_ENABLED = 'true';
