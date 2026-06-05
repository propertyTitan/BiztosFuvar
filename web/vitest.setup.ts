import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Minden teszt után takarítjuk a DOM-ot, hogy ne szivárogjon át a render.
afterEach(() => {
  cleanup();
});
