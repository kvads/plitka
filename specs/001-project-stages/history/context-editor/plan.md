# Implementation Plan: контекстный редактор, удаление и очистка проекта

**Branch**: `001-project-stages` — идентификатор функции из setup-plan; Git-ветка не создавалась. **Date**: 2026-10-12. **Spec**: [spec.md](spec.md).

**Input**: уточнения 2026-10-12, FR-035–FR-038 и связанные изменения FR-003/005/008/009/010/027/033; замечания I1/U1 закрыты согласованным запретом ручного 180° и моделью выбора диапазона. Phase 0–1 повторно выполнены после уточнений I1/U1: решения сверены с текущими исходниками, уточнены категории отказов API, идентичность диапазона и защита позднего импорта. 55 задач T122–T176 выполнены 2026-10-12; номера и завершённая история сохранены. Build/typecheck и адресные быстрые e2e прошли; реестр запусков и исправлений находится в quickstart.md.

## Summary

Заменить общую форму объекта контекстными меню поверх полотна. Вершины, стены, помещения, отверстия и размерные условия выбираются непосредственно на плане, включая клавиатуру. Удалить пресеты, номерные списки и старый блок угла; отдельный инструмент «Угол» получает две стены и явно выбранную дугу до ввода градусов. Ручные 0°/180°/360° запрещены, вычисленный 180° остаётся показанием без новой фиксации. Диапазон длины выбирается через два разных узла одной исходной стены с отдельными состояниями выбора и отмены.

Удаление комнаты атомарно удаляет всю её границу, включая общие стены, только её осиротевшие вершины и зависимые условия. Серверный предпросмотр показывает соседние области и каскад до подтверждения. Добавить самостоятельное удаление отверстия и размерного условия. Успех одновременно закрывает меню утраченного объекта и связанные незавершённые взаимодействия.

«Очистить проект» — одно действие целого документа с подтверждением, сохранением id/name/address и session-only Undo. Очистка удаляет также detached комнаты, restorePoint, pending и результаты. Общая runtime эпоха ограждает и запросы, и очередь записи после clear и Undo; прежние результаты автоматически не возвращаются.

Графовая база T047–T097 и защита вершин T098–T121 завершены. Их задачи не переоткрывать: [история графа](history/graph-v3/plan.md), [история защиты вершин](history/vertex-safety/plan.md). Поля selected X/Y уже удалены при уточнении; в реализации сохранено отсутствие этих полей у выбранной вершины. В tasks.md добавлены новые T122–T176; выполненная история сохранена без изменения статусов.

## Technical Context

**Language/Version**: Python 3.14.4 в существующей .venv; TypeScript 5.9.3, React 19.3.0 по frontend/package-lock.json. Версии зависимостей не обновляются.

**Primary Dependencies**: FastAPI/Pydantic, Shapely 2, NumPy, SciPy 1.18.1; Vite 7.3.7, SVG, Pointer Events, lucide-react; Playwright 1.64.0 из lockfile. Новые библиотеки не нужны.

**Storage**: ProjectDocumentV3/JSON envelope v3, localStorage `plitka-projects-v3`, Web Lock `plitka-projects-write`, expectedRevision CAS. Backend stateless. Расширяется union команд, но не форма сохранённого документа; никакой новой БД или миграции. Без Web Locks сохраняется текущий явный отказ записи.

**Testing**: только быстрые Chromium Playwright e2e на малых изолированных fixtures; один worker, 15 с на тест, 5 с на действие. Build/typecheck допустимы при реализации. Performance, нагрузочные, стресс-тесты, benchmark, pytest и отдельные unit/property/contract-наборы не запускать, включая косвенный запуск. На этапе планирования ни тесты, ни сборка не выполняются.

**Target Platform**: браузерный React + FastAPI, мышь/touch/pen и клавиатура, ширина 375/1440 CSS px. **Project Type**: существующее веб-приложение.

