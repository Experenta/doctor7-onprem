# K-33 requirements: appointment list without horizontal scroll

Source: the browser measurement of the deployed demo by the project manager.

## R1. No horizontal scroll between 640 and 1100 px

- The appointment list (`Appointments.jsx`, the table inside `.table-wrap`) has no
  horizontal scroll at any width from 640 to 1100 px, with and without the sidebar.
- The "Open" action of every row is visible.
- The measurement at 768 px that started this task: the table needed 724 px (client view)
  and 711 px (professional view), and the wrapper gave 686 px and 671 px.

## R2. Ends column hidden in the range

- From 720 px to 1099 px, the "Ends" column is hidden (header and cells). The end time is
  shown in the appointment detail.
- Below 720 px the table stacks, as it does now, and every field keeps its label.
- From 1100 px the column is shown again.

## R3. Tighter padding when the column is hidden alone is not enough

- With the sidebar (from 960 px) the wrapper is about 620 px wide. The client view needs
  630 px without "Ends". Tighter horizontal cell padding in the same range closes the gap.

## R4. Nothing else changes

- No change to the API, the texts, the behavior, or the screens other than the list.
- The 375 px stacked layout does not change.
