# Research: Параметрический душевой поддон

## Decision 1: Local polygon plus transform

**Decision**: Store contour vertices in object-local coordinates and place them with origin and rotation.

**Rationale**: Moving and rotating the whole object does not rewrite its construction; numeric editing remains deterministic.

**Alternatives considered**: world coordinates only; a static imported 3D mesh.

## Decision 2: One object, multiple generated surfaces

**Decision**: Treat the shower as one user object that generates top slope zones, open fascias and curb faces.

**Rationale**: Users manipulate one assembly while fabrication and 3D retain separately tileable surfaces.

**Alternatives considered**: independent wall/slab objects; room-wide slope mode.

## Decision 3: Straight simple polygons first

**Decision**: Accept 3–24 vertices, no self-intersections or holes. Concave polygons are allowed.

**Rationale**: Covers common rectangular, L-shaped, trapezoid and niche trays while keeping containment and slope validation inspectable.

**Alternatives considered**: Bézier contours, arbitrary holes and boolean assembly of unlimited solids.

## Decision 4: Edge-owned construction

**Decision**: Each directed polygon edge owns its type and curb parameters. Vertex edits retain edge configuration by stable edge IDs where possible.

**Rationale**: A complex tray needs per-side wall contacts, exposed tile, entries and curbs.

**Alternatives considered**: one global edge type; automatic inference only.

## Decision 5: Backward conversion

**Decision**: Legacy room-wide shower settings are interpreted as an object matching the current room polygon at zero base height until the document is next edited.

**Rationale**: Existing saved projects keep their result and can move to the new model without a database migration.

**Alternatives considered**: discard old settings; bump the project schema.
