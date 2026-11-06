# Contract: v5 Layout API Shower Extension

Existing routes remain `POST /api/v5/layout` and `POST /api/v5/optimize`.

## Optional request field

```json
{
  "shower": {
    "drainType": "point",
    "drainX": 900.0,
    "drainY": 900.0,
    "drainWidth": 100.0,
    "drainLength": 100.0,
    "drainOrientation": "horizontal",
    "slopePercent": 2.0
  }
}
```

Omitting `shower` preserves the current response. Invalid containment, dimensions, slope or empty coverage returns the existing localized validation error response.

## Response additions

Each part MAY include `zoneId`, `surfaceWidth` and `surfaceHeight`. Shower results MUST include `shower.drain`, `shower.zones` and `shower.maxHeightMm`. Every zone includes stable ID, polygon rings, axis, slope and min/max height.

`POST /api/v5/optimize` returns the same additions inside every variant. Zone IDs and geometry are deterministic for the same canonical request.

## Compatibility

- Legacy `/api/layout` and `/api/optimize` are unchanged.
- Existing v5 clients may ignore additive response fields.
- Requests without `shower` retain previous required fields and metrics.
