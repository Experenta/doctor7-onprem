# K-34 requirements: appointment list keeps a 24 px margin from 720 to 1280 px

Source: the browser measurements of the project manager on the demo, with the rules injected
through CSSOM. The measurements are in the pull request body, not in this folder.

## R1. The table fits its wrapper with a margin of at least 24 px

- From 720 px to 1280 px, the table in `.table-wrap` has at least 24 px of room between its
  minimum width and the wrapper width, for both the professional and the client view.
- Today the professional view at 960 px has 14 px of overflow, and the "Open" action is cut.

## R2. Ends column shown from 1200 px

- The "Ends" column is hidden from 720 px to 1199 px.
- From 1200 px the column is shown again.

## R3. Avatars hidden in the narrow range

- From 960 px to 1019 px the avatars of the Professional and Client cells are hidden.
  They are decorative (`aria-hidden`).

## R4. Nothing else changes

- The padding of K-33 keeps its range, from 720 px to 1099 px.
- No change below 720 px, in other screens, or in any text.
- No change to the API, migrations, `packaging/`, `tools/`, or `web/package.json`.
