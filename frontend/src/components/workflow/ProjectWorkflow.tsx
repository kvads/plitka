import { measurements } from "../../domain/room/measurements";
import { useEffect, useReducer, useRef, useState } from "react";
import type { ProjectDocument, Stage } from "../../domain/project/schema";
import type {
  GeometrySnapshot,
  GeometryResponse,
  Operation,
  ValidationResult,
} from "../../domain/room/types";
import { documentReducer } from "../../domain/project/state";
import {
  geometryKey,
  acknowledgment,
  inputKey,
} from "../../domain/project/keys";
import {
  roomReady,
  materialReady,
  rulesReady,
} from "../../domain/project/guards";
import { saveDocument, KEY, readProjects } from "../../domain/project/storage";
import {
  exportDocument,
  importDocument,
} from "../../domain/project/import-export";
import { layoutRequest } from "../../domain/project/layout-request";
import { Requests } from "../../domain/project/requests";
import { History } from "../../domain/room/history";
import { applyOperation, contour } from "../../domain/room/commands";
import type { ResultSet } from "../../domain/project/results";
import { exportResult } from "../../domain/project/result-export";
import { api } from "../../api";
import type { Layout } from "../../types";
import StepNav, { stages, names } from "./StepNav";
import ObjectStep from "./ObjectStep";
import TileStep from "./TileStep";
import RulesStep from "./RulesStep";
import VariantsStep from "./VariantsStep";
export default function ProjectWorkflow({
  initial,
  onSaved,
  onBack,
}: {
  initial: ProjectDocument;
  onSaved: (d: ProjectDocument) => void;
  onBack: () => void;
}) {
  const [doc, dispatch] = useReducer(documentReducer, initial);
  const current = useRef(doc);
  const revision = useRef(initial.documentRevision);
  const queue = useRef(Promise.resolve());
  const stopped = useRef(false);
  const pendingSaves = useRef(0);
  const alive = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const [saveStatus, setSaveStatus] = useState("Сохранено"),
    [saveError, setSaveError] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null),
    [geometryBusy, setGeometryBusy] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<ResultSet | null>(null),
    [stage, setStage] = useState<Stage>("object"),
    [preview, setPreview] = useState<{
      document: ProjectDocument;
      revision: number;
    } | null>(null);
  const requested = useRef(initial.workflow.requestedStage),
    geometryRequests = useRef(new Requests()),
    layoutRequests = useRef(new Requests()),
    history = useRef(new History()),
    heading = useRef<HTMLHeadingElement>(null),
    file = useRef<HTMLInputElement>(null);
  function persist(next: ProjectDocument) {
    if (stopped.current) {
      setSaveStatus("Не сохранено");
      return;
    }
    pendingSaves.current++;
    setSaveStatus("Сохраняем…");
    queue.current = queue.current.then(async () => {
      if (stopped.current) {
        pendingSaves.current--;
        return;
      }
      try {
        const saved = await saveDocument(next, revision.current);
        revision.current = saved.documentRevision;
        if (alive.current) {
          current.current = {
            ...current.current,
            documentRevision: saved.documentRevision,
          };
          dispatch({ type: "rev", revision: saved.documentRevision });
          onSavedRef.current(saved);
          if (pendingSaves.current === 1) setSaveStatus("Сохранено");
          setSaveError("");
        }
      } catch (e) {
        stopped.current = true;
        if (alive.current) {
          setSaveStatus("Не сохранено");
          setSaveError((e as Error).message);
        }
      } finally {
        pendingSaves.current--;
      }
    });
  }
  function change(next: ProjectDocument) {
    current.current = next;
    dispatch({ type: "replace", document: next });
    persist(next);
  }
  function invalidate() {
    layoutRequests.current.cancel();
    setBusy(false);
    setResult(null);
    setError("");
  }
  async function check(d: ProjectDocument) {
    const token = geometryRequests.current.start();
    setGeometryBusy(true);
    setValidation(null);
    try {
      const r = await api<GeometryResponse>(
        "geometry/validate",
        {
          requestId: crypto.randomUUID(),
          draftRevision: d.room.draftRevision,
          geometry: d.room.draft,
        },
        token.signal,
      );
      if (!token.current() || !alive.current) return;
      setValidation(r.validation);
      if (requested.current !== "object" && roomReady(d, r.validation)) {
        const wanted = requested.current;
        setStage(
          !materialReady(d) ? "tile" : wanted === "variants" ? "rules" : wanted,
        );
      }
      requested.current = "object";
    } catch (e) {
      if (token.current() && alive.current) setError((e as Error).message);
    } finally {
      if (token.current() && alive.current) setGeometryBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void check(initial);
    const listener = (e: StorageEvent) => {
      if (e.key === KEY) {
        try {
          const other = readProjects().find((d) => d.id === initial.id);
          if (other && other.documentRevision !== revision.current) {
            stopped.current = true;
            setSaveStatus("Не сохранено");
            setSaveError("Конфликт: проект изменён в другой вкладке.");
          }
        } catch {
          setSaveError("Не удалось прочитать сохранённую версию.");
        }
      }
    };
    window.addEventListener("storage", listener);
    return () => {
      alive.current = false;
      geometryRequests.current.cancel();
      layoutRequests.current.cancel();
      window.removeEventListener("storage", listener);
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [stage]);
  function geometry(g: GeometrySnapshot) {
    history.current.push(current.current.room);
    invalidate();
    const next = {
      ...current.current,
      room: {
        ...current.current.room,
        draft: g,
        draftRevision: current.current.room.draftRevision + 1,
        pendingEdit: null,
        acknowledgment: null,
      },
    };
    change(next);
    void check(next);
  }
  async function runSolve(next: ProjectDocument) {
    const pe = next.room.pendingEdit;
    if (!pe) return;
    const token = geometryRequests.current.start();
    setValidation(null);
    setGeometryBusy(true);
    setError("");
    try {
      const r = await api<GeometryResponse>(
        "geometry/solve",
        {
          requestId: crypto.randomUUID(),
          draftRevision: next.room.draftRevision,
          geometry: pe.basisGeometry,
          operation: pe.operation,
        },
        token.signal,
      );
      if (!token.current() || !alive.current) return;
      setValidation({
        ...r.validation,
        measurements: measurements(current.current.room.draft),
      });
      if (
        r.geometry &&
        ["valid", "incomplete"].includes(r.validation.status) &&
        r.validation.issues.every((x) => x.code === "OPEN_CONTOUR")
      ) {
        const updated = {
          ...current.current,
          room: {
            ...current.current.room,
            draft: r.geometry,
            pendingEdit: null,
          },
        };
        setValidation(r.validation);
        change(updated);
      }
    } catch (e) {
      if (token.current() && alive.current) setError((e as Error).message);
    } finally {
      if (token.current() && alive.current) setGeometryBusy(false);
    }
  }
  function operation(op: Operation) {
    history.current.push(current.current.room);
    invalidate();
    const basis = structuredClone(current.current.room.draft);
    const key = op.wallId
      ? op.wallId + ":" + (op.type === "setLength" ? "length" : "interiorAngle")
      : "";
    if (key) delete basis.fieldInputs[key];
    if (op.type === "setOrientation") {
      const c = [basis.outer, ...basis.holes].find(
        (c) => c.id === op.contourId,
      );
      if (c?.walls[0])
        delete basis.fieldInputs[c.walls[0].id + ":firstWallOrientation"];
    }
    if (op.vertexId) {
      delete basis.fieldInputs[op.vertexId + ":x"];
      delete basis.fieldInputs[op.vertexId + ":y"];
    }
    const rev = current.current.room.draftRevision + 1;
    const next: ProjectDocument = {
      ...current.current,
      room: {
        ...current.current.room,
        draft: applyOperation(basis, op),
        draftRevision: rev,
        acknowledgment: null,
        pendingEdit: {
          basisGeometry: basis,
          operation: op,
          targetDraftRevision: rev,
        },
      },
    };
    change(next);
    void runSolve(next);
  }
  const roomOK = roomReady(doc, validation) && !geometryBusy;
  const ready = roomOK && materialReady(doc) && rulesReady(doc);
  const resultOK = !!result && ready && result.inputKey === inputKey(doc);
  const allowed = [true, roomOK, roomOK && materialReady(doc), resultOK];
  function navigate(s: Stage) {
    if (!allowed[stages.indexOf(s)]) return;
    layoutRequests.current.cancel();
    setBusy(false);
    setError("");
    setStage(s);
    change({ ...current.current, workflow: { requestedStage: s } });
  }
  function field(
    group: "material" | "rules",
    key: string,
    n: number | null,
    text: string,
  ) {
    invalidate();
    const next = structuredClone(current.current);
    if (n === null) next.fieldInputs[group + "." + key] = text;
    else {
      delete next.fieldInputs[group + "." + key];
      Object.assign(next[group], { [key]: n });
    }
    change(next);
  }
  async function search() {
    if (!ready) return;
    const d = current.current,
      key = inputKey(d),
      token = layoutRequests.current.start();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ variants: Layout[] }>(
        "optimize",
        layoutRequest(d),
        token.signal,
      );
      if (
        !token.current() ||
        !alive.current ||
        key !== inputKey(current.current)
      )
        return;
      if (!r.variants.length)
        throw new Error("Подходящих вариантов не найдено. Измените параметры.");
      setResult({
        inputKey: key,
        variants: r.variants,
        selectedVariantId: 0,
        acceptedPlacement: r.variants[0],
        pendingPlacement: null,
        locked: false,
      });
      setStage("variants");
      change({ ...current.current, workflow: { requestedStage: "variants" } });
    } catch (e) {
      if (token.current() && alive.current) setError((e as Error).message);
    } finally {
      if (token.current() && alive.current) setBusy(false);
    }
  }
  async function shift(x: number, y: number) {
    if (!resultOK || result!.locked) return;
    const token = layoutRequests.current.start(),
      key = inputKey(current.current);
    setResult((r) => (r ? { ...r, pendingPlacement: { x, y } } : r));
    setBusy(true);
    setError("");
    try {
      const l = await api<Layout>(
        "layout",
        layoutRequest(current.current, x, y),
        token.signal,
      );
      if (token.current() && alive.current && key === inputKey(current.current))
        setResult((r) =>
          r
            ? {
                ...r,
                acceptedPlacement: l,
                selectedVariantId: -1,
                pendingPlacement: null,
              }
            : r,
        );
    } catch (e) {
      if (token.current() && alive.current) setError((e as Error).message);
    } finally {
      if (token.current() && alive.current) setBusy(false);
    }
  }
  async function load(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const selected = e.target.files?.[0];
      if (selected)
        setPreview({
          document: await importDocument(selected, current.current),
          revision: revision.current,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      e.target.value = "";
    }
  }
  return (
    <div className="app workflow">
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void queue.current.then(() => {
              if (!stopped.current) onBack();
            });
          }}
        >
          плитка.
        </a>
        <button
          onClick={() =>
            void queue.current.then(() => {
              if (!stopped.current) onBack();
            })
          }
        >
          ← Все проекты
        </button>
        <div className="header-actions">
          <span role="status">{saveStatus}</span>
          <button onClick={() => file.current?.click()}>Открыть</button>
          <button
            onClick={() => {
              stopped.current = false;
              persist(current.current);
            }}
          >
            Сохранить
          </button>
          <button onClick={() => exportDocument(current.current)}>
            Файл проекта · JSON
          </button>
          <input ref={file} type="file" accept=".json" hidden onChange={load} />
        </div>
      </header>
      <div className="intro">
        <div>
          <div className="eyebrow">ОТ ГЕОМЕТРИИ К КРАСИВОМУ ПОЛУ</div>
          <h1>{doc.name}</h1>
          <p>{doc.address || "Адрес не указан"}</p>
        </div>
      </div>
      {saveError && (
        <div className="error" role="alert">
          {saveError}
          <button
            onClick={() => {
              stopped.current = false;
              persist(current.current);
            }}
          >
            Повторить сохранение
          </button>
          <button onClick={() => exportDocument(current.current)}>
            Скачать мой черновик
          </button>
          <button onClick={() => window.location.reload()}>
            Загрузить сохранённую версию
          </button>
        </div>
      )}
      {preview && (
        <section
          className="import-preview"
          role="dialog"
          aria-label="Импорт проекта"
        >
          <h2>{preview.document.name}</h2>
          <p>{preview.document.address}</p>
          <button
            onClick={() => {
              if (revision.current !== preview.revision) {
                setError("Конфликт: проект изменён после предпросмотра.");
                return;
              }
              invalidate();
              history.current = new History();
              geometryRequests.current.cancel();
              const next = {
                ...preview.document,
                id: current.current.id,
                documentRevision: revision.current,
              };
              change(next);
              setStage("object");
              requested.current = next.workflow.requestedStage;
              void check(next);
              setPreview(null);
            }}
          >
            Заменить открытый проект
          </button>
          <button onClick={() => setPreview(null)}>Отмена</button>
        </section>
      )}
      <StepNav active={stage} allowed={allowed} onChange={navigate} />
      <main className="stage-panel" data-stage={stage}>
        <h2 tabIndex={-1} ref={heading}>
          {names[stages.indexOf(stage)]}
        </h2>
        {error && (
          <div className="error" role="alert">
            {error}
            {stage === "object" && (
              <button
                onClick={() =>
                  doc.room.pendingEdit ? void runSolve(doc) : void check(doc)
                }
              >
                Повторить проверку
              </button>
            )}
          </div>
        )}
        {stage === "object" && (
          <ObjectStep
            doc={doc}
            validation={validation}
            busy={geometryBusy}
            onGeometry={geometry}
            onOperation={operation}
            onViewport={(v) => change({ ...current.current, viewport: v })}
            onApprove={() => {
              if (validation)
                change({
                  ...current.current,
                  room: {
                    ...current.current.room,
                    acknowledgment: acknowledgment(
                      doc.room.draft,
                      validation.measurements,
                    ),
                  },
                });
            }}
            onConfirm={() => {
              if (validation?.status !== "valid" || doc.room.pendingEdit)
                return;
              const a = acknowledgment(doc.room.draft, validation.measurements);
              if (
                a.entries.length &&
                a.measurementKey !== doc.room.acknowledgment?.measurementKey
              )
                return;
              change({
                ...current.current,
                room: {
                  ...current.current.room,
                  confirmed: {
                    geometry: structuredClone(doc.room.draft),
                    geometryKey: geometryKey(doc.room.draft),
                    measurementKey: a.measurementKey,
                    acknowledgment: doc.room.acknowledgment,
                    sourceDraftRevision: doc.room.draftRevision,
                  },
                },
              });
            }}
            onUndo={() => {
              const room = current.current.room;
              const prior =
                history.current.pop() ??
                (room.pendingEdit
                  ? {
                      ...room,
                      draft: structuredClone(room.pendingEdit.basisGeometry),
                      pendingEdit: null,
                      acknowledgment: null,
                    }
                  : undefined);
              if (prior) {
                invalidate();
                const next = {
                  ...current.current,
                  room: {
                    ...prior,
                    pendingEdit: prior.pendingEdit
                      ? {
                          ...prior.pendingEdit,
                          targetDraftRevision:
                            current.current.room.draftRevision + 1,
                        }
                      : null,
                    draftRevision: current.current.room.draftRevision + 1,
                  },
                };
                change(next);
                void check(next);
              }
            }}
            onDiscard={() => {
              invalidate();
              const r = current.current.room;
              const next = {
                ...current.current,
                room: {
                  ...r,
                  draft: r.confirmed
                    ? structuredClone(r.confirmed.geometry)
                    : {
                        outer: contour([], "outer", false),
                        holes: [],
                        constraints: [],
                        fieldInputs: {},
                      },
                  draftRevision: r.draftRevision + 1,
                  pendingEdit: null,
                  acknowledgment: r.confirmed?.acknowledgment ?? null,
                },
              };
              change(next);
              void check(next);
            }}
            onRetry={() => void runSolve(current.current)}
          />
        )}
        {stage === "tile" && <TileStep doc={doc} onField={field} />}
        {stage === "rules" && (
          <RulesStep
            doc={doc}
            onField={field}
            busy={busy}
            ready={ready}
            onSearch={() => void search()}
          />
        )}
        {stage === "variants" && resultOK && (
          <VariantsStep
            result={result!}
            busy={busy}
            error={error}
            onChoose={(l, i) => {
              if (!result!.locked) {
                layoutRequests.current.cancel();
                setBusy(false);
                setError("");
                setResult({
                  ...result!,
                  acceptedPlacement: l,
                  selectedVariantId: i,
                  pendingPlacement: null,
                });
              }
            }}
            onShift={(x, y) => void shift(x, y)}
            onLock={() =>
              setResult((r) => (r ? { ...r, locked: !r.locked } : r))
            }
            onCancel={() => {
              layoutRequests.current.cancel();
              setBusy(false);
              setError("");
              setResult((r) => (r ? { ...r, pendingPlacement: null } : r));
            }}
            onExport={(kind) => {
              if (resultOK && !busy && !error && !result?.pendingPlacement)
                exportResult(kind, result!.acceptedPlacement);
            }}
          />
        )}
        <div className="stage-footer">
          {stage !== "object" && (
            <button onClick={() => navigate(stages[stages.indexOf(stage) - 1])}>
              Назад
            </button>
          )}
          {["object", "tile"].includes(stage) && (
            <button
              className="dark"
              disabled={!allowed[stages.indexOf(stage) + 1]}
              onClick={() => navigate(stages[stages.indexOf(stage) + 1])}
            >
              Далее
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
