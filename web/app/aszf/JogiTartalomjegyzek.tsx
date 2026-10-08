// Kinyitható tartalomjegyzék + „Vissza a tetejére" a jogi oldalakra
// (ÁSZF, Adatkezelési tájékoztató). UX-kör A26 (2026-10-08): mobilon az ÁSZF
// ~22 800 px, az adatkezelési tájékoztató ~24 800 px hosszú volt,
// tartalomjegyzék nélkül — a keresett pont (pl. a megőrzési idők) gyakorlatilag
// megtalálhatatlan. Szerver-komponens: nincs hozzá JS (natív <details>).
import { ArrowUp, ListOrdered } from 'lucide-react';

export type JogiFejezet = { id: string; cim: string };

export default function JogiTartalomjegyzek({ fejezetek }: { fejezetek: JogiFejezet[] }) {
  return (
    <nav aria-label="Tartalomjegyzék" className="jogi-tartalom card" style={{ marginTop: 24, marginBottom: 0 }}>
      <details>
        <summary>
          <ListOrdered size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />
          Tartalomjegyzék
        </summary>
        <ol>
          {fejezetek.map((f) => (
            <li key={f.id}><a href={`#${f.id}`}>{f.cim}</a></li>
          ))}
        </ol>
      </details>
    </nav>
  );
}

/** A dokumentum végén: vissza a tetejére (a `<h1 id="dokumentum-teteje">`-re). */
export function VisszaATetejere() {
  return (
    <p style={{ marginTop: 32 }}>
      <a href="#dokumentum-teteje" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <ArrowUp size={16} aria-hidden /> Vissza a tetejére
      </a>
    </p>
  );
}
