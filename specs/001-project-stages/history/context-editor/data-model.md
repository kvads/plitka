# Data model: контекстное редактирование, удаление и очистка

Дата: 2026-10-12. Основа — реализованные GraphSnapshot/ProjectDocumentV3 в `frontend/src/domain/plan/types.ts` и `backend/geometry/graph_models.py`. Версии не меняются. Прежние подробные сущности: [архив модели](history/vertex-safety/data-model.md). Ниже полный перечень изменений и связанных инвариантов.

## Сохраняемые сущности

| Сущность | Поля/связи | Правила нового инкремента |
| --- | --- | --- |
| GraphSnapshot | vertices, segments, chains, voids, constraints, fieldInputs | Пустой снимок допустим. При удалении нет висячих ссылок; новый кандидат не создаёт совпадающих координат |
| Vertex | id, x, y в мм | Меняется на полотне; selected X/Y UI отсутствует. При удалении комнаты убираются только осиротевшие концы её границы |
| Segment | id, startVertexId, endVertexId, chainId | Общий сегмент принадлежит границам нескольких комнат, но хранится один раз. Удаление комнаты удаляет и общий сегмент |
| WallChain | id, start/endVertexId, упорядоченные segmentIds | При удалении части цепи её остатки становятся самостоятельными непрерывными цепями. Полный старый размер не переносится на остаток |
| Void | id, boundary: DirectedSegmentRef[] | Физическое удаление — граница с каскадом; снятие роли — только запись. Потерявшая участок запись удаляется целиком |
| DimensionConstraint | id, kind, target, value, fixed | Удаление записи отдельно от fixed=false. Удаление не двигает координаты; очистить её raw fields |
| RoomRecord | id, topologyKey, binding, name, material, rules, fieldInputs, acknowledgment, confirmed | Целевая комната deleteRoom удаляется; исчезнувшие соседние сохраняются detached. Clear удаляет все, включая detached |
| ConfirmedRoom | graph, boundary, topologyKey, dependency/geometry/measurementKey, acknowledgment, sourceDraftRevision | Исторический снимок не становится актуальным при утрате зависимости. Clear удаляет вместе с RoomRecord; Undo clear восстанавливает исходный снимок, но не результаты |
| ProjectDocumentV3 | schemaVersion, id/name/address, documentRevision, plan, rooms, selectedRoomId, workflow, viewport | Clear сохраняет только идентичность/метаданные и техническую непрерывность ревизий; остальные рабочие данные сбрасываются |

Существующие координаты, введённые значения, десятичный raw текст и отдельные исторические снимки не нормализуются при чтении. Ограничения графа прежние: до 2100 вершин, 6300 сегментов/цепей, 12600 условий, 20 voids; файл/запрос до 2 МиБ. Для тестов предельные планы не создаются.

## Расширение команды и pending

Новые command variants:
- deleteRoom: topologyKey, impactKey.
- deleteVoid: voidId, impactKey.
- deleteConstraint: constraintId.

`GraphPending` остаётся `{kind:"graphV3", commandId, command, basisGraph, targetDraftRevision}`; `LegacyPending` сохраняет существующий tagged union. Схемы чтения/экспорта/повтора должны знать новые варианты. Preview и подтверждение не сериализуются отдельно: impactKey находится в сохранённой команде и проверяется сервером относительно её basis. Повтор неизменного pending допустим; изменение basis требует нового preview. Reload никогда автоматически не запускает pending.

deleteConstraint не является solver-редактированием: удаление не применяется оптимистически как applyCondition; успешный graph устанавливается после ответа. Прежние conflict raw fields остальных условий сохраняются.

## Runtime EditorContext

Один discriminated union вместо независимых vertex/segment/second/sector flags:
```ts
type EditorContext =
  | {kind: "none"}
  | {kind: "project"}
  | {kind: "tool"; tool: Tool}
  | {kind: "vertex"; id: string}
  | {kind: "segment"; id: string}
  | {kind: "range"; chainId: string; startVertexId: string;
     endVertexId: string; constraintId?: string}
  | {kind: "room"; roomId: string; topologyKey: string}
  | {kind: "void"; id: string}
  | {kind: "constraint"; id: string}
  | {kind: "angle"; vertexId: string; firstSegmentId: string;
     secondSegmentId: string; sector: "cw" | "ccw"; constraintId?: string};
```

