// Initials for an avatar. The input is a display name ("Ana Rivera") or an ID ("u-luis").
// An ID starts with a one-letter kind prefix, which is skipped when more text follows.
export function initialsOf(text) {
  const parts = String(text || '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const words = parts.length > 1 && parts[0].length === 1 ? parts.slice(1) : parts;
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}