**Performance Goals**: hover/выбор/дуги локальны, без запросов на pointermove; серверный preview только по явному удалению. Импорт читает локальный файл асинхронно; экспорт готового результата сейчас синхронный и не требует нового endpoint. Новых количественных целей или замеров производительности нет.

**Constraints**: физические координаты в мм, углы в градусах, прежняя точность 0,1 мм/°. Сетка/zoom не заменяют числа. Защита точного совпадения и экранный радиус 12 CSS px сохраняются. Старые невалидные документы читаются без ремонта. Размерные intent/raw, legacy retry, целевые room guards и запрет оживления stale результатов остаются.

**Scale/Scope**: одна страница проекта с четырьмя этапами. Новый preview endpoint и три команды удаления; контекстные панели, клавиатурные targets и hook-level reset. До 2100 vertices, 6300 segments/chains, 12600 constraints, 20 voids, 2 МиБ на запрос/файл по прежним лимитам. Предельные размеры не используются как нагрузочная проверка.

## Constitution Check

`.specify/memory/constitution.md` — незаполненный шаблон; утверждённых дополнительных принципов нет. Примеры комментариев не являются требованиями. Gates ниже следуют из пользовательской спецификации и действующих контрактов.

| Gate | До Phase 0 | После Phase 1 |
| --- | --- | --- |
| FR-035: один контекст, выбор на полотне вместо списков | PASS | PASS — reducer, hit targets и клавиатурный путь |
| FR-036: общие стены удаляются, внешние сохраняются, каскад атомарен | PASS | PASS — серверный preview/impactKey и единый helper |
| FR-037: тот же проект, полный сброс, session Undo | PASS | PASS — пустой v3, runtime history и эпохи |
| FR-038: явные два луча и дуга, включая вогнутую | PASS | PASS — отдельный инструмент, прежний setAngle; ручные 0°/180°/360° запрещены |
| FR-033: прямой выбор диапазона одной цепи и его отмена | PASS | PASS — rangeFirst/rangeSecond/range context, G24r |
| FR-013/023/026/034: ввод и старые снимки сохраняются, stale не оживает | PASS | PASS — basis/intent, различение 422/invalid/unresolved и guards, включая импорт |
| FR-027: клавиатура и 375 px без номерных списков | PASS | PASS — roving focus/курсор и bounded panel |
| FR-029: только быстрые e2e; никаких performance | PASS | PASS — quickstart и ограничения команд |
| Совместимость и отсутствие неподтверждённых миграций | PASS | PASS — v3 сохранён, old commands читаются |

Неразрешённых проектных вопросов или необоснованных gate failures нет. Исключения из конституции не требуются.

## Project Structure

### Documentation

```text
specs/001-project-stages/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/{geometry-api,project-file,workflow-ui}.md
├── quickstart.md
├── tasks.md                     # выполненные T122–T176 и завершённая история T047–T121
├── checklists/requirements.md    # 16/16, не изменяется планированием
└── history/
    ├── contour-v2/
    ├── graph-v3/
    └── vertex-safety/            # снимок прежних design/tasks до этого перепланирования
```

### Source Code

