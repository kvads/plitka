# Tasks: Единое полотно и план помещений из связанных стен

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [API](contracts/geometry-api.md), [файл проекта](contracts/project-file.md), [UI](contracts/workflow-ui.md), [quickstart.md](quickstart.md).

**Область**: расширение существующего FastAPI/React приложения, без переинициализации и новых библиотек. Завершённые T001–T046 сохранены без изменений в [архиве](history/contour-v2/tasks.md). Ни одна из них не подтверждает реализацию графа. Новые задачи начинаются с T047; актуальные отметки выполнения приведены ниже.

**Tests**: FR-029 — только быстрые Chromium e2e, build/typecheck. Запрещены performance, нагрузочные, стресс-тесты, benchmark, pytest и отдельные unit/property/contract-наборы; контракт проверять в браузерных e2e. Один worker, action timeout 5 с, test timeout 15 с, небольшие изолированные fixtures. Новые e2e писать до соответствующей реализации, зафиксировать ожидаемый функциональный провал, затем добиться успеха. Положительная геометрия — реальный backend; подмена ответов только для отказов/гонок. Эта генерация тесты не запускает.

**Updated**: повторная сверка с plan.md после U1/I1/I2/C1; сохранены T047–T097 и открытые статусы. Уточнены fieldInputs, категории команд, dependencyKey, stale/exportSuspended и границы Undo после reload.

**Organization**: пути относительно `/home/kvasy/vibe/plitka`. Setup → Foundation → US1–US5 → общая проверка. Конституция — неутверждённый шаблон. `[P]` обозначает независимые файлы в явно указанной группе после общих предпосылок, не разрешение запускать агентов или тесты параллельно. Остальные задачи последовательны в своей фазе.

## Phase 1: Setup

Подготовить данные и ограничить проверки; не менять работающую инфраструктуру без необходимости.
- [X] T047 Проверить scripts и конфигурацию `frontend/package.json`, `frontend/playwright.config.ts`; сохранить один worker, action timeout 5 с и test timeout 15 с, исключить неявные запрещённые наборы; разрешённые команды зафиксировать в `specs/001-project-stages/quickstart.md`.
- [X] T048 Дополнить `frontend/tests/fixtures/projects.ts` небольшими v3 графами (открытый, T/X, две комнаты, void, цепь 4000), v2 с разными draft/confirmed/basis, ack и legacyPending; сохранить существующие fixtures, использовать отдельные browser contexts.

## Phase 2: Foundational

