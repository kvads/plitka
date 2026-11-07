# Quickstart Validation: Параметрический душевой поддон

## Automated checks

```bash
.venv/bin/python -m pytest backend/tests -q
cd frontend && npm run build
cd frontend && npx playwright test tests/project-document.spec.ts tests/physical-editor.spec.ts
```

Baseline before implementation: backend `111 passed`; frontend production build passed.

Result after implementation (2026-11-07): backend `113 passed`; frontend production build passed; targeted Playwright create/configure/calculate/3D/export scenario passed.

Placement-tool follow-up (2026-11-07): backend `114 passed`; production build and targeted Playwright scenario passed. The scenario places the object by clicking inside the room, uses an off-centre 70 × 460 mm linear drain, combines room-floor and tray-top layouts, exports fascia and three curb surface families, and verifies that clearing the owning room removes its shower object. Visual 3D output was inspected at `/tmp/shower-tool-compound-3d.png`.

Recessed-bowl follow-up (2026-11-07): backend `115 passed`; production build and targeted Playwright scenario passed. A 40 mm recess was persisted and inspected in `/tmp/shower-recessed-3d.png`; the sloped top and drain sit below the rim, while the inner curb face extends through the recess and is counted separately from the outside face.

Direct-manipulation follow-up (2026-11-07): production build and targeted Playwright scenario passed. X/Y fields are absent; pointer dragging moves the object with a live preview, a far drag stops at the room wall plus configured gap, and arrow keys provide 10 mm keyboard movement. Per-edge choices explicitly distinguish wall contact without a curb from a curb along the wall.

## Scenario A: separate raised rectangle

Create a room, add a 1200 × 900 × 150 mm shower object and place it near two walls. Confirm the room floor remains separate, two exposed fascias appear, save/reload preserves the object, and 3D shows a raised platform.

## Scenario B: complex contour and edge types

Add two vertices to form an L shape. Set edges to wall, open, curb and entry. Confirm invalid self-intersection is rejected locally and every accepted edge appears correctly in plan and 3D.

## Scenario C: linear drain and fabrication

Place a horizontal linear drain near a wall, calculate layout, and confirm top zones, drain exclusion, fascia/curb surfaces and their parts appear in the combined report.

## Scenario D: compatibility

Open a project without a shower and a legacy room-wide shower project. Confirm both load, the ordinary room stays unchanged, and the legacy tray can be edited as an object.

## Visual result

The targeted browser scenario was captured and inspected at `/tmp/shower-object-3d-curb.png`. The scene shows the L-shaped top above the room floor, sloped tile planes, point drain, exposed tiled fascias and a raised curb.
