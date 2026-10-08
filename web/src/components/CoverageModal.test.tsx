// UX-review A29 (2026-10-08): a lefedettségi ablak is valódi dialógus, és nem
// ígér olyat, amit a kód nem tesz (a régi „Feliratkozva! Értesítünk” egy
// sehova el nem küldött e-mail-mezőre szólt; a „Szeged — hamarosan” címkék
// pedig már elérhető városokra). A régi CoverageModallal piros.
import { act, render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import CoverageModal from './CoverageModal';

function nyit() {
  render(<CoverageModal />);
  act(() => { window.dispatchEvent(new CustomEvent('gofuvar:outside-coverage', { detail: {} })); });
}

it('role=dialog a címsorral megnevezve, az Escape bezárja', () => {
  nyit();
  expect(screen.getByRole('dialog', { name: /szolgáltatási területen kívül/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('nincs hamis feliratkozás és nincs „hamarosan” egy már elérhető városra', () => {
  nyit();
  expect(screen.queryByPlaceholderText(/email/i)).toBeNull();
  expect(screen.queryByText(/Feliratkozva/)).toBeNull();
  expect(screen.queryByText(/hamarosan/i)).toBeNull();
  expect(screen.getByRole('link', { name: 'info@gofuvar.hu' })).toHaveAttribute('href', 'mailto:info@gofuvar.hu');
});