Общие модели, проверка графа и API-клиент блокируют все пользовательские фазы. Здесь нет инструментов редактирования или пользовательского подтверждения.
- [X] T049 [P] Создать строгие схемы GraphSnapshot/commands/responses в `backend/geometry/graph_models.py`: «ID непустые ≤100 символов, уникальны среди вершин/участков/цепей/отверстий/условий внутри одного снимка»; «Все ссылки разрешаются внутри своего снимка»; «2100 вершин, 6300 сегментов, 6300 chains, 12600 условий, 20 voids»; «координаты для вычислений ±100000 мм»; «Конечные координаты вне диапазона допускаются в сохраняемом draft, но не в решении»; fieldInputs «строки ≤100», DirectedSegmentRef `{segmentId, forward:boolean}`, каждый Segment принадлежит ровно одной chain.
- [X] T050 [P] Создать `frontend/src/domain/plan/types.ts` и расширить `frontend/src/domain/project/schema.ts` до v3: schemaVersion «literal 3»; id «UUID нового проекта; при миграции сохраняется прежний непустой ID ≤100 символов»; name/address «имя после trim 1–120; адрес 0–300 символов»; revision «целое ≥0»; rooms «уникальные roomId, включая detached записи»; selectedRoomId «существующий roomId или null»; workflow «requestedStage: object / tile / rules / variants»; viewport «centerX, centerY, zoom>0, gridStepMm>0». Сохранить отдельный v2 validator для миграции; повторить графовые ограничения T049 без округления конечных чисел.
- [X] T051 Определить DimensionConstraint/Measurement/PendingEdit/ConfirmedRoom/RoomRecord в `backend/geometry/graph_models.py` и `frontend/src/domain/plan/types.ts`: kinds segmentLength/chainLength/angle/orientation/legacyUnbound, «sector: cw/ccw», «value в (0,360), ручное 180 запрещено», orientation «modulo 360», «На одном target/kind/sector — одно условие»; chainLength «range=null» либо «range:{startVertexId,endVertexId}» непрерывного упорядоченного диапазона. Nullable `value|null`, `topologyKey|null`, `acknowledgment|null`, `confirmed|null`, `pendingEdit|null`, `restorePoint|null`; binding attached/detached, source entered/derived; positive длины для решения, неверные конечные значения допустимы в draft. LegacyUnbound — только миграция; поля и ссылки всех снимков по data-model.md.
- [X] T052 Реализовать независимый read-only validator в `backend/geometry/graph_validation.py`: нулевые/дублированные/накладывающиеся/ненодированные стены, порядок и прямолинейность цепей, fixed ≤0,1 мм/°, void containment/касания; invalid draft не исправлять, не путать структурный 422 с геометрической диагностикой.
- [X] T053 Извлекать FaceCandidate через polygonize_full в `backend/geometry/faces.py`: ограниченные области и interior rings, void исключён из выбора, вложенный неотмеченный контур даёт внутреннюю комнату; cuts/dangles не вычитают площадь; дефектный компонент нельзя отбросить ради готовности затронутой комнаты.
- [X] T054 Ввести канонические topology/dependency/geometry/measurement keys и транзитивную область влияния в `backend/geometry/faces.py`, `frontend/src/domain/project/keys.ts`: сворачивать последовательные направленные chainId, сортировать holes, не включать координаты в identity; Issue «scope:global|component|room», affectedRoomKeys; измерения сортировать по key, «отображаемая точность 0,1», dependencyKey хранит точные данные; независимый чужой draft не блокирует выбранную область. Fixed-условия расширяют зависимость до неподвижной точки; dependencyKey включает «все сохранённые условия на вошедших targets, включая fixed=false».
- [X] T055 Добавить `/api/plan/validate` в `backend/geometry/graph_routes.py` и подключить в `backend/main.py`: request/response из contracts/geometry-api.md, status valid/invalid/unresolved; «Файл/запрос ≤2 МиБ», JSON 413/422/500, без пустых успешных ответов. Сохранить `/api/geometry/*`, `/api/layout`, `/api/optimize` и текущий planner.
- [X] T056 Расширить `frontend/src/api.ts`, `frontend/src/domain/project/requests.ts` типизированными validate/command запросами и строгой проверкой ответов; читать text перед JSON, обрабатывать пустой/HTML/оборванный ответ; проверять projectId, requestId/commandId, draftRevision, basisKey и поколение независимо от Abort. Command-клиент до US2 не вызывать.

## Phase 3: US1 — Пройти проект по четырём этапам (P1, MVP)

Единая сцена и меню, выбор готового помещения, сохранение v3 и совместимость старых проектов. Независимая поставка использует валидный fixture/мигрированный план; создание графа — US2, solver новых размеров — US3. Сохранить работающие старые действия расчёта через адаптер до расширения US5.

