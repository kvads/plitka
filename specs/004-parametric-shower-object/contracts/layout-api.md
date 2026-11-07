# Layout API contract extension

`LayoutRequest.shower` becomes an object-based request with identity, origin, rotation, base height, 3–24 local vertices, one edge definition per segment, one drain and slope settings. Legacy payloads without vertices remain accepted and use the room polygon at zero base height.

The response retains `shower.zones` and `shower.drain` and adds `object`, `surfaces`, `baseHeightMm`, and per-part `surfaceId`.