Выбранное помещение расчёта `selectedRoomId` независимо от EditorContext. Выбор стены скрывает комнатное меню, не удаляя её материал/правила. Context не сериализуется. Отображается одна контекстная панель; project menu, confirmation dialog и stage panel также взаимоисключаются по активной поверхности.

## Runtime ToolInteraction

```ts
type ToolInteraction =
  | {kind: "idle"}
  | {kind: "connect"; firstVertexId: string | null}
  | {kind: "rangeFirst"; chainId: string}
  | {kind: "rangeSecond"; chainId: string; firstVertexId: string}
  | {kind: "angleFirst"}
  | {kind: "angleSecond"; firstSegmentId: string}
  | {kind: "angleSector"; vertexId: string;
     firstSegmentId: string; secondSegmentId: string}
  | {kind: "move"; vertexId: string; origin: Point; preview: Point}
  | {kind: "placeVertex"; cursor: Point};
```

Выбор диапазона запускается действием «Выбрать диапазон» из контекста участка и сохраняет его chainId. rangeFirst ожидает первый узел этой цепи; rangeSecond хранит первый и ожидает другой узел той же цепи. Чужой/повторный узел отклоняется, первый выбор сохраняется. После пары ToolInteraction становится idle, а контекст range хранит startVertexId/endVertexId в порядке обхода chain.segmentIds, независимо от порядка кликов; выбранные концы и непрерывный диапазон подсвечиваются. Только тогда доступно поле длины. Это существующий chainLength.target.range, не новая сохраняемая сущность или версия файла; числовое значение должно быть положительным. Повторное редактирование того же диапазона использует существующий constraintId: искать kind=chainLength, chainId и оба канонических конца независимо от fixed. Условие полной цепи без range — отдельная цель. Длина равна сумме непрерывного среза segmentIds; при изменении длины закрепляется каноническое начало диапазона. Упорядочивание проверяет реальные ссылки текущего графа и не сортирует ID или экранные координаты.

Выбор концов не меняет graph, pending или history. Escape до применения числа закрывает этот временный контекст, смена инструмента переключает контекст инструмента; geometry остаётся прежней. После принятого изменения графа исходная цепь должна существовать, а выбранные концы — оставаться разными её узлами в непрерывном диапазоне; при нарушении сбрасываются rangeFirst/rangeSecond/range context, закрывается меню и восстанавливается доступный фокус. При неизменной цепи дополнительный split между концами не меняет диапазон. После применения длины используется обычный Undo.

Первый выбор стены не меняет graph. Вторая должна быть другой и иметь ровно один общий узел; невалидный выбор сохраняет первую и объясняет ошибку. Только выбор дуги создаёт angle context с числовым полем. Выбор одной из дуг/подсветка тоже не является сохранённым изменением. Enter/blur применяет допустимое число через существующий numeric input и setAngle; одна правка — одна операция. Допустимый ручной угол строго между 0° и 360°, кроме 180°; 0°/180°/360° не принимаются как допустимое условие и не меняют координаты. Вычисленный 180° остаётся derived без новой фиксации. Ошибочный raw/намерение сохраняются по прежним правилам черновика, не объявляются подтверждённой геометрией.

Escape или смена инструмента сбрасывают незавершённое взаимодействие без сохранения/Undo. После любого принятого перехода документа — успешной команды, обычного Undo, восстановления или подтверждённого импорта — одновременно сверяются ссылки context/interaction/keyboard focus/diagnostic selection с новым графом и гранями. Проверяются принадлежность диапазона цепи и существование его концов; валидный дополнительный split внутри диапазона сохраняет контекст. Утраченные ссылки очищаются до показа принятого результата. Refusal оставляет context и объяснение. При clear/Undo clear все transient состояния сбрасываются независимо от восстановленных ID.

## Runtime KeyboardCanvasState

Поля: activeTarget (vertex/segment/room/void/constraint/range/arc либо null), cursor (world Point), режим navigation/placement/movePreview. Геометрические targets имеют видимую подсветку и доступные названия. Один roving tab stop; Tab выходит из полотна. Стрелки перебирают targets в стабильном порядке среди подходящих инструменту. В режиме курсора/перемещения стрелки меняют preview с шагом сетки, Shift — 1 мм, Enter завершает действие. Для rangeFirst/rangeSecond клавиатурные targets — узлы выбранной цепи; Enter/Space выбирает конец, после полной пары Tab ведёт к полю длины. Метка готового диапазона доступна как range target с chainId и двумя концами. Фокус и координаты курсора не сохраняются в документе. Переключение режима явно объявляется подсказкой; ввод текста не перехватывается.