**Независимая проверка**: На готовом плане пройти четыре этапа и назад; формы неактивных этапов отсутствуют. Выбрать одну из двух комнат, reload/JSON round-trip сохраняет параметры, чужая открытая линия не мешает. G05/G06/G10/G11/G14 и E01/E07–E09/E12.
- [X] T057 [P] [US1] Добавить короткие e2e оболочки, выбора комнаты, этапов и независимости ошибок в `frontend/tests/project-stages.spec.ts`; готовые v3 fixtures, G05/G06/G14; действия графа, ещё отсутствующие до US2, представить отдельным импортом следующего состояния, не считать это проверкой инструментов.
- [X] T058 [P] [US1] Добавить браузерные e2e v2→v3/legacy, pending retry/cancel, round-trip, локальных ревизий, quota и двух вкладок в `frontend/tests/project-document.spec.ts` (G10/G11); повреждённый v3 при наличии v2 не вызывает fallback; каждый случай ≤15 с.
- [X] T059 [US1] Реализовать RoomRecord binding в `frontend/src/domain/plan/rooms.ts`: точный единственный topologyKey сохраняет roomId; split/merge оставляет detached и снимает selection; новая запись получает «600/2/10/100/0» для tile/grout/gap/threshold/angle, без наследования настроек; fields/confirmed старых записей не удалять.
- [X] T060 [US1] Реализовать reducer v3 в `frontend/src/domain/project/state.ts` и guards в `frontend/src/domain/project/guards.ts`: plan/rooms/selectedRoomId, раздельные draft/confirmed, keys вместо общей ревизии для roomReady; pending неизвестного влияния закрывает confirm/export до ответа; запросы не меняют другой проект/комнату; reload variants → rules только при готовых входах. Разделить runtime exportSuspended (влияние ещё неизвестно) и stale (доказано изменение зависимых входов); неизменный dependencyKey снимает только временную приостановку экспорта.
- [X] T061 [US1] Преобразовать каждый v2 снимок отдельно в `frontend/src/domain/project/migration.ts`: сохранить IDs/координаты/fixed/raw поля/holes, детерминированные chainId, angle с правильным сектором и legacyUnbound; старый ack сначала проверить старыми ключами, затем пересчитать, не создавать согласие; старый неполный контур не замыкать. Старый код проверки выделить в `frontend/src/domain/project/legacy-v2.ts`. Различить legacy без условий (Объект и проверка) и v2 (сохранить действительное ack/fixed и последний доступный этап по FR-026).
- [X] T062 [US1] Добавить legacyV2 retry/cancel в `frontend/src/domain/project/requests.ts`, `frontend/src/domain/project/state.ts`: точные legacyOperation/basis/draft, без autoplay при reload; повтор старым endpoint → преобразование → graph validate под одним токеном; отмена восстанавливает basis с возрастающей draftRevision и актуальным targetDraftRevision. Незавершённый legacyPending нельзя молча заменить graph-командой: сначала явный retry/cancel.
- [X] T063 [US1] Обновить `frontend/src/domain/project/storage.ts`, `frontend/src/Projects.tsx`: async bootstrap под Web Lock `plitka-projects-write`, ключ `plitka-projects-v3` с `{schemaVersion:3,projects:ProjectDocument[]}`, v2/v1 backup не удалять; автоматическая миграция сохраняет documentRevision, обычная запись r+1 после свежей проверки; quota/старые v2 вкладки/конфликт не теряют копию в памяти; без Locks явно ограничить работу одной вкладкой.
- [X] T064 [US1] Обновить `frontend/src/domain/project/import-export.ts`: envelope `{format:"plitka-project",version:3,project}` ≤2 МиБ, полная структурная проверка каждого снимка; предпросмотр, новый локальный id/revision=0 при создании, текущий id/r+1 при замене и проверка конфликта; v2/legacy адаптеры; runtime results/Undo исключить, pending и detached сохранить.
- [X] T065 [US1] Создать постоянный `frontend/src/components/canvas/ProjectCanvas.tsx`, `frontend/src/components/canvas/CanvasMenus.tsx`, подключить в `frontend/src/components/workflow/ProjectWorkflow.tsx`: одно SVG на четыре этапа, metadata/save/import/errors в HTML overlays; верхняя навигация, desktop инспектор и мобильная закрываемая панель, поля только активного этапа; список проектов остаётся отдельным экраном.
- [X] T066 [US1] Подключить выбор FaceCandidate и подсветку через `frontend/src/components/canvas/RoomPicker.tsx`, `frontend/src/components/workflow/StepNav.tsx`: явный выбор на полотне/клавиатурным списком, неоднозначная граница не выбирается случайно; готовый fixture проходит четыре этапа через существующие компоненты и `frontend/src/domain/project/layout-request.ts` с confirmed выбранной комнаты.
- [X] T067 [US1] Встроить целиковое восстановление restorePoint и скачивание ошибочного draft в `frontend/src/components/canvas/CanvasMenus.tsx`, `frontend/src/domain/project/state.ts`: предпросмотр затронутых соседних комнат, bindings/guards пересчитать, RoomRecord настройки оставить; при отсутствии restorePoint отдельная подтверждаемая очистка; прогнать только US1 e2e в `frontend/tests/project-stages.spec.ts`, `frontend/tests/project-document.spec.ts`.

## Phase 4: US2 — Создать план помещений из вершин и стен на сетке (P1)

Независимые точки и явные стены, T/X-сочленения, открытый черновик и адресная диагностика. Зависит от US1 оболочки и сохранения.

