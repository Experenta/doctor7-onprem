# Frontend design

Rules for everything in `web/`. They summarize the Doctor7 design brief, version 2.
They are rules, not copies of any file. When this file and an older habit disagree,
this file wins.

## Mode and direction

The interface is a work tool (Operate mode) with small moments of brand. People
scan it fast between sessions, so it favors consistency and familiar patterns.
The brand shows in precise details, not in decoration.

The idea is "a bright clinic with a color signature". The canvas is a very pale
lavender. Structure is deep purple. Turquoise is the light: active states,
indicators, data. Magenta is a single spark: at most one action or notice per
screen, and at most 5% of a screen.

The product should feel warm, trustworthy, clinical without being cold, and
modern. It earns "premium" through care, not ornament.

## Color tokens

Define every color once as a CSS variable in `web/src/styles/tokens.css`. Use
colors only through those variables. No hex, `rgb()` or `hsl()` value outside
that file.

| Role | Tokens |
| --- | --- |
| Purple (structure) | 950 `#1E0F52`, 900 `#2A1466`, 700 `#482494`, 500 `#6E4FC9`, 100 `#ECE7F8`, 50 `#F6F4FC` |
| Turquoise (light) | 500 `#18E4DC`, 700 `#0A8E88`, 100 `#DDFBF9`, text on turquoise `#0B2A28` |
| Magenta (spark) | 600 `#D800B0`, 100 `#FBE1F6` |
| Neutrals | ink `#1B1535`, muted `#5C5778`, line `#E4DFF2`, white |
| Brand gradient | purple 700 to magenta 600, 135 degrees |

Two derived tokens exist because the brief colors cannot carry small text at 4.5:1:
a darker turquoise (`#07706B`) for text on light surfaces, and a darker magenta
(`#9C0081`) for text on light surfaces. A third derived token (`#CFC5EE`) is the tinted
text color on purple 950. Each derived token is covered by a contrast test.

### Contrast rules (tested)

- Turquoise `#18E4DC` is never text on a light surface (about 1.4:1). It is text
  or an icon only on purple 700, 900 or 950. On a light surface it is a fill with
  `#0B2A28` text, or a graphic.
- Turquoise 700 `#0A8E88` is about 4:1 on white. It carries large text and graphics
  (3:1) only. Small text on light uses the darker turquoise token.
- White on magenta 600 is about 4.6:1. It is allowed for text on the brand gradient
  and for icons. Small text in magenta on a light surface uses the darker magenta.
- Purple 700 on white is about 9:1.
- Normal text 4.5:1, large text 3:1, graphics and control borders 3:1.
- On colored surfaces, secondary text is tinted toward that color, not gray.

## Type

- Montserrat 700 and 800 for titles and figures, with tabular numbers. Lato 400 and
  700 for body text.
- Both are self-hosted with `@fontsource` (latin subsets). No Google Fonts and no
  request to any external server.
- Fixed rem scale, ratio 1.2. Running text is 65 to 75 characters wide. No fluid
  type. No system font as the heading voice.

## Shape, depth, motion

- Radii: 16 px on cards, 12 px on controls, 999 px on chips.
- Two soft shadow levels, with offset and blur. No hard offset shadows.
- The brand gradient appears only on the welcome band and on the sign-in panel.
  Never on reading text, never as gradient text.
- Motion is 150 to 200 ms and only shows state: a soft lift on card hover, a
  shimmer on loading skeletons, a soft pulse on "waiting". No page entrance
  animation. Every animation stops under `prefers-reduced-motion`.

## Brand

- The logotype is typographic: "Doctor7" in Montserrat 800, with the 7 in
  turquoise on purple. A simple own glyph, drawn as inline SVG, goes with it.
- Do not add the logo file to the repository. Its ownership is not confirmed.

## Structure and interaction

- Shell: a fixed left sidebar in purple 950. On phones it becomes a bottom bar of
  up to four destinations. Active item has a turquoise indicator. The user chip
  (initials and role) sits at the bottom. The page header is light: title, date,
  actions.
- Every screen has four data states: loading (a skeleton with shimmer, not a
  centered spinner), empty (teaches what to do, with an own SVG illustration in
  brand colors), error (states the problem, offers a retry), and no permission.
- Ranges to design for: 0 to about 200 appointments, long names, notes of 2,000
  characters, 100 chat messages.

## Quality rules (each one is tested or reviewed)

- Interactive components have all states: normal, hover, visible focus (3 px ring),
  active, disabled, loading, error.
- Responsive from 360 px to 1536 px by structure: collapse navigation, stack
  tables. Touch targets are at least 44 px.
- Forbidden: hard offset shadows, gradient text, decorative glass or blur, a
  colored side border wider than 1 px on cards or alerts, emoji or Unicode glyphs
  as icons, nested cards, small labels above headings, section numbering, modals
  for tasks that do not need them, dark mode.
- Style what the browser draws too: text selection, text cursor (`caret-color`),
  focus rings, and tabular numbers in tables, all from the palette.
- Copy: controls name their action. Errors state the problem and how to recover.
  All text is English.
- Accessibility (AA): semantic HTML, labeled form fields, logical tab order,
  `aria-live` for chat messages and errors, `prefers-reduced-motion`.

## Icons

Single-stroke SVG components in `web/src/components/icons.jsx`. No icon library.
Do not add an `xmlns` attribute (it is an external URL string). Illustrations
for empty states are own SVG too, colored only through classes that read the
tokens.

## Video rules

- Google Meet opens in a new tab: `target="_blank"` with
  `rel="noopener noreferrer"`. Never an `iframe`.
- Jitsi is embedded in an `iframe`.

## Data and network rules

- The client talks only to `/api` and `/ws`. No other host, CDN, remote image,
  or font. No keys in the code.
- The session is an `HttpOnly` cookie. Use `credentials: 'include'`. Requests that
  change state send `Content-Type: application/json`.
- Dates are shown in `America/Bogota`. The API sends UTC.
- Do not import `firebase` or `twilio`. Write all code from scratch. No UI kit.
