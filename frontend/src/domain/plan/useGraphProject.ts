import type { DeleteProjectIntent, DeleteProjectOutcome } from "./types";
import {
  clearedProject,
  restoredProject,
  type HistoryEntry,
} from "./project-lifecycle";
import { deletionPreview } from "./deletion-api";
import type { DeletionTarget, DeletionPreviewResponse } from "./types";
import { useState, useRef, useEffect } from "react";
import { api } from "../../api";
import type {
  ProjectDocumentV5,
  GraphResponse,
  GraphCommand,
  GraphSnapshot,
  RoomRecord,
} from "./types";
import { dimensionCommand } from "./types";
import { bindRooms } from "./rooms";
import { saveV5, deleteV5, KEY, readV5 } from "./storage";
import { canonicalCommand } from "./precision";
export function applyCondition(
  g: GraphSnapshot,
  c: GraphCommand,
): GraphSnapshot {
  const next = structuredClone(g);
  let condition;
  if (c.type === "setLength")
    condition = {
      id: c.constraintId,
      kind:
        c.target.kind === "chain"
          ? ("chainLength" as const)
          : ("segmentLength" as const),
      target:
        c.target.kind === "chain"
          ? {
              chainId: c.target.id,
              ...(c.target.range ? { range: c.target.range } : {}),
            }
          : { segmentId: c.target.id },
      value: c.value,
      fixed: true,
    };
  if (c.type === "setAngle")
    condition = {
      id: c.constraintId,
      kind: "angle" as const,
      target: {
        vertexId: c.vertexId,
        firstSegmentId: c.firstSegmentId,
        secondSegmentId: c.secondSegmentId,
        sector: c.sector,
      },
      value: c.value,
      fixed: true,
    };
  if (c.type === "setOrientation")
    condition = {
      id: c.constraintId,
      kind: "orientation" as const,
      target: { chainId: c.chainId },
      value: c.value,
      fixed: true,
    };
  if (condition) {
    next.constraints = next.constraints.filter((x) => x.id !== condition.id);
    next.constraints.push(condition);
  }
  if (c.type === "releaseConstraint")
    next.constraints = next.constraints.map((x) =>
      x.id === c.constraintId ? { ...x, fixed: false } : x,
    );
  return next;
}
export function useGraphProject(
  initial: ProjectDocumentV5,
  onSaved: (d: ProjectDocumentV5) => void,
  onRemoved: (outcome: DeleteProjectOutcome) => void,
) {
  const [doc, setDoc] = useState(initial),
    ref = useRef(initial),
    [response, setResponse] = useState<GraphResponse | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("Сохранено"),
    [busy, setBusy] = useState(true);
  const revision = useRef(initial.documentRevision),
    generation = useRef(0),
    queue = useRef(Promise.resolve()),
    alive = useRef(true),
    history = useRef<HistoryEntry[]>([]),
    epoch = useRef(0),
    writeEpoch = useRef(0),
    localRevision = useRef(0),
    [transition, setTransition] = useState({
      sequence: 0,
      reason: "validate",
      epoch: 0,
    }),
    [deletion, setDeletion] = useState<DeletionPreviewResponse | null>(null),
    previewToken = useRef(0),
    [change, setChange] = useState(0),
    conflict = useRef(false),
    writes = useRef(0),
    removing = useRef(false),
    removed = useRef(false),
    removalCallback = useRef(onRemoved);
  removalCallback.current = onRemoved;
  const install = (d: ProjectDocumentV5) => {
    ref.current = d;
    setDoc(d);
  };
  const notify = (reason: string) =>
    setTransition((t) => ({
      sequence: t.sequence + 1,
      reason,
      epoch: epoch.current,
    }));
  const isCurrent = (captured: number) =>
    alive.current && !removing.current && !removed.current && captured === epoch.current;
  const resetLifecycle = () => {
    epoch.current++;
    generation.current++;
    previewToken.current++;
    setDeletion(null);
    setBusy(false);
  };
  const persist = (d: ProjectDocumentV5) => {
    if (removing.current || removed.current) return;
    const ticket = ++writeEpoch.current;
    writes.current++;
    setSaved("Сохраняем…");
    queue.current = queue.current.then(async () => {
      try {
        if (ticket !== writeEpoch.current || removing.current || removed.current) return;
        if (conflict.current) {
          if (alive.current) {
            setSaved("Не сохранено");
            setError(
              "Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.",
            );
          }
          return;
        }
        const result = await saveV5(
          { ...d, documentRevision: revision.current },
          revision.current,
          () => ticket === writeEpoch.current && !conflict.current && !removing.current && !removed.current,
        );
        if (result.status === "skipped") return;
        revision.current = result.document.documentRevision;
        if (!alive.current || ticket !== writeEpoch.current) return;
        install({ ...ref.current, documentRevision: revision.current });
        setSaved("Сохранено");
        onSaved(result.document);
      } catch (e) {
        if (!alive.current || ticket !== writeEpoch.current || removing.current || removed.current) return;
        if ((e as Error).message.includes("Конфликт")) conflict.current = true;
        if (ticket === writeEpoch.current || conflict.current) {
          setSaved("Не сохранено");
          setError((e as Error).message);
        }
      } finally {
        writes.current--;
      }
    });
  };
  const update = (
    fn: (d: ProjectDocumentV5) => ProjectDocumentV5,
    undo: boolean | "clearProject" = false,
  ) => {
    if (removing.current || removed.current) return ref.current;
    if (undo) {
      history.current.push({
        kind: undo === "clearProject" ? "clearProject" : "edit",
        before: structuredClone(ref.current),
      });
      if (history.current.length > 20) history.current.shift();
    }
    const next = fn(structuredClone(ref.current));
    localRevision.current++;
    previewToken.current++;
    setDeletion(null);
    install(next);
    persist(next);
    return next;
  };
  const accept = async (r: GraphResponse, d: ProjectDocumentV5) => bindRooms(d, r.faces);
  const validate = async (d = ref.current) => {
    if (removing.current || removed.current) return;
    const token = ++generation.current,
      capturedEpoch = epoch.current;
    setBusy(true);
    try {
      const r = await api<GraphResponse>("plan/validate", {
        schemaVersion: 4,
        requestId: crypto.randomUUID(),
        draftRevision: d.plan.draftRevision,
        basisKey: JSON.stringify(d.plan.draft),
        graph: d.plan.draft,
      });
      if (token !== generation.current || !isCurrent(capturedEpoch)) return;
      if (JSON.stringify(d.plan.draft) !== JSON.stringify(ref.current.plan.draft) || d.plan.draftRevision !== ref.current.plan.draftRevision || r.draftRevision !== d.plan.draftRevision || r.basisKey !== JSON.stringify(d.plan.draft)) return;
      const before = ref.current;
      let next = await accept(r, before);
      if (token !== generation.current || !isCurrent(capturedEpoch)) return;
      if (JSON.stringify(before.plan.draft) !== JSON.stringify(ref.current.plan.draft)) return;
      next = {...ref.current, rooms: next.rooms.map(room => {
        const old = before.rooms.find(x => x.id === room.id), live = ref.current.rooms.find(x => x.id === room.id);
        return old && live ? {...room, name: live.name, material: live.material, rules: live.rules, fieldInputs: live.fieldInputs} : room;
      }), selectedRoomId: next.rooms.some(r => r.id === ref.current.selectedRoomId && r.binding === 'attached') ? ref.current.selectedRoomId : null};
      setResponse(r);
      notify("validate");
      if (JSON.stringify(next) !== JSON.stringify(ref.current)) {
        install(next);
        persist(next);
      }
      if (!conflict.current) setError("");
    } catch (e) {
      if (token === generation.current && isCurrent(capturedEpoch))
        setError((e as Error).message);
    } finally {
      if (token === generation.current && isCurrent(capturedEpoch))
        setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void validate();
    const storage = (e: StorageEvent) => {
      if (e.key === KEY) {
        try {
          const d = readV5().find((x) => x.id === ref.current.id);
          if (!d) { finishRemoval({ status: "alreadyMissing", projectId: ref.current.id, projects: readV5() }); return; }
          if (d && d.documentRevision !== revision.current) {
            conflict.current = true;
            setError(
              "Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.",
            );
            setSaved("Не сохранено");
          }
        } catch (e) {
          setError((e as Error).message);
        }
      }
    };
    window.addEventListener("storage", storage);
    return () => {
      alive.current = false;
      generation.current++;
      epoch.current++;
      previewToken.current++;
      window.removeEventListener("storage", storage);
    };
  }, []);
  const execute = async (
    command: GraphCommand,
    raw?: { key: string; text: string },
    retry = false,
  ) => {
    command = canonicalCommand(command);
    if (removing.current || removed.current) return;
    const current = ref.current,
      previous = current.plan.pendingEdit;
    if (command.type === "nudgeWallHandle") {
      if (previous) { setError("Сначала завершите предыдущее действие."); return; }
      const basis = structuredClone(current.plan.draft);
      const basisKey = JSON.stringify(basis);
      const revision = current.plan.draftRevision + 1;
      const commandId = crypto.randomUUID();
      const token = ++generation.current;
      const capturedEpoch = epoch.current;
      setBusy(true);
      setError("");
      try {
        const result = await api<GraphResponse>("plan/command", {
          schemaVersion: 4, commandId, draftRevision: revision,
          basisKey, graph: basis, command,
        });
        if (token !== generation.current || !isCurrent(capturedEpoch) ||
          ref.current.plan.draftRevision !== current.plan.draftRevision ||
          JSON.stringify(ref.current.plan.draft) !== basisKey) return;
        if (result.status !== "applied") {
          setError(result.issues[0]?.message || "Точку стены нельзя сдвинуть в этом направлении.");
          return;
        }
        const updated = update((document) => ({ ...document, plan: {
          ...document.plan, draft: result.graph, draftRevision: revision, pendingEdit: null,
        }}), true);
        const next = await accept(result, updated);
        if (token !== generation.current || !isCurrent(capturedEpoch)) return;
        install(next);
        persist(next);
        setResponse({ ...result, graph: next.plan.draft });
        notify(command.type);
      } catch (error) {
        if (token === generation.current && isCurrent(capturedEpoch)) setError((error as Error).message);
      } finally {
        if (token === generation.current && isCurrent(capturedEpoch)) setBusy(false);
      }
      return;
    }
    if (
      !retry &&
      previous &&
      !dimensionCommand(previous.command)
    ) {
      setError("Сначала повторите или отмените незавершённое действие.");
      return;
    }
    const basis =
        retry && previous?.kind === "graphV4"
          ? previous.basisGraph
          : structuredClone(current.plan.draft),
      commandId =
        retry && previous?.kind === "graphV4"
          ? previous.commandId
          : crypto.randomUUID(),
      rev = current.plan.draftRevision + 1;
    const draft = dimensionCommand(command)
      ? applyCondition(basis, command)
      : structuredClone(basis);
    draft.fieldInputs = { ...current.plan.draft.fieldInputs };
    if (raw) draft.fieldInputs[raw.key] = raw.text;
    const d = update(
      (d) => ({
        ...d,
        plan: {
          ...d.plan,
          draft,
          draftRevision: rev,
          pendingEdit: {
            kind: "graphV4",
            commandId,
            command,
            basisGraph: basis,
            targetDraftRevision: rev,
          },
        },
      }),
      !retry,
    );
    setChange((n) => n + 1);
    const token = ++generation.current,
      capturedEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      const r = await api<GraphResponse>("plan/command", {
        schemaVersion: 4,
        commandId,
        draftRevision: rev,
        basisKey: JSON.stringify(basis),
        graph: { ...basis, fieldInputs: draft.fieldInputs },
        command,
      });
      if (token !== generation.current || !isCurrent(capturedEpoch) ||
          r.commandId !== commandId || r.draftRevision !== rev ||
          r.basisKey !== JSON.stringify(basis) ||
          ref.current.plan.draftRevision !== rev) return;
      let next = {
        ...ref.current,
        plan: {
          ...ref.current.plan,
          draft: {
            ...r.graph,
            fieldInputs:
              r.status === "applied"
                ? r.graph.fieldInputs
                : ref.current.plan.draft.fieldInputs,
          },
          pendingEdit: r.status === "applied" ? null : d.plan.pendingEdit,
        },
      };
      if (r.status === "applied" && command.type === "deleteRoom") {
        const deletedRooms = new Set(
          next.rooms
            .filter(
              (room) =>
                room.binding === "attached" &&
                room.topologyKey === command.topologyKey,
            )
            .map((room) => room.id),
        );
        const restore = next.plan.restorePoint;
        next = {
          ...next,
          rooms: next.rooms.filter((room) => !deletedRooms.has(room.id)),
          plan: {
            ...next.plan,
            restorePoint: restore
              ? {
                  ...restore,
                  bindings: restore.bindings.filter(
                    (binding) => !deletedRooms.has(binding.roomId),
                  ),
                  selectedRoomId:
                    restore.selectedRoomId &&
                    deletedRooms.has(restore.selectedRoomId)
                      ? null
                      : restore.selectedRoomId,
                }
              : null,
          },
        };
      }
      next = await accept(r, next);
      if (token !== generation.current || !isCurrent(capturedEpoch)) return;
      // Hashing boundary identity is asynchronous; preserve edits to presentation
      // and per-room fields made while the geometry response was being accepted.
      const latest = ref.current;
      next = {...next, name: latest.name, address: latest.address, viewport: latest.viewport, workflow: latest.workflow,
        rooms: next.rooms.map(room => {
          const live = latest.rooms.find(r => r.id === room.id);
          return live ? {...room, name: live.name.trim() ? live.name : room.name, material: live.material, rules: live.rules, fieldInputs: live.fieldInputs} : room;
        }),
        selectedRoomId: next.rooms.some(r => r.id === latest.selectedRoomId && r.binding === 'attached') ? latest.selectedRoomId : null,
      };
      install(next);
      persist(next);
      setResponse({ ...r, graph: next.plan.draft });
      notify(command.type);
      if (r.status !== "applied")
        setError(
          r.issues[0]?.message ||
            "Не удалось согласовать размеры. Исправьте условия или отмените действие.",
        );
    } catch (e) {
      if (token === generation.current && isCurrent(capturedEpoch))
        setError((e as Error).message);
    } finally {
      if (token === generation.current && isCurrent(capturedEpoch))
        setBusy(false);
    }
  };
  const cancel = () => {
    if (removing.current || removed.current) return;
    generation.current++;
    const p = ref.current.plan.pendingEdit;
    const old = p?.basisGraph ?? null;
    let next: ProjectDocumentV5 | undefined;
    if (
      old &&
      history.current.at(-1)?.kind === "edit" &&
      JSON.stringify(history.current.at(-1)?.before.plan.draft) ===
        JSON.stringify(old)
    )
      history.current.pop();
    if (old)
      next = update((d) => ({
        ...d,
        plan: {
          ...d.plan,
          draft: old,
          draftRevision: d.plan.draftRevision + 1,
          pendingEdit: null,
        },
      }));
    else {
      const h = history.current.pop();
      if (h) {
        if (h.kind === "clearProject") resetLifecycle();
        next = update((d) => restoredProject(d, h.before));
        notify(h.kind === "clearProject" ? "undoClear" : "undo");
      }
    }
    setChange((n) => n + 1);
    setError("");
    if (next) void validate(next);
  };
  const retry = async () => {
    if (removing.current || removed.current) return;
    const pending = ref.current.plan.pendingEdit;
    if (pending) void execute(pending.command, undefined, true);
    else void validate();
  };
  const clearProject = () => {
    if (removing.current || removed.current) return;
    resetLifecycle();
    const next = update(clearedProject, "clearProject");
    setResponse(null);
    setError("");
    setChange((n) => n + 1);
    notify("clearProject");
    void validate(next);
  };
  const requestDeletion = async (target: DeletionTarget) => {
    if (removing.current || removed.current) return;
    const d = ref.current,
      token = ++previewToken.current,
      capturedEpoch = epoch.current,
      basis = JSON.stringify(d.plan.draft);
    setDeletion(null);
    try {
      const r = await deletionPreview(d, target, crypto.randomUUID());
      if (
        !isCurrent(capturedEpoch) ||
        token !== previewToken.current ||
        basis !== JSON.stringify(ref.current.plan.draft)
      )
        return;
      setDeletion(r);
      if (r.status === "invalid")
        setError(r.issues[0]?.message || "Не удалось подготовить удаление.");
    } catch (e) {
      if (isCurrent(capturedEpoch) && token === previewToken.current)
        setError((e as Error).message);
    }
  };
  const confirmDeletion = () => {
    if (removing.current || removed.current) return;
    if (
      !deletion?.impact ||
      deletion.basisKey !== JSON.stringify(ref.current.plan.draft)
    ) {
      setDeletion(null);
      return;
    }
    const { target, impact } = deletion;
    setDeletion(null);
    void execute(
      target.kind === "room"
        ? {
            type: "deleteRoom",
            topologyKey: target.topologyKey,
            impactKey: impact.impactKey,
          }
        : {
            type: "deleteVoid",
            voidId: target.voidId,
            impactKey: impact.impactKey,
          },
    );
  };
  const replaceDocument = (next: ProjectDocumentV5, reason = "import") => {
    if (removing.current || removed.current) return ref.current;
    resetLifecycle();
    const result = update(
      (d) => restoredProject(d, { ...next, id: d.id }),
      true,
    );
    notify(reason);
    setResponse(null);
    void validate(result);
    return result;
  };
  const roomUpdate = (id: string, fn: (r: RoomRecord) => RoomRecord) =>
    update((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === id ? fn(r) : r)),
    }));
  const finishRemoval = (outcome: DeleteProjectOutcome) => {
    if (removed.current) return;
    removed.current = true; removing.current = false;
    writeEpoch.current++; resetLifecycle(); history.current = [];
    if (alive.current) {
      // An already open editor may still have its pre-update parent props.
      // Storage has committed: missing navigation must not turn deletion into an error.
      const callback = removalCallback.current;
      if (typeof callback === "function") callback(outcome);
      else location.hash = "";
    }
  };
  const deleteIntent = (): DeleteProjectIntent => ({
    projectId: ref.current.id, expectedRevision: revision.current,
    name: ref.current.name, address: ref.current.address,
    localRevision: localRevision.current, origin: 'editor', requestId: crypto.randomUUID(),
  });
  const deleteProject = async (intent: DeleteProjectIntent): Promise<DeleteProjectOutcome> => {
    if (removed.current || removing.current) throw new Error('Удаление уже выполняется.');
    if (intent.localRevision !== undefined && intent.localRevision !== localRevision.current)
      return { status: 'conflict', projectId: ref.current.id, projects: readV5(),
        current: { ...ref.current, documentRevision: revision.current } };
    removing.current = true; writeEpoch.current++; resetLifecycle(); notify("deleteAttempt");
    try {
      const outcome = await deleteV5(intent.projectId, intent.expectedRevision);
      if (outcome.status === 'conflict') { conflict.current = true; return outcome; }
      finishRemoval(outcome); return outcome;
    } finally { removing.current = false; }
  };
  return {
    deleteIntent, deleteProject,
    clearProject,
    canUndo: history.current.length > 0 || !!doc.plan.pendingEdit,
    transition,
    epoch,
    localRevision,
    current: isCurrent,
    deletion,
    requestDeletion,
    confirmDeletion,
    cancelDeletion: () => {
      previewToken.current++;
      setDeletion(null);
    },
    replaceDocument,
    retrySave: () => persist(ref.current),
    doc,
    ref,
    response,
    error,
    setError,
    saved,
    busy,
    update,
    execute,
    cancel,
    retry,
    validate,
    roomUpdate,
    change,
  };
}
