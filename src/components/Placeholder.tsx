export function Placeholder({ title, phase, blurb }: { title: string; phase: string; blurb: string }) {
  return (
    <div>
      <h2>{title}</h2>
      <div className="card">
        <span className="badge warn">{phase}</span>
        <p className="muted" style={{ marginTop: 12 }}>
          {blurb}
        </p>
      </div>
    </div>
  );
}
