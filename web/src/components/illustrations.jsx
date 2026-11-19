// Own illustrations for empty states. They are decorative and colored only through
// classes that read the tokens (see the "art" rules in app.css).

function Art({ children }) {
  return (
    <svg className="art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <ellipse className="art-ground" cx="80" cy="105" rx="58" ry="8" />
      {children}
    </svg>
  );
}

export function CalendarArt() {
  return (
    <Art>
      <rect className="art-card" x="30" y="18" width="100" height="80" rx="12" />
      <path className="art-head" d="M30 30a12 12 0 0112-12h76a12 12 0 0112 12v10H30z" />
      <path className="art-line" d="M56 12v14M104 12v14" />
      <rect className="art-cell" x="44" y="54" width="14" height="10" rx="3" />
      <rect className="art-light" x="73" y="54" width="14" height="10" rx="3" />
      <rect className="art-cell" x="102" y="54" width="14" height="10" rx="3" />
      <rect className="art-cell" x="44" y="72" width="14" height="10" rx="3" />
      <rect className="art-cell" x="73" y="72" width="14" height="10" rx="3" />
      <circle className="art-spark" cx="112" cy="82" r="9" />
      <path className="art-check" d="M107.5 82l3 3 5.5-6" />
    </Art>
  );
}

export function TrayArt() {
  return (
    <Art>
      <path className="art-card" d="M34 62l12-34h68l12 34v30a8 8 0 01-8 8H42a8 8 0 01-8-8z" />
      <path className="art-line" d="M34 62h30l6 10h20l6-10h30" />
      <rect className="art-light" x="64" y="40" width="32" height="6" rx="3" />
      <rect className="art-cell" x="70" y="50" width="20" height="5" rx="2.5" />
      <circle className="art-spark" cx="124" cy="24" r="5" />
    </Art>
  );
}

const ARTS = { calendar: CalendarArt, tray: TrayArt };

export function Illustration({ name = 'tray' }) {
  const Component = ARTS[name] || TrayArt;
  return <Component />;
}
