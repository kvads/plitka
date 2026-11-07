# Layout API contract extension

`LayoutRequest.shower` becomes an object-based request with identity, origin, rotation, base height, 3–24 local vertices, one edge definition per segment, one drain and slope settings. Legacy payloads without vertices remain accepted and use the room polygon at zero base height.

The response retains `shower.zones` and `shower.drain` and adds `object`, `surfaces`, `baseHeightMm`, and per-part `surfaceId`.

For object-based showers, `parts` contains both `room-floor` and `shower-top` details. `object.surfaceParts` contains fabrication pieces for `fascia`, `curb-top`, `curb-inside` and `curb-outside`. Aggregate metrics include every family, while the room floor excludes the object footprint.
