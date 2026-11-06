# Research: Производственные размеры и душевой поддон

## Decision 1: Preserve 0.1 mm geometry and round only manufacturing output

**Decision**: Continue calculating and storing contours at 0.1 mm. Round positive cut lengths to the nearest integer millimetre with `.5` upward only when producing visible manufacturing labels and CSV/SVG values.

**Rationale**: Snapping contours themselves to 1 mm can create gaps, overlaps and changed areas. The cutter tolerance is a property of the fabrication instruction, not of the room model.

**Alternatives considered**: Round every vertex to 1 mm (rejected because it changes topology); truncate dimensions (rejected because error can approach 1 mm and is directionally biased).

## Decision 2: Build the tray from bounded planar zones

**Decision**: A point drain uses up to four dominant-axis planar zones meeting at diagonal break lines. A horizontal or vertical linear drain uses up to two planes meeting on the drain axis. The drain footprint is removed from the tiled region, and every tile cell is intersected with zones before parts are emitted.

**Rationale**: Rigid porcelain cannot bend across a break line. Backend zone splitting makes the 2D schedule and 3D model describe the same manufacturable pieces.

**Alternatives considered**: Smooth cone surface (not manufacturable from flat pieces); purely visual vertex deformation in 3D (would disagree with the schedule); free-form triangulated screed (too broad for the first version).

## Decision 3: Use a deterministic height function

**Decision**: Drain height is the zero reference. Point-drain height is `slope × max(|dx|, |dy|)`; linear-drain height is `slope × perpendicular distance to the drain axis`. Each returned zone declares its plane direction, and all zone vertices receive heights from the same function.

**Rationale**: The function is continuous, produces explicit planar facets and is easy to validate for monotonic drainage.

**Alternatives considered**: Equal perimeter elevation for arbitrary contours (requires a more complex variable-slope surface); user-authored vertex elevations (future extension).

## Decision 4: Keep schema version 6 with an optional room field

**Decision**: Add optional `showerTray` to room records. Old documents without the field parse unchanged; no database migration is required because documents are stored as JSON.

**Rationale**: The addition is backward-compatible and does not change existing required fields.

**Alternatives considered**: Schema version 7 (unnecessary migration burden for an optional additive field); storing the tray only in session state (would lose project intent).

## Decision 5: Mobile is an explicit read-only presentation mode

**Decision**: At the existing 700 px compact breakpoint, force the physical workflow out of object editing, hide mutation tools and parameter panels, expose only Plan and 3D choices, and keep pan/zoom/selection available. Resize back to desktop restores editing controls without automatically applying a command.

**Rationale**: Hiding controls alone is insufficient if canvas callbacks still mutate state. Mode gating at the workflow boundary prevents accidental changes and provides clear feedback.

**Alternatives considered**: Disable only wall drawing (other edits remain dangerous); show disabled editing controls (crowds the phone and creates false affordances); separate mobile application (out of scope).

## Decision 6: Extend the current Three.js renderer

**Decision**: Build one floor mesh per returned slope zone and one tile mesh per already-split part. Set vertex elevation before rotating each shape into the floor plane, recompute normals, and place a distinct drain mesh at the reference height.

**Rationale**: Backend splitting guarantees every rendered polygon is planar, so Three.js triangulation produces the same facet geometry as the calculation.

**Alternatives considered**: Shader-only displacement (harder to inspect and select); a second 3D renderer (duplicates controls, lighting and cleanup).

## Decision 7: Deploy as an atomic release

**Decision**: Validate locally, commit and push, create `/opt/plitka/releases/<commit>` on VXR_01, reuse `/opt/plitka/.env.production`, build with the production compose file, wait for readiness, switch `/opt/plitka/current`, and verify HTTPS health and a representative layout request.

**Rationale**: This matches the documented release layout and keeps the previous release available for rollback.

**Alternatives considered**: Build in the current directory (non-atomic and harder to roll back); deploy uncommitted files (not reproducible).