```text
backend/geometry/
├── graph_models.py              # preview models и новый command union
├── graph_routes.py              # /deletion-preview
├── graph_commands.py            # общий атомарный каскад, deleteConstraint без solver
├── deletion.py                  # новый чистый расчёт последствий, impactKey
└── faces.py                     # существующий inspect, границы и зависимости
frontend/src/domain/plan/
├── types.ts / schema.ts         # новые команды, runtime types отдельно от JSON
├── commands.ts                 # прежние помощники команд
├── deletion-api.ts              # typed вызов read-only preview через общий api.ts
├── angles.ts                    # общая геометрия дуг и идентичность условия
├── editor-state.ts              # новый context/interaction reducer, проверка ссылок
├── project-lifecycle.ts         # новые clear/Undo helpers и правила эпохи
├── useGraphProject.ts           # whole-document action, history, accepted transition
├── storage.ts                  # отмена устаревших queued writes под Web Lock
└── rooms.ts                    # целевое удаление записи, detached neighbours/guards
frontend/src/components/canvas/
├── GraphWorkflow.tsx            # оркестрация этапов, контекст и lifecycle результатов
├── ProjectCanvas.tsx            # direct hit targets, keyboard cursor/focus
├── ToolPalette.tsx             # инструмент Угол
├── DimensionOverlay.tsx        # две интерактивные дуги и метки условий
├── ObjectContextPanel.tsx      # новая панель выбранного объекта/инструмента
├── ProjectMenu.tsx             # меню метаданных/восстановления/очистки
├── CanvasDialog.tsx            # общий диалог, focus trap и возврат фокуса
├── DeletionPreview.tsx         # новый диалог последствий
└── canvas.css                  # подсветка, focus, narrow panel/dialog
frontend/tests/
├── fixtures/projects.ts        # helpers прямого выбора, маленькие fixtures
├── room-editor.spec.ts
├── project-document.spec.ts
├── project-stages.spec.ts
├── projects.spec.ts
└── planner.spec.ts
```

**Structure Decision**: продолжать фактический domain/plan; legacy domain/room/project нужен для старых файлов/pending и не переписывается. Разделение GraphWorkflow ограничено конкретными контекстными панелями; новый frontend state framework и CAD engine не нужны. Перечисленные новые модули созданы. Import/export остаются действиями нижнего меню полотна. Typed preview выделен в deletion-api.ts; жизненный цикл preview, удаление RoomRecord и согласование restorePoint находятся в useGraphProject.ts. Историческая геометрия restorePoint сохраняется, ссылки на удалённую RoomRecord удаляются; Undo возвращает полный исходный документ. Проверки актуальности результатов и нового удаления расположены в planner.spec.ts, а проверки этапов/асинхронных ответов — в project-stages.spec.ts.

## Phase 0 — completed

[research.md](research.md) содержит решения R1–R10 с rationale/alternatives и ссылками на текущие исходники: прямой выбор, угол, физическое удаление границы, отличие удаления от снятия роли/fixed, whole-document clear, эпохи, очередь сохранений и точный контракт диапазона. Повторная сверка отдельно проверила существующий запрет ручного 180°, сохранение range при split, категории отказов API и позднее завершение чтения файла. Исследования выполнены read-only; пользовательские проекты не изменялись.

## Phase 1 — completed

- [data-model.md](data-model.md): сохраняемые сущности, runtime context/interaction/preview/focus, ClearProject, SessionHistory и ревизии.
- [geometry-api.md](contracts/geometry-api.md): preview/impactKey, deleteRoom/deleteVoid/deleteConstraint, каскад, совместимость существующих команд.
- [project-file.md](contracts/project-file.md): пустой v3, Undo вне JSON, CAS/очередь и guard поздних ответов.
- [workflow-ui.md](contracts/workflow-ui.md): контекстные панели, pointer/keyboard, дуги, подтверждения и 375 px.
- [quickstart.md](quickstart.md): группы G23–G32 быстрых e2e, адаптация старых helpers и честный реестр проверок.

## Implementation sequence for task generation