## Runtime DeletionPreview

Цель room(topologyKey) или void(voidId), requestId, projectId, lifecycleEpoch, draftRevision, basisKey, status, impact либо issues. Impact содержит impactKey и списки удаляемых сегментов/вершин/retired chains/условий/voids, затронутых/исчезнувших topologyKey. Все массивы относятся к basis; display names определяются клиентом. Изменение basis/цели закрывает устаревшее подтверждение, не применяет удаление.

Pending preview не блокирует сохранение обычного документа, не создаёт Undo. При закрытии/отказе остаётся прежний объектный контекст. Во время отправленной команды повторное подтверждение блокируется. Результаты см. [API](contracts/geometry-api.md).

## Runtime ImportPreview

Чтение файла захватывает projectId, lifecycleEpoch, собственный requestId и текущую documentRevision. После await importV3 проверяются live owner, epoch и актуальный requestId до установки preview или ошибки; подтверждение дополнительно проверяет текущую локальную ревизию. Clear, Undo clear, закрытие проекта или новое чтение делают старый результат неактуальным. Обновление сохранённой ревизии не заменяет epoch. Кандидат файла и состояние чтения не входят в документ/Undo; пользователь подтверждает только актуальный preview.

## ClearProject transition

После отдельного подтверждения выполняется один hook-level переход:
1. Скопировать текущий полный документ в runtime history с kind=clearProject.
2. Повысить lifecycle/write epoch и поколения запросов синхронно; остановить runtime loading/preview/results, очистить меню и выделения.
3. Сохранить schemaVersion=3, id, name, address и текущую documentRevision. Присвоить draftRevision=предыдущая+1.
4. plan.draft=emptyGraph(), pendingEdit=null, restorePoint=null; rooms=[], selectedRoomId=null; requestedStage=object; viewport — текущие defaults нового проекта.
5. Установить новый документ в памяти и поставить одну актуальную запись в очередь сохранения. Ни validate старого графа, ни solver не нужны.

Фабрика очистки не вызывает создание нового проекта с новым ID/комнатой. Новые будущие комнаты используют стандартные defaults, а не сохранённые настройки удалённых комнат.

## SessionHistory и Undo clear

Runtime история ограничена прежними 20 действиями, содержит записи `{kind:"edit"|"clearProject", before:ProjectDocumentV3}`. Результаты, loading, DOM references и epochs туда не входят. Clear не очищает предыдущую историю: последующие правки отменяются прежде, затем одним Undo отменяется clear. Redo в объём не входит.

Undo clear повышает epoch снова, восстанавливает before с текущей documentRevision и новой draftRevision=current+1; targetDraftRevision восстановленного pending переназначается на новую ревизию. Поля basis/operation/raw исходного намерения не меняются. Pending не запускается; допускается новая read-only validate для диагностики. Workflow восстанавливается по guards: variants → rules, неготовый/зависимый pending → object. Рассчитанных вариантов нет, экспорт требует нового явного подбора.

Закрытие проекта/размонтирование или reload уничтожают историю. В очищенном сохранённом/экспортированном документе нет снимка before и прежнего restorePoint. После Undo восстановленный restorePoint допустим как часть исходных данных.

## Lifecycle и сохранение

SessionLifecycleEpoch — runtime монотонный счётчик, не documentRevision и не draftRevision. Все асинхронные callbacks, включая чтение импортируемого файла и публикацию его preview, сверяют его до любого изменения doc/results/error/loading. Текущий синхронный экспорт проверяет доступность актуального результата перед созданием файла; новых запросов для него не вводится. Undo никогда не уменьшает его.

QueuedWrite хранит snapshot и writeEpoch. Пропущенная superseded запись — отдельный исход от ошибки/успеха; она не создаёт «Сохранено». saveV3 проверяет актуальность под Web Lock непосредственно до CAS/setItem. Если старый snapshot уже записался, очередь принимает его новую ревизию, но не его payload. Следующий актуальный snapshot записывается с этой ревизией. Конфликт другой вкладки не снимается очисткой/Undo.

На ошибке сохранения документ остаётся в памяти, доступен для экспорта/разрешённого повтора и Undo; статус «Не сохранено». Гарантия состояния после reload действует только после успешного сохранения. Подробнее: [файл и storage](contracts/project-file.md).
