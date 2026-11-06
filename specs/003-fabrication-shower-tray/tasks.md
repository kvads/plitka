# Tasks: Производственные размеры и душевой поддон

**Input**: Design documents from `/specs/003-fabrication-shower-tray/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Phase 1: Setup

- [x] T001 Verify existing Git, Docker, Python and TypeScript ignore rules in `.gitignore` and `.dockerignore`
- [x] T002 Record baseline backend, build and targeted browser results in `specs/003-fabrication-shower-tray/quickstart.md`

## Phase 2: Foundational contracts

- [x] T003 [P] Add optional shower request/result and part surface-dimension types in `frontend/src/types.ts`
- [x] T004 [P] Add persisted `ShowerTray` room type in `frontend/src/domain/plan/types.ts`
- [x] T005 Add strict backward-compatible `showerTray` parsing rules in `frontend/src/domain/plan/schema.ts`
- [x] T006 Include shower settings in layout requests and cache keys in `frontend/src/domain/plan/shared-grid.ts`

## Phase 3: User Story 1 — whole-millimetre manufacturing dimensions (P1)

**Goal**: Plans and schedules use executable integer-millimetre dimensions without changing geometry.

**Independent Test**: A 556.6 mm calculated edge exports as 557 mm in SVG and CSV while contour coordinates stay unchanged.

- [x] T007 [US1] Add failing whole-millimetre and geometry-preservation tests in `frontend/tests/result-export.spec.ts`
- [x] T008 [US1] Implement half-up manufacturing rounding and integer SVG/CSV output in `frontend/src/domain/project/result-export.ts`
- [x] T009 [US1] Show whole-millimetre production dimensions in the accepted-layout details in `frontend/src/components/canvas/PhysicalWorkflow.tsx`

## Phase 4: User Story 2 — shower tray calculation and 3D (P2)

**Goal**: Point and linear drains produce manufacturable planar zones, split tile parts, plan overlays and true sloped 3D geometry.

**Independent Test**: A rectangular point-drain tray returns four zones, excludes the drain, assigns every part one zone and renders matching planes in 3D.

- [x] T010 [P] [US2] Add failing point/linear drain geometry and API tests in `backend/tests/test_planner.py`
- [x] T011 [P] [US2] Add failing document persistence tests for optional shower trays in `frontend/tests/project-document.spec.ts`
- [x] T012 [US2] Add validated shower input models to v5 routes in `backend/main.py`
- [x] T013 [US2] Implement drain subtraction, planar zone generation, zone splitting, heights and surface dimensions in `backend/planner_v5.py`
- [x] T014 [US2] Validate additive shower responses in `frontend/src/api.ts`
- [x] T015 [US2] Add shower configuration controls and request invalidation in `frontend/src/components/canvas/PhysicalWorkflow.tsx`
- [x] T016 [US2] Render drain footprints and zone break lines in `frontend/src/components/canvas/PhysicalCanvas.tsx`
- [x] T017 [US2] Render zone and tile meshes at calculated heights plus drain geometry in `frontend/src/components/canvas/RoomPreview3D.tsx`
- [x] T018 [US2] Export zone IDs and plane-aware whole-mm dimensions in `frontend/src/domain/project/result-export.ts`
- [x] T019 [US2] Add end-to-end tray plan, export and 3D scene tests in `frontend/tests/physical-editor.spec.ts`

## Phase 5: User Story 3 — tray validation (P3)

**Goal**: Invalid drains and surfaces are rejected with localized, inspectable reasons.

**Independent Test**: Outside drains, empty tiled areas and invalid slopes are rejected; valid zones cover the region without overlap.

- [x] T020 [US3] Add coverage, overlap, monotonic-height and localized-error assertions in `backend/tests/test_planner.py`
- [x] T021 [US3] Surface tray validation errors and zone metadata in `frontend/src/components/canvas/PhysicalWorkflow.tsx`

## Phase 6: User Story 4 — mobile read-only presentation (P1)

**Goal**: Phones can inspect plan and 3D but cannot mutate or recalculate projects.

**Independent Test**: At 320, 375 and 430 px only Plan and 3D are available, edit controls are absent and the document is unchanged.

- [x] T022 [US4] Add portrait, landscape and resize read-only tests in `frontend/tests/physical-editor.spec.ts`
- [x] T023 [US4] Implement compact-viewport detection and mutation gating in `frontend/src/components/canvas/PhysicalWorkflow.tsx`
- [x] T024 [US4] Add accessible read-only status and responsive Plan/3D controls in `frontend/src/components/canvas/canvas.css`

## Phase 7: Polish, validation and release

- [x] T025 Run backend tests, TypeScript build and targeted Playwright suites from `specs/003-fabrication-shower-tray/quickstart.md`
- [x] T026 Inspect point and linear trays visually in desktop 3D and mobile portrait/landscape; verify touch-safe read-only controls
- [x] T027 Update feature documentation and `README.md` with shower, manufacturing precision and mobile read-only behavior
- [x] T028 Commit and push the validated release to `origin`
- [x] T029 Deploy an atomic release to VXR_01 using `compose.production.yaml` and `/opt/plitka/.env.production`
- [x] T030 Verify production readiness, HTTPS, ordinary layout, shower layout, 3D and mobile read-only behavior; retain rollback release

## Dependencies and execution order

- Setup precedes all implementation.
- T003–T006 establish contracts required by shower UI and persistence.
- US1 can complete after foundational contracts.
- US2 backend tests precede backend implementation; its UI depends on T003–T006 and T013.
- US3 extends US2 validation.
- US4 is independently testable after foundational room types, but is integrated after shower UI so both compact modes can be verified together.
- Release tasks require all stories and checks complete.

## Parallel opportunities

- T003 and T004 touch independent type modules.
- T010 and T011 add independent backend and document tests.
- Backend shower calculation can be developed while independent export tests are prepared, provided shared contracts are stable.

## Implementation strategy

1. Land production rounding as the smallest independent increment.
2. Add persisted shower input and canonical server calculation.
3. Integrate plan and 3D views, then validation.
4. Gate mobile mutation and verify presentation behavior.
5. Run the complete validation matrix and deploy atomically.
