// =====================================================================
//  UX-átvizsgálás (2026-10-08) — a feladói út logikai őrei
//
//  A1  lezarasInfo: vészhelyzeti figyelmeztetés CSAK külön címzettnél
//  A12 fuvarStatusz: a díj állapota a feliratban; egy forrás, egyértelmű szó
//  A22 relativIdo / cimEmojiNelkul / ertesitesIkon: olvasható értesítések
//  Q6  felvetelIdopont: abszolút időpont a „~300 perc" helyett
//  A17 illesztesPontokra: a térkép a pontokra illeszt, legfeljebb 14-es nagyítás
//  A21 ujrafeladasPiszkozat: a lemondott fuvar adatai az új feladás piszkozatába
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fuvarStatusz, lezarasInfo } from './statusz';
import { felvetelIdopont, relativIdo, rovidDatumIdo, teljesDatumIdo } from './idopont';
import { cimEmojiNelkul, ertesitesIkon } from './ertesitesek';
import { illesztesPontokra, ILLESZTES_MAX_ZOOM, ILLESZTES_MARGO_PX } from './terkepIllesztes';
import { ujrafeladasPiszkozat } from './ujrafeladas';
import type { Job } from '@/api';

describe('A1 — lezarasInfo', () => {
  const kezbesitett = { status: 'delivered', delivered_at: '2026-10-08T08:52:00Z' };

  it('címzett nélkül a feladói kód NEM vészhelyzet — a régi (sender_emergency) sorokon sem', () => {
    expect(lezarasInfo({ ...kezbesitett, closed_by_code_type: 'sender_emergency' }))
      .toEqual({ tipus: 'rendben', kodja: 'sajat' });
    expect(lezarasInfo({ ...kezbesitett, closed_by_code_type: 'sender' }))
      .toEqual({ tipus: 'rendben', kodja: 'sajat' });
  });

  it('külön címzettnél a feladói kóddal zárás vészhelyzeti figyelmeztetést kap', () => {
    expect(lezarasInfo({ ...kezbesitett, closed_by_code_type: 'sender_emergency', recipient_name: 'Cili' }))
      .toEqual({ tipus: 'veszhelyzeti', kodja: 'sajat' });
    expect(lezarasInfo({ ...kezbesitett, closed_by_code_type: 'sender_emergency', recipient_phone: '+36301112233' })?.tipus)
      .toBe('veszhelyzeti');
  });

  it('a címzett kódjával zárt fuvar rendben van; nem kézbesített fuvarnál nincs sor', () => {
    expect(lezarasInfo({ ...kezbesitett, closed_by_code_type: 'recipient', recipient_name: 'Cili' }))
      .toEqual({ tipus: 'rendben', kodja: 'cimzett' });
    expect(lezarasInfo({ status: 'in_progress', closed_by_code_type: null })).toBeNull();
    expect(lezarasInfo({ status: 'disputed', status_before_dispute: 'in_progress' })).toBeNull();
    // Kézbesítés utáni vita: a lezárás módja ilyenkor is látszik.
    expect(lezarasInfo({ status: 'disputed', status_before_dispute: 'delivered', closed_by_code_type: 'sender' })?.tipus)
      .toBe('rendben');
  });
});

describe('A12 — fuvarStatusz', () => {
  it('a díj kifizetése megkülönbözteti az elfogadott fuvart', () => {
    expect(fuvarStatusz({ status: 'accepted', paid_at: null }).felirat).toBe('Díjfizetésre vár');
    expect(fuvarStatusz({ status: 'accepted', paid_at: '2026-10-08T08:00:00Z' }).felirat).toBe('Felvételre vár');
    expect(fuvarStatusz({ status: 'accepted', paid_at: null }, 'szallito').felirat)
      .toBe('Elfogadva — a feladó díjfizetésére vár');
    expect(fuvarStatusz({ status: 'accepted', paid_at: '2026-10-08T08:00:00Z' }, 'szallito').felirat)
      .toBe('Indulhat a fuvar');
  });

  it('egy állapot = egy szó; a vita nem kék és nem borostyán', () => {
    expect(fuvarStatusz({ status: 'delivered' }).felirat).toBe('Kézbesítve');
    expect(fuvarStatusz({ status: 'completed' }).felirat).toBe('Kézbesítve');
    expect(fuvarStatusz({ status: 'in_progress' }).felirat).toBe('Úton');
    expect(fuvarStatusz({ status: 'bidding' }).felirat).toBe('Ajánlatokat vár');
    expect(fuvarStatusz({ status: 'cancelled' }).felirat).toBe('Lemondva');
    const vita = fuvarStatusz({ status: 'disputed' });
    expect(vita.felirat).toBe('Vita folyamatban');
    expect(vita.tonus).toBe('vita');
    expect(vita.tonus).not.toBe(fuvarStatusz({ status: 'accepted', paid_at: null }).tonus);
    expect(fuvarStatusz({ status: 'bidding' }).tonus).not.toBe(fuvarStatusz({ status: 'in_progress' }).tonus);
  });
});

