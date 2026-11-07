# Implementation Plan: Параметрический душевой поддон

**Branch**: `master` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

## Summary

Заменить настройку уклона всей комнаты самостоятельным объектом поддона. Объект хранится в локальных координатах помещения, имеет простой полигональный контур, трансформацию, высоту, типы рёбер и слив. Сервер рассчитывает верхние уклонные зоны и вертикальные поверхности; план и Three.js используют один результат.

## Technical Context

**Language/Version**: Python 3.14; TypeScript 5.9; React 19

**Primary Dependencies**: FastAPI, Pydantic, Shapely, React, Three.js

**Storage**: PostgreSQL JSON-документы проектов и localStorage-кэш

**Testing**: pytest, Playwright, TypeScript production build

**Target Platform**: desktop web editor; read-only mobile plan and 3D

**Project Type**: monolithic web application with Python API and React frontend

**Performance Goals**: interactive editing without visible delay; 3D remains interactive; bounded polygon and layout complexity

**Constraints**: 0.1 mm canonical geometry, backward-compatible schema v6 document, one connected polygon and one drain

**Scale/Scope**: one shower object per room in first release; 3–24 contour vertices; up to 24 edge surfaces

## Constitution Check

The constitution contains placeholders and defines no enforceable gates. The plan preserves existing dependencies, storage, API style and test approach. Post-design check: passed.

## Project Structure

### Documentation

```text
specs/004-parametric-shower-object/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code

```text
backend/
├── main.py
├── planner_v5.py
└── tests/test_planner.py

frontend/src/
├── api.ts
├── components/canvas/
│   ├── PhysicalCanvas.tsx
│   ├── PhysicalWorkflow.tsx
│   └── RoomPreview3D.tsx
└── domain/plan/
    ├── types.ts
    ├── schema.ts
    ├── migration.ts
    └── shared-grid.ts

frontend/tests/
├── physical-editor.spec.ts
└── project-document.spec.ts
```

**Structure Decision**: extend the existing physical v6 room record and v5 layout endpoint; no new service or datastore.
