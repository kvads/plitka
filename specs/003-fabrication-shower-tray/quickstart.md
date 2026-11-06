# Quickstart Validation: Производственные размеры и душевой поддон

## Automated checks

Baseline before implementation (2026-11-06): backend `104 passed`; production frontend build passed with the existing lazy 3D chunk-size warning.

```sh
.venv/bin/python -m pytest backend/tests -q
npm --prefix frontend run build
cd frontend && npx playwright test tests/result-export.spec.ts tests/project-document.spec.ts tests/physical-editor.spec.ts tests/mobile-canvas.spec.ts
```

## Scenario A: whole-millimetre output

Export a layout containing a `556.6 mm` cut. Confirm SVG and CSV show `557 mm`, no cut length has a decimal, and geometry is unchanged.

## Scenario B: point drain tray

Enable a point drain, place a 100 × 100 mm frame inside a rectangular room, set 2.0% slope and calculate. Confirm plan shows drain, four zones and split tiles. In 3D, orbit close to the drain and confirm four planes meet the frame and no tile bends across a break. Export CSV and verify whole-mm surface dimensions and zone IDs.

## Scenario C: linear drain tray

Switch to a horizontal linear drain near a wall. Confirm plan and 3D use planes perpendicular to it and its footprint is not tiled. Move it outside the contour and confirm localized rejection.

## Scenario D: mobile read-only

At 375 × 812 and 812 × 375, confirm only `План` and `3D` are offered. Pan, zoom, select, orbit and reset. Confirm mutation controls are absent. Return to desktop width and confirm editing returns with an unchanged document.

## Production smoke check

After deployment, verify HTTPS health, authentication, one ordinary layout, one shower layout, desktop 3D and a 375 px mobile session. Keep the prior release available until all checks pass.
