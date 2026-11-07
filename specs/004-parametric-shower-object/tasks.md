# Tasks: Параметрический душевой поддон

**Input**: Design documents from `specs/004-parametric-shower-object/`

## Phase 1: Setup

- [x] T001 Record baseline backend and frontend checks in `specs/004-parametric-shower-object/quickstart.md`

## Phase 2: Foundational

- [x] T002 [P] Add failing document persistence coverage in `frontend/tests/physical-editor.spec.ts`
- [x] T003 [P] Add failing object geometry and surface contract tests in `backend/tests/test_planner.py`
- [x] T004 Add shared ShowerObject, edge and surface contracts in `frontend/src/domain/plan/types.ts`, `frontend/src/api.ts`, and `backend/main.py`

## Phase 3: User Story 1 — Separate raised object (P1)

**Goal**: Create, place, resize, rotate, persist and delete a raised shower object independently of the room floor.

**Independent Test**: A 1200 × 900 × 150 mm rectangle survives reload and appears raised in 3D.

- [x] T005 [US1] Implement strict backward-compatible document parsing and defaults in `frontend/src/domain/plan/schema.ts`
- [x] T006 [US1] Add shower-object creation and controlled transform/size/height properties in `frontend/src/components/canvas/PhysicalWorkflow.tsx`
- [x] T007 [US1] Render selectable object outline and handles in `frontend/src/components/canvas/PhysicalCanvas.tsx`
- [x] T008 [US1] Add end-to-end create/edit/save/reload/delete coverage in `frontend/tests/physical-editor.spec.ts`

## Phase 4: User Story 2 — Shape, edges and drain (P2)

**Goal**: Edit a simple polygon, configure each edge, and calculate valid slopes to one drain.

**Independent Test**: An L-shaped object with wall/open/curb/entry edges validates and produces drain zones.

- [x] T009 [US2] Validate and transform 3–24 local vertices and edge definitions in `backend/main.py` and `backend/planner_v5.py`
- [x] T010 [US2] Build object-local top zones and drain geometry in `backend/planner_v5.py`
- [x] T011 [US2] Add vertex and selected-edge controls with inline validation in `frontend/src/components/canvas/PhysicalWorkflow.tsx`
- [x] T012 [US2] Render edge kinds, drain and zones on plan in `frontend/src/components/canvas/PhysicalCanvas.tsx`

## Phase 5: User Story 3 — Full tiling and 3D (P3)

**Goal**: Tile top, fascia and curb surfaces and render the physical assembly in 3D.

**Independent Test**: A raised object with exposed faces and curb appears correctly in 3D and its report includes every surface.

- [x] T013 [US3] Generate fascia and curb surface results and areas in `backend/planner_v5.py`
- [x] T014 [US3] Include object geometry in layout requests and invalidate stale results in `frontend/src/domain/plan/shared-grid.ts` and `frontend/src/components/canvas/PhysicalWorkflow.tsx`
- [x] T015 [US3] Render raised top, exposed faces and curbs in `frontend/src/components/canvas/RoomPreview3D.tsx`
- [x] T016 [US3] Add fabrication, export and 3D browser coverage in `frontend/tests/physical-editor.spec.ts`

## Phase 6: Polish

- [x] T017 Update `README.md` and complete all automated and visual scenarios from `specs/004-parametric-shower-object/quickstart.md`

## Phase 7: Placement tool and compound material calculation

- [x] T018 Add failing compound floor/top/fascia/curb material tests in `backend/tests/test_planner.py`
- [x] T019 Add failing browser coverage for the «Поддон» placement tool, off-centre linear drain and room deletion lifecycle in `frontend/tests/physical-editor.spec.ts`
- [x] T020 Implement the canvas placement tool in `frontend/src/components/canvas/PhysicalWorkflow.tsx` and `frontend/src/components/canvas/PhysicalCanvas.tsx`
- [x] T021 Make the default and editable drain narrow, linear and independently positioned in object-local coordinates
- [x] T022 Calculate room floor minus footprint together with tray top in `backend/planner_v5.py`
- [x] T023 Generate tile details for fascia, curb top, inside and outside surfaces in `backend/planner_v5.py`
- [x] T024 Extend response validation, metrics, CSV and 3D rendering for compound surface details
- [x] T025 Remove orphan shower objects with their room and cover the lifecycle in browser tests
- [x] T026 Run backend, build, browser and visual 3D validation; update quickstart and deploy production release

## Phase 8: Recessed shower bowl

- [x] T027 Add failing recessed-depth validation and surface-height tests
- [x] T028 Add `recessDepthMm` to persisted, request and response contracts with backward-compatible zero default
- [x] T029 Add controlled «Глубина чаши» editing next to overall tray height
- [x] T030 Lower the sloped top and drain in 3D while extending curb inner walls through the recess
- [x] T031 Count recessed inner-wall tile details independently from outer curb faces
- [x] T032 Run backend, build, browser and visual validation; update docs and deploy production

## Dependencies

- T002–T004 block all user stories.
- US1 is the MVP and blocks persisted editing in US2/US3.
- US2 provides geometry consumed by US3.
- Tests precede their matching implementation.

## Implementation Strategy

Deliver a compatible persisted object first, then polygon/edge construction, then fabrication surfaces and 3D. Existing non-shower rooms remain unchanged throughout.