describe('A22 / Q6 — időpontok', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('rövid, budapesti időpont', () => {
    // 08:52 UTC = 10:52 Budapest (nyári idő)
    expect(rovidDatumIdo('2026-10-08T08:52:00Z')).toBe('okt. 8., 10:52');
    expect(teljesDatumIdo('2026-10-08T08:52:00Z')).toBe('2026. okt. 8., 10:52');
    expect(rovidDatumIdo('nem dátum')).toBe('');
    expect(rovidDatumIdo(null)).toBe('');
  });

  it('relatív idő: most / perce / órája / tegnap / dátum', () => {
    const most = new Date('2026-10-08T12:00:00Z'); // 14:00 Budapest
    expect(relativIdo('2026-10-08T11:59:40Z', most)).toBe('most');
    expect(relativIdo('2026-10-08T11:48:00Z', most)).toBe('12 perce');
    expect(relativIdo('2026-10-08T09:00:00Z', most)).toBe('3 órája');
    expect(relativIdo('2026-10-07T12:20:00Z', most)).toBe('tegnap 14:20');
    expect(relativIdo('2026-10-01T08:52:00Z', most)).toBe('okt. 1., 10:52');
    // Óraeltérés (jövőbeli időbélyeg) se adjon negatív percet.
    expect(relativIdo('2026-10-08T12:05:00Z', most)).toBe('most');
  });

  it('felvetelIdopont: ajánlattétel + vállalt érkezés → abszolút időpont', () => {
    const most = new Date('2026-10-08T08:00:00Z');
    const f = felvetelIdopont('2026-10-08T08:40:00Z', 300, most);
    expect(f?.abszolut).toBe('kb. okt. 8., 15:40');
    expect(f?.relativ).toBe('kb. 6 óra múlva');
    expect(felvetelIdopont('2026-10-08T08:40:00Z', null, most)).toBeNull();
    expect(felvetelIdopont(undefined, 120, most)).toBeNull();
    // Múltbeli időpontnál csak az abszolút alak marad (relatívat nem állítunk).
    expect(felvetelIdopont('2026-10-06T08:40:00Z', 60, most)?.relativ).toBeNull();
  });
});

describe('A22 — értesítés-címek és ikonok', () => {
  it('a dekoratív emoji eltűnik a címből, a szöveg marad', () => {
    expect(cimEmojiNelkul('🎉 Megállapodás!')).toBe('Megállapodás!');
    expect(cimEmojiNelkul('Új ajánlat érkezett 🎯')).toBe('Új ajánlat érkezett');
    expect(cimEmojiNelkul('⭐⭐⭐⭐ Új értékelés!')).toBe('Új értékelés!');
    expect(cimEmojiNelkul('⚖️ Vitás eset megnyitva')).toBe('Vitás eset megnyitva');
    expect(cimEmojiNelkul('Egy ajánlatot visszavontak')).toBe('Egy ajánlatot visszavontak');
    expect(cimEmojiNelkul('🎉')).toBe('🎉');
  });

  it('a típus lucide ikoncsaládot kap', () => {
    expect(ertesitesIkon('bid_received')).toBe('ajanlat');
    expect(ertesitesIkon('payment_due')).toBe('fizetes');
    expect(ertesitesIkon('job_delivered')).toBe('kezbesitve');
    expect(ertesitesIkon('chat_message')).toBe('uzenet');
    expect(ertesitesIkon('dispute_opened')).toBe('vita');
    expect(ertesitesIkon('ismeretlen_tipus')).toBe('altalanos');
  });
});

