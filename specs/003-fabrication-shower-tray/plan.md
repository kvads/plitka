# Implementation Plan: Производственные размеры и душевой поддон

**Branch**: `master` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-fabrication-shower-tray/spec.md`

## Summary

Разделить расчётную точность и производственное отображение размеров, добавить к комнате параметры душевого поддона с точечным или линейным сливом, рассчитывать плоские уклонные зоны и делить детали по их границам. Возвращать зоны и высотную модель вместе с раскладкой, использовать их в плане, экспорте и существующем Three.js-просмотре. На экранах до существующего мобильного breakpoint переводить физический редактор в режим просмотра: план и 3D доступны, все изменения и перерасчёт недоступны.

## Technical Context

**Language/Version**: Python 3.12+ (production image 3.14), TypeScript 5.9, React 19.2

**Primary Dependencies**: FastAPI, Pydantic, Shapely, NumPy; React, Three.js 0.186, Lucide

**Storage**: PostgreSQL JSON project documents with localStorage cache; optional shower-tray state is stored in the existing room document

**Testing**: pytest for geometry/API; TypeScript build and Playwright for exports, physical editor, mobile behavior and 3D scene

**Target Platform**: Desktop and mobile web; Linux Docker production behind Nginx

**Project Type**: React single-page application with FastAPI calculation service

**Performance Goals**: Preserve current layout limits and interactive 3D frame rate; shower zone splitting must not multiply the existing 1600-cell limit beyond four point-drain zones or two linear-drain zones

**Constraints**: Calculation geometry remains on the existing 0.1 mm canonical grid; manufacturing labels use 1 mm; old schema-v6 documents without a shower tray must continue to load; mobile viewing must never mutate project geometry or layout settings

**Scale/Scope**: One connected room, one point or linear drain per tray, planar slope zones, existing project catalog and deployment topology

## Constitution Check

The repository constitution is still the uncustomized template and defines no enforceable project gates. The plan therefore follows the established repository constraints: backward-compatible schema-v6 extension, canonical 0.1 mm geometry, explicit API validation, pytest and Playwright coverage, and no new runtime service.

**Post-design re-check**: Passed. The design adds no new service or datastore, preserves old documents and routes, and keeps the shower calculation bounded by the existing layout grid.

## Project Structure

### Documentation (this feature)

```text
specs/003-fabrication-shower-tray/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── layout-api.md
│   └── mobile-and-3d-ui.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── main.py
├── planner_v5.py
└── tests/test_planner.py

frontend/
├── src/
│   ├── types.ts
│   ├── api.ts
│   ├── components/canvas/
│   │   ├── PhysicalWorkflow.tsx
│   │   ├── PhysicalCanvas.tsx
│   │   ├── RoomPreview3D.tsx
│   │   └── canvas.css
│   └── domain/
│       ├── plan/
│       │   ├── types.ts
│       │   ├── schema.ts
│       │   └── shared-grid.ts
│       └── project/result-export.ts
└── tests/
    ├── physical-editor.spec.ts
    ├── mobile-canvas.spec.ts
    ├── project-document.spec.ts
    └── result-export.spec.ts
```

**Structure Decision**: Extend the existing FastAPI/React web application. Shower topology belongs in the canonical backend calculation, persisted user inputs stay on the room record, and display/export concerns remain in the frontend.

## Complexity Tracking

No constitution violations require justification. The feature reuses the current layout engine, project document and Three.js viewer rather than adding a separate subsystem.
