# Editor UI contract

- “Добавить поддон” creates a centered 900 × 900 mm rectangle at 150 mm height.
- The selected object shows controlled fields for transform, height, drain and slope.
- Position is changed directly on the plan by dragging; persisted X/Y values are not exposed as form fields.
- Live movement is clipped to the owning room's usable polygon, holes and configured wall gap. Arrow keys move the focused object by 10 mm as a keyboard alternative.
- A compact vertex table supports add/remove and numeric x/y editing; invalid geometry is explained inline.
- Clicking an edge selects its type and reveals curb dimensions only for `curb`; an edge touching a room wall can explicitly be either wall contact without a curb or a full curb.
- Selection and controls remain keyboard accessible; touch targets are at least 44 px.
- Mobile shows the object and result but hides editing controls.
