# K-33 design

## Where the rules go

- `web/src/styles/app.css`, in a new `@media (min-width: 720px) and (max-width: 1099px)`
  block placed after the stacked block of the tables (below 720 px).
- `web/src/pages/Appointments.jsx`: the header and the cells of the "Ends" column get the
  class `col-ends`. No other markup changes.

## Rules in the range

- `.appt-table .col-ends { display: none; }`. The column is removed from the layout, so
  the browser does not compute its width. Assistive technology also skips it in this
  range. This is accepted by the task.
- `.appt-table th, .appt-table td { padding-left: var(--space-2); padding-right: var(--space-2); }`.
  Each cell loses 4 px on each side. The start cell keeps its 2.5 rem left padding, which
  is set by `.table .cell-start` with a higher specificity.

## Width budget (from the measurements of the task)

| Viewport | Sidebar | Wrapper | Needed without "Ends" (client) | Result |
| --- | --- | --- | --- | --- |
| 720 px | no | about 638 px | 630 px | fits (tighter padding gives more room) |
| 960 px | yes | about 620 px | 630 px, about 586 px with tighter padding | fits only with tighter padding |
| 1099 px | yes | about 759 px | with "Ends": 724 px | the column is hidden although it would fit |

The wrapper widths come from the two measurements in the task, 768 px (686 px) and 960 px
(about 620 px), and the offsets derived from them. They are not measured again here.

## Limits of this design

- jsdom does not lay out tables. The tests check the rules and the markup. The fit is
  checked in a real browser by the project manager.
- `.table-wrap` keeps `overflow-x: auto` as a fallback. The tests do not require it to be
  unused, because the fit is a browser measurement.
