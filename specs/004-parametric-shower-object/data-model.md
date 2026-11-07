# Data Model: Параметрический душевой поддон

## ShowerObject

| Field | Rule |
|---|---|
| `id` | stable non-empty string |
| `origin` | world x/y, 0.1 mm precision |
| `rotationDeg` | -180..180, 0.1° precision |
| `baseHeightMm` | 0..1000, 0.1 mm precision |
| `vertices` | 3..24 local points, simple polygon, non-zero area |
| `edges` | exactly one entry for every directed contour edge |
| `drain` | one point or linear drain in local coordinates |
| `slopePercent` | 0.1..10.0% |

## ShowerEdge

| Field | Rule |
|---|---|
| `id` | stable within object |
| `kind` | `wall`, `open`, `curb`, `entry` |
| `curbHeightMm` | 0..500; required for curb |
| `curbWidthMm` | 20..500; required for curb |

## Derived ShowerSurface

| Field | Meaning |
|---|---|
| `id` | stable result identifier |
| `kind` | `top`, `fascia`, `curbTop`, `curbInside`, `curbOutside` |
| `outline` | planar surface polygon in its local 2D basis |
| `worldCorners` | 3D placement basis |
| `areaMm2` | fabrication area |
| `edgeId` / `zoneId` | source construction link |

## State transitions

1. no object → add rectangle → editable object;
2. edit geometry → validate → invalidate previous layout;
3. calculate → generated surfaces and tile details;
4. legacy room-wide tray → derived object → persist on next edit;
5. delete object → ordinary room layout remains.