**Независимая проверка**: В замкнутом плане добавить три независимые вершины, соединить произвольные пары и присоединить стену к стене, проверить общие ID, Undo и reload без настройки плитки. G01–G03/G06/G07/G13.
- [X] T068 [P] [US2] Добавить e2e добавления на закрытом плане, произвольных соединений, T/X/нескольких пересечений, повторного commandId и Undo в `frontend/tests/room-editor.spec.ts`; G01–G03, positive через реальный backend.
- [X] T069 [P] [US2] Добавить e2e меню без click-through, keyboard/touch, pointer cancel/drag и масштабов hit-target в `frontend/tests/project-stages.spec.ts`; G13, отдельные случаи 375/1440 px.
- [X] T070 [US2] Реализовать транзакцию connect/split в `backend/geometry/topology.py`: сбор всех пересечений, epsilon 1e-7 мм только для вычисленной топологии, reuse существующих узлов, deterministic child IDs и splitMap; сохранить chain endpoints/направление/void refs/угловые ссылки, segmentLength переносить в chainLength range с прежним ID/value. Наложение/ноль/дубликат отклоняют всю команду.
- [X] T071 [US2] Реализовать addVertex/connect/moveVertex/deleteElements/markVoid/unmarkVoid/addTemplate в `backend/geometry/graph_commands.py`: шаблоны rectangle/lShape добавляют граф через общую транзакцию, move не создаёт скрытые пересечения; до solver US3 недопустимую правку fixed возвращать unresolved/invalid с basis; удаление требует acknowledgedConstraintIds, разорванные цепи пересоздаются явно.
- [X] T072 [US2] Добавить `/api/plan/command` в `backend/geometry/graph_routes.py`: basis+commandId → applied/invalid/unresolved, graph/splitMap/addedIds/removedIds/affectedChainIds/faces/measurements/issues; повтор детерминирован, отказ структурной/move команды возвращает безопасный basis и intent; отказ dimension-команды сохраняет прежние координаты со всем обновлённым набором draft.constraints; параметры размеров подключаются в US3, до этого UI их не отправляет.
- [X] T073 [US2] Реализовать pending graphV3 и atomic apply в `frontend/src/domain/plan/commands.ts`, `frontend/src/domain/project/state.ts`: autosave intent перед сетью, одно завершённое действие на connect со всеми split; проверять токен, retry с тем же basis/commandId, новое намерение с новым ID; history в `frontend/src/domain/plan/history.ts` — «минимум 20 полных состояний» только runtime, после reload cancel через basis. Все введённые условия хранить в draft.constraints отдельно от pending; basis следующей dimension-команды содержит предыдущий конфликт; отмена возвращает предыдущее состояние целиком. Структурный/move/legacy pending требует retry/cancel до другого геометрического действия. Dimension-команды: setLength/setAngle/setOrientation/releaseConstraint; reconcile повторяет решение набора без изменения условий с теми же правилами pending. Preview координат/связей — только runtime. При актуальном ответе сохранить текущие draft.fieldInputs вместо старого текста из серверного basis; cancel возвращает fieldInputs из basis. Успешный Undo — в памяти, после reload доступна отмена сохранённого pending, без восстановления полной истории.
- [X] T074 [US2] Реализовать tool/gesture state machine в `frontend/src/domain/plan/tools.ts` и `frontend/src/components/canvas/ToolPalette.tsx`: select/addVertex/connect/move/pan/selectRoom; добавление независимо от closed, после connect очистить начало без смены инструмента; Escape/pointerCancel/смена инструмента отменяют preview, не завершённую геометрию.
- [X] T075 [US2] Подключить pointer-up commit, SVG inverse matrix, capture и composedPath в `frontend/src/components/canvas/ProjectCanvas.tsx`; reuse `frontend/src/domain/room/snapping.ts`, `frontend/src/domain/room/viewport.ts`: 8 CSS px mouse, 12 touch/pen, vertex перед линией, вертикальная при равенстве; connect vertex перед wall projection; numeric без snapping, no click после drag/через overlay, нет запросов на pointermove.
- [X] T076 [US2] Заменить ordered-contour UI в `frontend/src/components/workflow/ObjectStep.tsx` на `frontend/src/components/canvas/GeometryInspector.tsx`: числовые точки, списки концов для соединения, templates/void/delete с preview затронутых условий, выбор ошибки и фокус на элемент; обновить bindings после split, подписи/узлы постоянного экранного размера.
- [X] T077 [US2] Довести G01–G03/G06/G07/G13 в `frontend/tests/room-editor.spec.ts`, `frontend/tests/project-stages.spec.ts` до успеха; дополнить `frontend/tests/project-document.spec.ts` reload открытого графа и атомарных сочленений; убедиться, что реальный редактор выполняет операции, ранее проверенные US1 fixture-переходами.

