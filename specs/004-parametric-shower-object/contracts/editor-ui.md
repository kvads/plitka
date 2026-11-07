# Editor UI contract

- “Добавить поддон” creates a centered 900 × 900 mm rectangle at 150 mm height.
- The selected object shows controlled fields for transform, height, drain and slope.
- A compact vertex table supports add/remove and numeric x/y editing; invalid geometry is explained inline.
- Clicking an edge selects its type and reveals curb dimensions only for `curb`.
- Selection and controls remain keyboard accessible; touch targets are at least 44 px.
- Mobile shows the object and result but hides editing controls.