1. **Основа состояний и совместимость**. Добавить runtime context/interaction/focus, общий lifecycle contract и новые command/preview types со строгой схемой. Сохранить старые command variants и legacy pending. Переход принятого документа должен одновременно согласовывать меню/выделения.
2. **Очистка целого проекта (US1, MVP)**. Включить importV3/File.text и его success/error в общий guard; поздний импорт после clear/Undo/закрытия не открывает preview. Экспорт результата остаётся синхронным с проверкой актуальности перед download. Hook-level reset/defaults и discriminated history, синхронная инвалидация всех запросов/результатов, проверка epoch внутри Web Lock, revision-safe Undo. Меню проекта и подтверждение, очистка всех transient panels, ошибки сохранения/конкурентность. Сначала общий lifecycle, затем подключение каждого async пути; приёмка на готовых fixtures не зависит от нового инструмента угла.
3. **Контекстное полотно (US2)**. Разделить меню проекта/объектов/инструментов, убрать пресеты и списки, сохранить выполненное удаление selected X/Y. Реализовать прямые SVG targets, roving focus, клавиатурное добавление/перемещение/соединение и условия выбранной стены. Для диапазона добавить rangeFirst/rangeSecond и готовый range context: два разных узла одной цепи, порядок вдоль цепи, поле после пары, отмена/закрытие при утрате участника, G24r. Искать существующий chainLength по цепи и канонической паре концов независимо от fixed; не подменять им размер полной цепи. Согласовывать ссылки не только после команды, но и после обычного Undo/замены документа. Адаптировать shared test helpers, чтобы они больше не зависели от старого UI.
4. **Атомарное удаление (US2/US3)**. Общий серверный planner каскада, preview/hash и команды; повторная проверка impactKey, без частичных изменений. Удалить выбранную RoomRecord, пересвязать соседей, закрыть прямой/косвенный context, сохранить one-action Undo и stale guards. Отдельно deleteConstraint без solver и deleteVoid с отличием от unmark. Использовать уже готовую инвалидацию и очередь сохранений US1.
5. **Инструмент «Угол» (US3)**. Явная пара, общий узел, две дуги и поле после выбора; переиспользование существующего условия и raw текста, release/delete; Escape/tool change и keyboard. Старую автопару/«Второй луч»/«Сектор» убрать. Сохранить серверный запрет ручного 180°; добавить G31c для ручных 0°/180°/360° и derived 180° без фиксации.
6. **Быстрая приёмка и связанная регрессия**. Новые небольшие e2e по G23–G32, включая G24r/G31c и G30i для позднего импорта, delayed responses/queued saves, и адресно затронутые старые сценарии. Build/typecheck, 375/1440 px, реальный FastAPI для положительных операций. Обновить реестр только после запуска; performance не запускать.

Новые задачи следуют после T121 и сохраняют выполненную историю. Speckit-plan не создаёт и не помечает выполненными задачи следующего этапа. Синхронизация speckit-tasks выполнена: задачи жизненного цикла/импорта содержат G30i и синхронный экспорт без нового endpoint; задачи диапазона содержат lookup fixed/released условий, canonical target и различение invalid/unresolved/422. Deletion-preview часть G30 принимается после реализации US2, а G30i — в US1. Номера выполненных задач и архивы не изменены.

## Coverage для генерации задач

| Требования | Решение/зона | Проверки |
| --- | --- | --- |
| FR-005/008/027/035, SC-014 | Context reducer, direct SVG/keyboard, компактные панели | G23–G24 |
| FR-036, SC-015 | Deletion planner/preview/команды, rooms и закрытие меню | G25–G27b |
| FR-003/023/024/037, SC-016 | Whole-document clear, session history, epochs, import guard и CAS | G28–G30b, G30i |
| FR-009–013/027/038, SC-017 | Angle tool, arcs, запрет ручных 0°/180°/360°, прежний solver | G31–G32, включая G31c |
| FR-033, SC-012 | rangeFirst/rangeSecond/range, canonical target, повторное редактирование, отмена | G24r и прежний G04 |
| FR-026/028/032/034 | Схемы, legacy pending, точные ссылки/цепи и защита координат | G26–G30 и адресные G01–G22 |
| FR-029 | Только быстрые e2e и build/typecheck при реализации | Ограничения quickstart |

## Complexity Tracking

Необоснованных усложнений и нарушений gates нет. Новый preview endpoint нужен для проверяемого согласия на реальный каскад, общий runtime epoch — для clear→Undo при совпавших ключах, context reducer — для закрытия меню всех косвенно удалённых объектов. Эти решения используют существующие API/storage/React без новой инфраструктуры.
