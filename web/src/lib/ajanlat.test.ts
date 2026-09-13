import { describe, it, expect } from 'vitest';
import { aktivSajatAjanlat, lezarultSajatAjanlat } from './ajanlat';

// D3 őr (2026-09-13): a visszavont / elutasított saját ajánlat NEM tiltja az
// új ajánlatot — a fuvar-oldal eddig „van saját sor → nincs űrlap" alapon
// döntött, így a „Visszavonom" gomb után soha nem lehetett újra ajánlani.
const ME = 'en';
describe('saját ajánlat állapota', () => {
  it('pending / accepted → aktív (az űrlap rejtve)', () => {
    expect(aktivSajatAjanlat([{ carrier_id: ME, status: 'pending' }], ME)?.status).toBe('pending');
    expect(aktivSajatAjanlat([{ carrier_id: ME, status: 'accepted' }], ME)?.status).toBe('accepted');
    expect(lezarultSajatAjanlat([{ carrier_id: ME, status: 'pending' }], ME)).toBeUndefined();
  });
  it('withdrawn / rejected → NEM aktív, hanem lezárult (az űrlap újra látszik)', () => {
    for (const status of ['withdrawn', 'rejected']) {
      const bids = [{ carrier_id: ME, status }];
      expect(aktivSajatAjanlat(bids, ME), `a(z) ${status} sor eltakarta az ajánlati űrlapot`).toBeUndefined();
      expect(lezarultSajatAjanlat(bids, ME)?.status).toBe(status);
    }
  });
  it('más szállító sora nem számít; ismeretlen user → semmi', () => {
    expect(aktivSajatAjanlat([{ carrier_id: 'masik', status: 'pending' }], ME)).toBeUndefined();
    expect(lezarultSajatAjanlat([{ carrier_id: 'masik', status: 'withdrawn' }], ME)).toBeUndefined();
    expect(aktivSajatAjanlat([{ carrier_id: ME, status: 'pending' }], undefined)).toBeUndefined();
  });
});
