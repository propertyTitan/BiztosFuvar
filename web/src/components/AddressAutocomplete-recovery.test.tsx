import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import AddressAutocomplete from './AddressAutocomplete';

const loader = vi.hoisted(() => ({ isLoaded: false, loadError: undefined as Error | undefined }));
vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => loader,
  Autocomplete: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/maps', () => ({ GOOGLE_MAPS_ID: 'gofuvar-maps', GOOGLE_MAPS_LIBRARIES: ['places'], GOOGLE_MAPS_LANGUAGE: 'hu', GOOGLE_MAPS_REGION: 'HU', getGoogleMapsApiKey: () => 'test' }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); loader.isLoaded = false; loader.loadError = undefined; });

function Form() {
  const [title, setTitle] = useState('');
  return <form>
    <input aria-label="Fuvar neve" value={title} onChange={e => setTitle(e.target.value)} />
    <AddressAutocomplete label="Felvétel" value="Megadott cím" onChange={() => {}} />
    <AddressAutocomplete label="Lerakodás" value="Másik cím" onChange={() => {}} />
  </form>;
}

it('a betöltési hibát jelzi; egy újrapróbálás mindkét címmezőt helyreállítja, a fuvar adatai megmaradnak', () => {
  loader.loadError = new Error('Maps blocked');
  render(<Form />);
  fireEvent.change(screen.getByLabelText('Fuvar neve'), { target: { value: 'Bútorok szállítása' } });
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByLabelText('Felvétel')).toBeDisabled();
  loader.loadError = undefined;
  loader.isLoaded = true;
  fireEvent.click(screen.getAllByRole('button', { name: 'Címkereső újratöltése' })[0]);
  expect(screen.getByLabelText('Felvétel')).toBeEnabled();
  expect(screen.getByLabelText('Lerakodás')).toBeEnabled();
  expect(screen.getByLabelText('Felvétel')).toHaveValue('Megadott cím');
  expect(screen.getByLabelText('Fuvar neve')).toHaveValue('Bútorok szállítása');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('a végtelen betöltés helyett 15 másodperc után helyreállítási lehetőséget ad', async () => {
  vi.useFakeTimers();
  const view = render(<Form />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getAllByRole('button', { name: 'Címkereső újratöltése' })).toHaveLength(2);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('Enter után a Google párhuzamos kiválasztása nem írhatja felül a házszámos címet', async () => {
  loader.isLoaded = true;
  const geocode = vi.fn().mockResolvedValueOnce({ results: [{
    formatted_address: 'Budapest, Váci út', address_components: [{ types: ['route'] }],
    geometry: { location: { lat: () => 47, lng: () => 19 } },
  }] }).mockResolvedValueOnce({ results: [{
    formatted_address: 'Budapest, Váci út 12', address_components: [{ types: ['street_number'] }],
    geometry: { location: { lat: () => 47.5, lng: () => 19.1 } },
  }] });
  vi.stubGlobal('google', { maps: { Geocoder: class { geocode = geocode; } } });
  const selected = vi.fn(), imprecise = vi.fn(), text = vi.fn();
  render(<AddressAutocomplete label="Felvétel" value="" requirePrecise onChange={selected} onTextChange={text} onImprecise={imprecise} />);
  const input = screen.getByLabelText('Felvétel');
  // A Google-lista a legutolsó bevitt házszám nélkül is ajánlhat utcát.
  const list = document.createElement('div');
  list.className = 'pac-container';
  Object.defineProperty(list, 'offsetWidth', { value: 200 });
  list.innerHTML = '<div class="pac-item"><span class="pac-item-query">Budapest, Váci út</span></div>';
  document.body.append(list);
  try {
    fireEvent.change(input, { target: { value: 'Budapest, Váci út 12' } });
    const googleKeyHandler = vi.fn();
    input.addEventListener('keydown', googleKeyHandler);
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(googleKeyHandler).not.toHaveBeenCalled();
    expect(geocode.mock.calls.map(([query]) => query.address)).toEqual(['Budapest, Váci út', 'Budapest, Váci út 12']);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith('Budapest, Váci út 12', 47.5, 19.1);
    expect(imprecise).toHaveBeenCalledWith('');
    expect(text).toHaveBeenCalledTimes(1);
  } finally { list.remove(); }
});