## Phase 5: US3 — Задать действительные размеры и углы (P1)

Точные длины цепей/участков и пары лучей; solver не ослабляет ручные условия, acknowledgment отделён от подтверждения комнаты.

**Независимая проверка**: 4000=1500+2500 после split/re-split, конфликт сохраняет ввод; прямоугольник 4200×3600 и параллелограмм 4000×3000 60°/120° дают ожидаемые размеры/площади, zoom их не меняет. G04/G08/G09/G14.
- [X] T078 [P] [US3] Добавить короткие e2e общего замера/re-split диапазона, конфликтов, смены длины 3000→3500 с опорой, секторов/270° и derived ack в `frontend/tests/room-editor.spec.ts`; реальный backend, G04/G08/G09, измерения с допуском 0,1. Добавить пары 3175,5/3175.5 мм и 60,5/60.5°: одинаковые значения, сохранение и отсутствие привязки к сетке. После успеха solve проверить, что raw «3175,5» остался в поле, а числовое значение равно 3175.5; аналогично для угла.
- [X] T079 [P] [US3] Добавить e2e сохранения range/fixed/ack, отмены конфликтного pending и влияния общих условий на две комнаты в `frontend/tests/project-document.spec.ts`; G10/G14, независимый компонент не блокирует. Добавить конфликт 4300/4200 → исправление другой стены на 4300 → reload, плюс отдельную отмену второй правки после reload с восстановлением конфликта 4300/4200: задержать её ответ и сохранить pending до reload. Успешный Undo проверять отдельно без reload; добавить исправление через releaseConstraint и reconcile.
- [X] T080 [US3] Реализовать графовый solve в `backend/geometry/graph_solver.py`: прямые построения/опоры, транзитивная система общих узлов и цепей, ordered t между концами, chain/range/segment lengths и ориентированные углы; одна TRF linear-loss попытка max_nfev=200, внутренняя цель 0,0001; fixed не ослаблять, известный конфликт отличать от unresolved.
- [X] T081 [US3] Подключить setLength/setAngle/setOrientation/releaseConstraint/reconcile в `backend/geometry/graph_commands.py`, `backend/geometry/graph_validation.py`: после solve независимо проверить все fixed ≤0,1, порядок/прямолинейность и топологию; move использует solver; исходное начало и направление свободной стены сохраняются; не выполнять авто-noding из solve. Для всех dimension-команд, включая releaseConstraint, отказ сохраняет полный обновлённый набор условий с прежними координатами; reconcile не меняет значения или фиксации.
- [X] T082 [US3] Реализовать `frontend/src/domain/plan/measurements.ts`, `frontend/src/components/canvas/DimensionInspector.tsx`: entered/derived, общая цепь/диапазон/участок раздельно, release fixed; пары лучей+сектор+дуга; 180° derived без удаления узла, raw неверное число не превращается в NaN/0; конфликт показывает сохранённое намерение. Переиспользовать общий frontend/src/components/workflow/NumberField.tsx для длины и угла, поддержать точку/запятую и точность ввода 0,1. Актуальный ответ не заменяет применённую строку прежним текстом; cancel восстанавливает строку до действия, включая ошибочный ввод.
- [X] T083 [US3] Подключить явный acknowledgment и ConfirmedRoom в `frontend/src/domain/project/state.ts`, `frontend/src/domain/project/guards.ts`, `frontend/src/components/canvas/DimensionInspector.tsx`: показать derived выбранной границы/voids/зависимых общих стен; deep copy замкнутых по ссылкам зависимостей; новые измерения после split требуют согласия, reload неизменного сохраняет его; сохранить whole-plan restorePoint.
- [X] T084 [US3] Довести контрольные G04/G08/G09/G14 в `frontend/tests/room-editor.spec.ts`, `frontend/tests/project-document.spec.ts` до успеха: 15,12 м² и 10,392305±0,001 м², fixed ≤0,1; unresolved не заменяет успех простых фигур; не расширять допуски.

## Phase 6: US4 — Настроить материал и правила отдельно (P2)

