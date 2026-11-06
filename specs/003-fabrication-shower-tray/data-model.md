# Data Model: Производственные размеры и душевой поддон

## Persisted room extension

### ShowerTray

Optional object on a room record.

| Field | Type | Rules |
|-------|------|-------|
| `drainType` | `point` or `linear` | Required when tray exists |
| `drainX`, `drainY` | number, mm | 0.1 mm precision; footprint must be inside useful room contour |
| `drainWidth` | number, mm | 50–2000, 0.1 mm precision |
| `drainLength` | number, mm | Point: equals width; linear: 100–3000 |
| `drainOrientation` | `horizontal` or `vertical` | Used by linear drain; retained for point drain |
| `slopePercent` | number | 0.1–10.0%, 0.1 precision |

The tray is enabled by the presence of this object. Removing it returns the room to ordinary flat layout without changing material or layout rules.

## Layout request extension

`LayoutRequest.shower` mirrors `ShowerTray`. The field is optional and participates in the layout cache key.

## Layout response extension

### ShowerLayout

| Field | Type | Meaning |
|-------|------|---------|
| `drain` | drain object | Validated footprint and reference height |
| `zones` | `SlopeZone[]` | Connected planar portions of the tiled region |
| `maxHeightMm` | number | Maximum surface elevation above the drain |

### SlopeZone

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable within a calculation |
| `rings` | polygon rings | Plan projection after clipping |
| `axis` | string | Plane direction used by the height function |
| `slopePercent` | number | Actual plane slope |
| `minHeightMm`, `maxHeightMm` | number | Zone elevation range |

### Part additions

| Field | Type | Meaning |
|-------|------|---------|
| `zoneId` | string or null | Slope zone for shower parts |
| `surfaceWidth`, `surfaceHeight` | number | Plane-aware dimensions for output |

Contours remain plan coordinates on the 0.1 mm grid. Surface dimensions are derived and do not reconstruct geometry.

## State transitions

1. `no tray` → `tray configured`: cached layout becomes stale.
2. `tray configured` → `layout calculated`: server validates, subtracts drain, creates zones and splits parts.
3. `layout calculated` → `tray edited`: any shower field change invalidates layout.
4. `tray configured` → `no tray`: ordinary flat calculation returns.
5. Desktop → compact viewport: UI becomes read-only; document stays unchanged.
6. Compact → desktop viewport: editing controls return without replaying or saving a command.

## Validation invariants

- Drain footprint is fully inside the useful region and leaves tiled area.
- Zones cover the tiled region without material gaps or overlaps.
- Every shower part belongs to exactly one zone.
- Heights are finite, non-negative and decrease toward the drain.
- Rooms without `showerTray` produce the previous request and result.
