// The brand: a typographic logotype and a simple own glyph. The logo file of the
// project is not part of the repository, because its ownership is not confirmed.

export function Glyph({ className }) {
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="glyph-tile" x="1" y="1" width="30" height="30" rx="9" />
      <path className="glyph-stroke" d="M10 11h12l-6.5 11" />
      <circle className="glyph-dot" cx="22.5" cy="23" r="2.2" />
    </svg>
  );
}

// "Doctor7", with the 7 in turquoise. It is meant for purple and gradient surfaces.
export function Logotype() {
  return (
    <span className="logotype">
      Doctor<span className="logotype-seven">7</span>
    </span>
  );
}