Параметры принадлежат выбранной комнате и доступны только в меню своего этапа.

**Независимая проверка**: На готовом помещении изменить tile/grout, затем gap/threshold/angle; неверный текст сохраняется, параметры соседней комнаты неизменны, уничтожающий область gap обрабатывается при явном подборе.
- [X] T085 [US4] Добавить короткие e2e независимых параметров двух комнат, raw ошибок, скрытых форм и inset failure в `frontend/tests/project-stages.spec.ts` (G05, E15); использовать готовые confirmed fixtures.
- [X] T086 [US4] Вынести комнатные поля в `frontend/src/components/workflow/TileStep.tsx`, `frontend/src/components/workflow/RulesStep.tsx`, `frontend/src/components/workflow/NumberField.tsx`: «tile 50–2000, grout 0–20», «gap 0–100, threshold 1–1000, angle ≥0 и <90»; Enter/blur сохраняет неверный текст с aria-describedby, на полотне видны поля лишь текущего этапа.
- [X] T087 [US4] Обновить `frontend/src/domain/project/guards.ts`, `frontend/src/domain/project/layout-request.ts`: только confirmed выбранной комнаты, outline/holes по 3–100 вершин и ≤20 holes, не округлять мм; материал/правила инвалидируют лишь соответствующий результат; область после gap и «лимит 1600 ячеек» проверяются сервером при явном запросе, ошибка оставляет Rules и ввод.
- [X] T088 [US4] Довести US4 e2e в `frontend/tests/project-stages.spec.ts`, `frontend/tests/planner.spec.ts` до успеха: переходы и исправление ошибки, запрос получает значения выбранной комнаты и повтор после inset failure работает.

## Phase 7: US5 — Получить актуальные варианты и вернуться к настройке (P2)

Раскладка выбранного помещения, защита от старых ответов, ручной сдвиг и экспорт внутри полотна.

**Независимая проверка**: Подбор → варианты → сдвиг/закрепление/экспорт; смена комнаты/размеров и отложенный ответ не подменяют актуальные данные. Пустой ответ даёт ошибку и повтор, не пустой экран.
- [X] T089 [P] [US5] Добавить e2e задержанных optimize/layout/geometry, смены room/project/stage, пустого/HTML/оборванного ответа и retry в `frontend/tests/planner.spec.ts` (G12); проверить отсутствие автоперехода после «Назад». Добавить снятие fixed без изменения координат: старый ответ отклонён, повторное подтверждение не оживляет результат, новый подбор разрешает экспорт. Отдельно проверить: Undo либо возврат прежнего ключа не снимает stale, а правка независимого компонента после validate снимает exportSuspended без требования нового подбора неизменной комнаты.
- [X] T090 [P] [US5] Добавить e2e accepted/pending shift, SVG/CSV и неизменности координат/метрик при zoom 50/100/200% и 375/1440 px в `frontend/tests/project-stages.spec.ts`; небольшая раскладка, G09, без измерения времени.
- [X] T091 [US5] Обновить `frontend/src/domain/project/results.ts`, `frontend/src/domain/project/requests.ts`, `frontend/src/domain/project/keys.ts`: ResultSet по roomId/inputKey, token projectId+roomId+operationId+generation+inputKey; проверка актуальности важнее Abort, смена комнаты отменяет ожидающее, metadata/viewport не инвалидируют; reload не восстанавливает варианты. inputKey включает confirmed dependencyKey с kind/target/value/fixed; изменение условия сразу инвалидирует результат и поколение, устаревание снимает только новый успешный подбор. В runtime ResultSet добавить «stale:boolean»; exportSuspended хранить отдельно. Повторное подтверждение, совпадение прежнего ключа и Undo не снимают stale; только новый успешный optimize. При прежнем dependencyKey после независимой правки снять лишь exportSuspended.
- [X] T092 [US5] Встроить метрики/альтернативы/детали/сдвиг/закрепление в `frontend/src/components/workflow/VariantsStep.tsx`, `frontend/src/components/canvas/CanvasMenus.tsx`: постоянная сцена, чужие результаты не показаны, accepted отдельно от pending, offset ±100000; ошибка shift запрещает экспорт до успешного повтора/отмены.
- [X] T093 [US5] Обновить `frontend/src/domain/project/result-export.ts`: SVG/CSV строго из актуального acceptedPlacement выбранной комнаты; JSON остаётся полным v3 без результатов; довести G12/E10/E11/E14 в `frontend/tests/planner.spec.ts`, `frontend/tests/project-stages.spec.ts` до успеха. Экспорт закрыт при stale, exportSuspended либо неуспешном pendingPlacement, даже если сохранён acceptedPlacement.

