# Contract: Mobile Read-only and 3D Tray UI

## Compact viewport

- At 700 px width or below, the physical project opens in presentation mode.
- Mode control contains `План` and `3D`; mutation tools, editors, calculation and destructive commands are not rendered.
- Plan pan, zoom, room selection and part inspection remain available.
- A visible label says `Просмотр — редактирование доступно на компьютере`.
- Resizing above 700 px restores normal desktop mode without changing the document.

## 3D tray

- Each slope zone is a planar mesh at calculated elevations.
- Tiles use the same split contours and zone IDs as the 2D result.
- Drain is visually distinct at the height reference.
- Break lines remain readable through mesh boundaries and grout outlines.
- Orbit, zoom, wall visibility and reset continue on desktop and touch screens.
- Canvas accessible label announces the shower tray and drain.

## Manufacturing output

- Visible and exported cut lengths are integer millimetres.
- Rounding changes labels only, never contour coordinates.
- Shower CSV dimensions use plane-aware surface dimensions.
- Complex polygons keep per-edge SVG dimensions and warning behavior.