describe('A17 — térkép-illesztés', () => {
  afterEach(() => { delete (globalThis as any).google; });

  function hamisGoogle() {
    const idleHivok: Array<() => void> = [];
    (globalThis as any).google = {
      maps: {
        LatLngBounds: class { pontok: unknown[] = []; extend(p: unknown) { this.pontok.push(p); } },
        event: { addListenerOnce: (_m: unknown, _e: string, fn: () => void) => { idleHivok.push(fn); } },
      },
    };
    return idleHivok;
  }

  it('a pontokra illeszt, és rövid útnál legfeljebb 14-es nagyításig közelít', () => {
    const idle = hamisGoogle();
    let zoom = 19;
    const map = {
      fitBounds: vi.fn(), setCenter: vi.fn(),
      setZoom: vi.fn((z: number) => { zoom = z; }), getZoom: () => zoom,
    };
    expect(illesztesPontokra(map as any, [{ lat: 47.5, lng: 19.04 }, { lat: 47.51, lng: 19.05 }])).toBe(true);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    // Alap-margó legfeljebb 24 px: 48 px mellett a 100–200 km-es észak–déli
    // útvonal csak 6-os nagyítással fért be a feladói térképre (fix1-review).
    expect(map.fitBounds.mock.calls[0][1]).toBe(ILLESZTES_MARGO_PX);
    expect(ILLESZTES_MARGO_PX).toBeLessThanOrEqual(24);
    idle.forEach((f) => f());
    expect(zoom).toBe(ILLESZTES_MAX_ZOOM);
  });

  it('térkép-példány nélkül nem csinál semmit (az onLoad hívja újra); hibás pontot kihagy', () => {
    hamisGoogle();
    expect(illesztesPontokra(null, [{ lat: 47.5, lng: 19.04 }])).toBe(false);
    const map = { fitBounds: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn(), getZoom: () => 10 };
    expect(illesztesPontokra(map as any, [{ lat: Number.NaN, lng: 1 }, { lat: 46.25, lng: 20.14 }])).toBe(true);
    expect(map.setCenter).toHaveBeenCalledWith({ lat: 46.25, lng: 20.14 });
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});

describe('A21 — „Újra feladom" piszkozat', () => {
  const job = {
    id: 'j1', shipper_id: 'u1', carrier_id: null, title: 'Kanapé Pécsre', description: '2 darab',
    pickup_address: 'Budapest, Margit körút 50.', pickup_lat: 47.51, pickup_lng: 19.04,
    dropoff_address: 'Pécs, Király utca 15.', dropoff_lat: 46.07, dropoff_lng: 18.23,
    distance_km: 200, weight_kg: '55.00' as unknown as number, volume_m3: 0.26,
    length_cm: 160, width_cm: 80, height_cm: 20, suggested_price_huf: 24000, accepted_price_huf: 23000,
    status: 'cancelled', pickup_needs_carrying: true, pickup_floor: 3, pickup_has_elevator: false,
    declared_value_huf: 50000, recipient_name: 'Kiss Anna', recipient_phone: '+36301112233',
    pickup_window_start: '2026-10-01T08:00:00Z',
  } as unknown as Job;

  it('a fuvar adatai megerősített címmel kerülnek az űrlapba, a régi időablak nem', () => {
    const d = ujrafeladasPiszkozat(job);
    expect(d.form).toMatchObject({
      title: 'Kanapé Pécsre', pickup_confirmed: true, dropoff_confirmed: true,
      pickup_lat: 47.51, weight_kg: 55, suggested_price_huf: 24000, pickup_floor: '3',
      other_recipient: true, recipient_name: 'Kiss Anna',
    });
    expect(d.raw).toMatchObject({ weight_kg: '55', length_cm: '160', declared_value_huf: '50000' });
    expect(d.form).not.toHaveProperty('pickup_window_start');
    // Az új-fuvar űrlap ebből tudja, hogy nem félbehagyott feladásról van szó.
    expect(d.ujrafeladas).toBe(true);
  });

  it('koordináta nélkül a cím nem megerősített; címzett nélkül nincs „más veszi át"', () => {
    const d = ujrafeladasPiszkozat({ ...job, pickup_lat: null, recipient_name: null, recipient_phone: null } as unknown as Job);
    expect(d.form.pickup_confirmed).toBe(false);
    expect(d.form.other_recipient).toBe(false);
    expect(d.form.recipient_name).toBe('');
  });
});