## Phase 8: Polish & Cross-Cutting

Завершить доступность и проверить весь согласованный объём без performance-наборов.
- [X] T094 Завершить keyboard/touch/focus в `frontend/src/components/canvas/CanvasMenus.tsx`, `frontend/src/components/canvas/ToolPalette.tsx`, `frontend/src/components/canvas/GeometryInspector.tsx`: aria-pressed, возврат фокуса, focus не перекрыт, modal import trap и немодальный inspector без trap, reduced-motion, ошибки текстом; G13 на 375/1440 без горизонтального scroll.
- [X] T095 Перенести применимые E01–E15 в `frontend/tests/projects.spec.ts`, `frontend/tests/planner.spec.ts`, `frontend/tests/project-stages.spec.ts`, `frontend/tests/room-editor.spec.ts`, `frontend/tests/project-document.spec.ts`: заменить старое обязательное замыкание всего draft выбранной областью, проверить все G01–G14, сохранить защиту пустого JSON; не дублировать уже покрытые сценарии.
- [X] T096 Проверить команды `frontend/package.json`, `frontend/playwright.config.ts`, затем выполнить build/typecheck и только пять файлов быстрых e2e из `specs/001-project-stages/quickstart.md`; устранить выявленные сбои, повторять только затронутое после исправлений; никакого pytest/performance/нагрузки/benchmark.
- [X] T097 Записать фактические результаты/ограничения среды в `specs/001-project-stages/quickstart.md`, сверить реализацию с `specs/001-project-stages/contracts/`, отметить только реально выполненные задачи в `specs/001-project-stages/tasks.md`; исторические результаты v2 не выдавать за проверки графового редактора.

## Dependencies & Execution Order

```text
Setup T047–T048
  → Foundation T049–T056
  → US1 T057–T067 (готовая геометрия, MVP оболочки/сохранения)
  → US2 T068–T077 (инструменты графа)
  → US3 T078–T084 (точные размеры)
  → US4 T085–T088 (плитка/правила)
  → US5 T089–T093 (актуальные результаты)
  → Polish T094–T097
```

US1 опирается на Foundation validate/faces и существующий planner через адаптер: не ждёт новых graph commands/solver. US2 использует US1 canvas/storage; US3 — US2 provenance/commands. US4 можно готовить после US1 на confirmed fixtures независимо от US2/US3, но объединять изменения guards/layout-request последовательно. US5 требует US1 и US4 для сквозного сценария; интеграцию с изменением настоящих размеров проверять после US3. Независимая проверка истории означает собственный законченный сценарий на выполненных предпосылках, а не отсутствие общих зависимостей.

В каждой фазе тесты пишутся первыми, затем реализация в порядке задач. Положительные e2e не подменяют геометрический ответ. Модели → проверка/сервисы → routes → клиент/меню → проверка истории. Миграция не зависит от нового solver: legacyPending повторяет старый endpoint, затем выполняет новый validate.

## Parallel execution examples

Параллелить можно подготовку кода/тестов, но исполнение e2e всегда с одним worker. Общие файлы не редактировать одновременно.

| Группа | Пример независимой работы | Предпосылки |
| --- | --- | --- |
| Foundation | T049 backend схемы + T050 frontend схемы | Setup; оба используют зафиксированный data-model; T051 только после обоих |
| US1 | T057 stage e2e + T058 document e2e | Foundation и fixtures |
| US2 | T068 graph e2e + T069 interaction e2e | US1 |
| US3 | T078 dimension e2e + T079 persistence e2e | US2 |
| US4 | T085 stage e2e одновременно с backend T070–T072 US2 | После US1 и завершения T069; разные файлы, общий backend не запускать в изменяемом состоянии |
| US5 | T089 API race e2e + T090 placement e2e | US4 |

Внутри US4 безопасной параллельной пары нет: T085→T086→T087→T088 последовательны. Возможность в таблице относится только к подготовке US4 рядом с backend-работой US2. Ни одна возможность не требует запуска дополнительных агентов.

## Implementation strategy

