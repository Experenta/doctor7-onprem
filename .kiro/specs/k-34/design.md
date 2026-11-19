# K-34 design

## Where the rules go

- `web/src/styles/app.css`, next to the K-33 block. The K-33 block is split in two, because
  its padding and its hidden column now have different ranges:
  - `@media (min-width: 720px) and (max-width: 1099px)`: the tighter cell padding, unchanged.
  - `@media (min-width: 720px) and (max-width: 1199px)`: `.appt-table .col-ends { display: none; }`.
  - `@media (min-width: 960px) and (max-width: 1019px)`: `.appt-table .person .avatar { display: none; }`.
- `web/src/styles/design.test.js`: the K-33 tests point to the new hiding block, and a
  K-34 block checks the three media queries and the stacked layout.
- No markup changes. `Avatar` already renders `aria-hidden="true"`.

## Why the block is split

One block cannot hold both ranges. Extending it to 1199 px would also extend the padding,
and the task keeps the padding at 1099 px.

## Limits

- jsdom does not lay out tables. The tests check the rules. The 24 px margin is a browser
  measurement by the project manager.
- `.table-wrap` keeps `overflow-x: auto` as a fallback.
