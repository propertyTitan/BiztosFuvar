// Landing oldal.
export default function Home() {
  return (
    <div>
      <h1>Üdvözlünk a BiztosFuvar platformon</h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: 720 }}>
        Magyarországi közösségi fuvartőzsde feladóknak és szállítóknak.
        A bizalom alapköve a <strong>Proof of Delivery 2.0</strong>:
        kötelező fotózás, GPS-alapú validálás és letéti (Escrow) fizetés
        a Barion Bridge-en keresztül.
      </p>
      <div className="row" style={{ marginTop: 32 }}>
        <a className="btn" href="/dashboard">Irányítópult megnyitása</a>
        <a className="btn btn-secondary" href="/dashboard/uj-fuvar">Új fuvar feladása</a>
      </div>
    </div>
  );
}
