'use client';

// =====================================================================
//  BANKI FELKÉSZÜLÉSI ANYAG — admin-kapu mögött, letölthető
//
//  A tartalom a `src/lib/bankFelkeszules.ts`-ből jön: ugyanabból az adatból
//  renderelődik a képernyő ÉS a letöltött, önálló HTML-fájl. Ha a kettő külön
//  szövegben élne, a tárgyaláson pont az elavult példány lenne a kezedben.
//
//  ⚠️ NEM PUBLIKUS: cégadatok és forgalmi várakozások vannak benne. A kapu a
//  többi admin-felülettel azonos mintát követi (nem-admin → átirányítás).
//  A tartalom statikus, szerverre nem megy kérés — így az oldal offline,
//  gyenge térerőn is megnyílik a tárgyaláson.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/auth';
import { Loading, ErrorState } from '@/components/StateView';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/api';
import {
  bankDokumentumHtml, type Blokk, type BankDokumentum,
} from '@/lib/bankFelkeszules';
import {
  ArrowLeft, Download, Printer, Landmark,
} from 'lucide-react';

function BlokkNezet({ b }: { b: Blokk }) {
  switch (b.fajta) {
    case 'bekezdes':
      return <p style={{ margin: '0 0 12px' }}>{b.szoveg}</p>;

    case 'idezet':
      return (
        <blockquote style={{
          margin: '12px 0',
          padding: '14px 16px',
          background: 'rgba(37,99,235,0.08)',
          borderLeft: '4px solid var(--primary)',
          borderRadius: 6,
          fontSize: 15,
        }}
        >
          {b.szoveg}
        </blockquote>
      );

    case 'lista':
      return (
        <ul style={{ margin: '0 0 12px', paddingLeft: 22 }}>
          {b.elemek.map((e) => <li key={e} style={{ marginBottom: 6 }}>{e}</li>)}
        </ul>
      );

    case 'tabla':
      return (
        <div style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {b.fejlec.map((f) => (
                  <th
                    key={f}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border)',
                      fontWeight: 600,
                    }}
                  >
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.sorok.map(([a, c]) => (
                <tr key={a}>
                  <td style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    fontWeight: 600,
                    verticalAlign: 'top',
                    width: '38%',
                  }}
                  >
                    {a}
                  </td>
                  <td style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    verticalAlign: 'top',
                  }}
                  >
                    {c}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'kerdes-valasz':
      return (
        <div style={{ margin: '0 0 14px' }}>
          <p style={{ fontWeight: 700, margin: '0 0 2px' }}>{b.kerdes}</p>
          <p style={{ margin: 0 }}>{b.valasz}</p>
        </div>
      );

    case 'figyelem':
    case 'kitoltendo': {
      const kitolt = b.fajta === 'kitoltendo';
      return (
        <div style={{
          padding: '14px 16px',
          borderRadius: 8,
          margin: '14px 0',
          background: kitolt ? 'rgba(220,38,38,0.10)' : 'rgba(217,119,6,0.12)',
          border: `1px solid ${kitolt ? 'rgba(220,38,38,0.35)' : 'rgba(217,119,6,0.35)'}`,
        }}
        >
          <p style={{ fontWeight: 700, margin: '0 0 6px' }}>{b.cim}</p>
          <p style={{ margin: 0 }}>{b.szoveg}</p>
        </div>
      );
    }

    default:
      return null;
  }
}

export default function BankFelkeszulesPage() {
  const me = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const [letoltve, setLetoltve] = useState(false);
  // A tartalom admin-kapus végpontról jön — lásd a fejléc-kommentet.
  const [dok, setDok] = useState<BankDokumentum | null>(null);
  const [hiba, setHiba] = useState<string | null>(null);

  useEffect(() => {
    if (!me || me.role !== 'admin') return;
    api.adminBankFelkeszules()
      .then(setDok)
      .catch((e: any) => setHiba(e?.message || 'A dokumentum betöltése nem sikerült'));
  }, [me]);

  const datum = useMemo(
    () => new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }),
    [],
  );

  if (me && me.role !== 'admin') { router.push('/'); return null; }
  if (!me) return <Loading />;

  function letolt() {
    if (!dok) return;
    try {
      const html = bankDokumentumHtml(dok, datum);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cib-felkeszules-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // A visszahívás késleltetve, hogy a letöltés biztosan elinduljon előtte.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setLetoltve(true);
      toast.success('Letöltve', 'Megnyitva a böngészőben: Nyomtatás → PDF-be mentés.');
    } catch (e: any) {
      toast.error('A letöltés nem sikerült', e?.message || 'Ismeretlen hiba');
    }
  }

  if (hiba) return <ErrorState message={hiba} />;
  if (!dok) return <Loading />;

  return (
    <div className="container" style={{ maxWidth: 860, paddingBottom: 64 }}>
      <div className="no-print">
        <Link
          href="/admin"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: 'var(--muted-text)', textDecoration: 'none', marginBottom: 12,
          }}
        >
          <ArrowLeft size={14} />
          Vissza az adminra
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Landmark size={22} />
        <h1 style={{ margin: 0, fontSize: 24 }}>{dok.cim}</h1>
      </div>
      <p className="muted" style={{ margin: '0 0 2px', fontSize: 14 }}>{dok.alcim}</p>
      <p className="muted" style={{ margin: '0 0 20px', fontSize: 13 }}>{`Készült: ${datum}`}</p>

      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <button type="button" className="btn" onClick={letolt}>
          <Download size={15} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Letöltés (HTML)
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => window.print()}
        >
          <Printer size={15} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Nyomtatás / PDF
        </button>
      </div>

      {letoltve && (
        <p className="muted no-print" style={{ fontSize: 13, marginTop: -12, marginBottom: 20 }}>
          A letöltött fájl önálló: internet nélkül is megnyílik, és a böngésző
          „Nyomtatás → PDF-be mentés" funkciójával PDF-fé alakítható.
        </p>
      )}

      {dok.szakaszok.map((sz, i) => (
        <section key={sz.cim} style={{ marginTop: i === 0 ? 0 : 28 }}>
          <h2 style={{
            fontSize: 18,
            margin: '0 0 8px',
            paddingTop: i === 0 ? 0 : 16,
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          }}
          >
            {sz.cim}
          </h2>
          {sz.lenyeg && (
            <p style={{ color: 'var(--primary-text)', fontWeight: 600, fontSize: 14, margin: '0 0 10px' }}>
              {sz.lenyeg}
            </p>
          )}
          {sz.blokkok.map((b, j) => <BlokkNezet key={`${sz.cim}-${j}`} b={b} />)}
        </section>
      ))}

      <p className="muted" style={{ marginTop: 36, fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        Belső felkészülési anyag — nem jogi tanácsadás, és nem helyettesíti az
        ügyvédi átnézést. A tartalom a tárgyalás időpontjában érvényes üzleti
        feltételeket tükrözi; árazás- vagy modellváltozás után frissítendő.
      </p>
    </div>
  );
}
