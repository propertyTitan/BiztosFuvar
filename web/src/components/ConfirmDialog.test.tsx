// =====================================================================
//  ConfirmDialog: a szöveg-kijelölés nem zárhatja be (2026-08-20)
//
//  Tesztelői észrevétel: az ellenajánlat összegének kijelölésekor (bal
//  gombbal húzva), ha a felengedés a dialóguson KÍVÜL történik, a dialógus
//  eltűnik — a beírt adattal együtt.
//
//  Ok: a `click` esemény ott sül el, ahol az egérgombot FELENGEDIK, a
//  háttér `onClick`-je pedig csak azt nézte, hogy a célpont a háttér-e.
//  A kijelölő húzásnál a lenyomás BELÜL van, a felengedés KÍVÜL — a kód
//  ezt háttér-kattintásnak látta.
//
//  A javítás: csak akkor zárunk, ha a lenyomás ÉS a felengedés is a
//  háttéren történt. Visszamérve: az onMouseDown-követés kivételével az
//  első teszt piros.
// =====================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

function nyitottDialogus(onClose = vi.fn()) {
  const util = render(
    <ConfirmDialog
      open
      title="Ellenajánlat küldése"
      message="Add meg az összeget."
      confirmLabel="Küldés"
      fields={[{ key: 'amount', label: 'Ellenajánlatod (Ft)', type: 'number', required: true }]}
      onConfirm={vi.fn()}
      onClose={onClose}
    />,
  );
  // A háttér a legkülső, fixed pozíciójú elem.
  const hatter = util.container.firstChild as HTMLElement;
  return { onClose, hatter };
}

describe('ConfirmDialog: bezárás-viselkedés', () => {
  it('BELÜL kezdett húzás + KÍVÜL felengedés NEM zárja be (szöveg-kijelölés)', () => {
    const { onClose, hatter } = nyitottDialogus();
    const mezo = screen.getByText('Ellenajánlatod (Ft)', { exact: false });

    // A kijelölő húzás: lenyomás a dialóguson belül…
    fireEvent.mouseDown(mezo);
    // …felengedés a háttér fölött → a click a háttéren sül el.
    fireEvent.click(hatter);

    expect(
      onClose,
      'A dialógus bezárult, pedig a húzás a dialóguson BELÜL kezdődött.\n'
      + 'A felhasználó csak ki akarta jelölni a beírt összeget — a dialógus\n'
      + 'a beírt adatával együtt tűnt el (tesztelői észrevétel, 2026-08-20).',
    ).not.toHaveBeenCalled();
  });

  it('a VALÓDI háttér-kattintás viszont továbbra is bezárja (nem túl széles a védelem)', () => {
    const { onClose, hatter } = nyitottDialogus();

    // Normál kattintás: lenyomás ÉS felengedés is a háttéren.
    fireEvent.mouseDown(hatter);
    fireEvent.click(hatter);

    expect(
      onClose,
      'A háttérre kattintás már nem zárja be a dialógust — a javítás túl '
      + 'széles lett, és a megszokott bezárási út veszett el.',
    ).toHaveBeenCalledTimes(1);
  });

  it('az egymást követő kijelölés majd háttér-kattintás jól viselkedik (a ref nem ragad be)', () => {
    const { onClose, hatter } = nyitottDialogus();
    const mezo = screen.getByText('Ellenajánlatod (Ft)', { exact: false });

    // Először egy kijelölő húzás (nem zár)…
    fireEvent.mouseDown(mezo);
    fireEvent.click(hatter);
    expect(onClose).not.toHaveBeenCalled();

    // …majd egy valódi háttér-kattintás (zár). Ha a ref beragadna az első
    // művelet után, ez az út is elveszne.
    fireEvent.mouseDown(hatter);
    fireEvent.click(hatter);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
