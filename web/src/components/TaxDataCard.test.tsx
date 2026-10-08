// DAC7-kártya határidő-mondata (UX-kör A18, 2026-10-08): a rövid hu-HU
// dátumalak („2026. 12. 07.") után a mondatzáró pont DUPLA pontot adott
// („2026. 12. 07.."), és a kártya nem mondta meg előre, mi történik a
// határidő után. Most: „Határidő: 2026. december 7. Ha addig nem adod meg…".
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaxDataCard from './TaxDataCard';

vi.mock('@/api', () => ({ api: { saveTaxData: vi.fn() } }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const normal = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

describe('DAC7-kártya: a határidő mondata', () => {
  it('teljes hónapnévvel, dupla pont nélkül, a következménnyel együtt', () => {
    const { container } = render(
      <TaxDataCard
        profile={{ tax_data: { needed: true, blocked: false, deadline: '2026-12-07T12:00:00Z' } }}
        onSaved={() => {}}
      />,
    );
    const t = normal(container.textContent);
    expect(t).toContain('Határidő: 2026. december 7. Ha addig nem adod meg, utána új ajánlatot nem tehetsz');
    expect(t).not.toMatch(/\.\./);
  });
});