1. MVP: Setup + Foundation + US1. Демонстрация четырёх меню на постоянном полотне, выбора готовой комнаты и безопасного v3/legacy сохранения. Это ещё не исправление инструмента добавления вершин.
2. Первый законченный редактор: добавить US2; проверить G01–G03 на существующем замкнутом плане. Этот инкремент устраняет исходный дефект пользователя.
3. Точные замеры: US3, включая обязательное 4000=1500+2500 и повторный split; не объявлять измеряемый редактор готовым без него.
4. Завершить US4/US5 и сквозные проверки. Не выполнять деплой/публикацию как часть этих задач.

## Coverage / completion criteria

| История | Требования | Короткие проверки |
| --- | --- | --- |
| US1 | FR-001–004, FR-026–028, FR-032; миграция и guards | G05/G06/G10/G11/G14, E01/E07–E09/E12 |
| US2 | FR-005–008, FR-014–015, FR-030–031 | G01–G03/G06/G07/G13 |
| US3 | FR-009–013, FR-016–018, FR-033 | G04/G08/G09/G14, E02–E06/E08 |
| US4 | FR-019–021 | G05, E15 |
| US5 | FR-022–025, FR-028, SC-003 | G09/G12, E10/E11/E14 |
| Общие | FR-027, FR-029; все SC | G13, build + ограниченный полный e2e набор |

Статусы ниже обновлены по фактической реализации и быстрым e2e. Запрет performance-тестов действует на каждый этап, в том числе на повторные проверки.

**Сводка генерации**: 51 новая задача: Setup 2, Foundation 8, US1 11, US2 10, US3 7, US4 4, US5 5, Polish 4. Десять задач отмечены [P], образуют пять независимых пар. Исторические 46 задач находятся только в архиве.

## Проверки уточнённого плана

| Решение | Реализация | Независимая быстрая проверка |
| --- | --- | --- |
| Полный набор конфликтующих условий отдельно от pending | T073, T081 | T079: исправление другого размера, reload и cancel сохранённого pending |
| Raw-текст не откатывается ответом | T073, T082 | T078: 3175,5/60,5 после успешного solve |
| releaseConstraint/reconcile исправляют весь набор | T073, T081 | T079: снять условие, повторить решение |
| Ключ учитывает fixed=false на зависимых targets | T054, T091 | T089: фиксация меняется без движения стен |
| stale и временная приостановка различаются | T060, T091, T093 | T089: зависимая/независимая правка, Undo и новый подбор |
| Legacy и v2 сохраняют разные правила согласия | T061–T064 | T058: legacy → объект; валидный v2 → доступный этап |

Число задач и зависимости фаз сохранены. Дополнения T073 описывают общий механизм; размерные операции подключаются T081 в US3, их полные положительные e2e выполняются T084. Предыдущий pending не означает сериализацию истории успешных Undo.

## Реализация v3 — расположение кода

Для совместимости старые v2 schema/solver/UI не перезаписаны: миграция и повтор legacyPending используют прежний контракт. Новые schema, migration, storage, guards/keys/bindings и состояние находятся в `frontend/src/domain/plan/{schema,migration,storage,rooms,useGraphProject}.ts`; проверка прежнего acknowledgment выделена в `domain/project/legacy-v2.ts`. `useGraphProject` содержит очередь сохранений, поколения запросов, pending и историю 20 состояний. Новая оболочка `components/canvas/GraphWorkflow.tsx` объединяет меню четырёх этапов; `ProjectCanvas`, `ToolPalette`, `DimensionOverlay` отделены, числовые поля переиспользуют `workflow/NumberField`. Projects подключает эту оболочку непосредственно. Это уточнение физического размещения файлов сохраняет описанные выше обязанности и контракты.

Выполненные T048–T094 проверены реальным FastAPI через быстрые Chromium e2e: полный запуск 57 сценариев прошёл, затем добавлены адресные проверки независимого pending и открытого v2. Итоговый запуск/результаты фиксируются в quickstart по T096–T097. Performance/pytest/unit/benchmark не запускались.

**Итог реализации**: T047–T097 выполнены (51/51). Проверки: build/typecheck, полный набор 61 e2e и адресный запуск 3 e2e после последнего исправления; 62 уникальных сценария в текущем наборе. Фактические команды, результаты и ограничения — в quickstart.md. Post-implementation hooks отсутствуют.
