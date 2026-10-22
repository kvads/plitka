import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { saveV6 } from "./storage";
import type { GraphPendingV5, PhysicalCommandV5, PhysicalGraphResponseV5, Point, ProjectDocumentV6 } from "./types";
import { physicalBasisKey } from "./physical-basis";

/** A v6-only editor session. A stale response can never replace a newer graph. */
export function usePhysicalProject(initial: ProjectDocumentV6,
  onSaved: (document: ProjectDocumentV6) => void) {
  const [doc, setDoc] = useState(initial);
  const [response, setResponse] = useState<PhysicalGraphResponseV5 | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(initial);
  const validationEpoch = useRef(0);
  const commandEpoch = useRef(0);
  const commandRunning = useRef(false);
  const savedRevision = useRef(initial.documentRevision);
  const saving = useRef(false);
  const waiting = useRef<ProjectDocumentV6 | null>(null);
  const undoStack = useRef<ProjectDocumentV6[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const alive = useRef(true);

  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (waiting.current && alive.current) {
        const candidate = waiting.current;
        waiting.current = null;
        const saved = await saveV6(candidate, savedRevision.current, () => alive.current);
        if (saved.status === "skipped") return;
        savedRevision.current = saved.document.documentRevision;
        onSaved(saved.document);
        if (current.current === candidate) {
          current.current = saved.document;
          setDoc(saved.document);
        }
      }
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
    } finally {
      saving.current = false;
      if (waiting.current && alive.current) void flush();
    }
  }, [onSaved]);

  const update = useCallback((change: (document: ProjectDocumentV6) => ProjectDocumentV6) => {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    setDoc(next);
    waiting.current = next;
    void flush();
  }, [flush]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; validationEpoch.current++; commandEpoch.current++; };
  }, []);

  useEffect(() => {
    const generation = ++validationEpoch.current;
    const graph = doc.plan.draft;
    const controller = new AbortController();
    physicalBasisKey(graph).then(basisKey => api<PhysicalGraphResponseV5>("v5/plan/validate", {
      schemaVersion: 5, requestId: crypto.randomUUID(),
      draftRevision: doc.plan.draftRevision, basisKey, graph,
    }, controller.signal)).then(result => {
      if (alive.current && generation === validationEpoch.current &&
          current.current.plan.draftRevision === doc.plan.draftRevision) {
        setResponse(result);
        setError(result.status === "invalid" ? result.issues[0]?.message ?? "Геометрия недопустима." : "");
        if (result.status === "valid" && result.normalizedGraph &&
            !current.current.plan.pendingEdit)
          update(document => ({ ...document, plan: { ...document.plan,
            draft: result.normalizedGraph!, draftRevision: document.plan.draftRevision + 1 } }));
      }
    }).catch(cause => {
      if (alive.current && generation === validationEpoch.current && !controller.signal.aborted)
        setError((cause as Error).message);
    });
    return () => controller.abort();
  }, [doc.plan.draft, doc.plan.draftRevision, update]);

  const runPending = useCallback(async (pending: GraphPendingV5, original: ProjectDocumentV6) => {
    if (commandRunning.current) return;
    commandRunning.current = true;
    setBusy(true);
    setError("");
    const generation = ++commandEpoch.current;
    try {
      const basisKey = await physicalBasisKey(pending.basisGraph);
      if (!alive.current || generation !== commandEpoch.current ||
          current.current.plan.draftRevision !== original.plan.draftRevision)
        return;
      const result = await api<PhysicalGraphResponseV5>("v5/plan/command", {
        schemaVersion: 5, commandId: pending.commandId,
        draftRevision: original.plan.draftRevision, basisKey,
        graph: pending.basisGraph, command: pending.command,
      });
      if (!alive.current || generation !== commandEpoch.current ||
          current.current.plan.draftRevision !== original.plan.draftRevision ||
          current.current.plan.pendingEdit?.commandId !== pending.commandId)
        return;
      if (result.status !== "applied") {
        setError(result.issues[0]?.message ?? "Стена не изменена.");
        update(document => ({ ...document, plan: { ...document.plan, pendingEdit: null } }));
        return;
      }
      undoStack.current.push({ ...original, plan: { ...original.plan, pendingEdit: null } });
      if (undoStack.current.length > 50) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
      setResponse({ ...result, draftRevision: original.plan.draftRevision + 1 });
      update(document => ({ ...document, plan: {
        ...document.plan, draft: result.graph,
        draftRevision: document.plan.draftRevision + 1,
        pendingEdit: null,
      } }));
    } catch (cause) {
      if (alive.current && generation === commandEpoch.current) setError((cause as Error).message);
    } finally {
      commandRunning.current = false;
      if (alive.current) setBusy(false);
    }
  }, [update]);

  const command = useCallback(async (action: PhysicalCommandV5) => {
    if (commandRunning.current || current.current.plan.pendingEdit) return;
    const original = current.current;
    const pending: GraphPendingV5 = { kind: "graphV5", commandId: crypto.randomUUID(),
      command: action, basisGraph: original.plan.draft,
      targetDraftRevision: original.plan.draftRevision };
    update(document => ({ ...document, plan: { ...document.plan, pendingEdit: pending } }));
    await runPending(pending, original);
  }, [runPending, update]);

  useEffect(() => {
    const pending = initial.plan.pendingEdit;
    if (!pending) return;
    const timer = window.setTimeout(() => { void runPending(pending, initial); }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, runPending]);

  const drawWall = useCallback((drawnEdge: [Point, Point], side: "left" | "right", thicknessMm: number) =>
    command({ type: "drawWall", drawnEdge, side, thicknessMm }), [command]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    commandEpoch.current++;
    setUndoCount(undoStack.current.length);
    update(document => ({ ...document,
      plan: { ...document.plan, draft: previous.plan.draft,
        draftRevision: document.plan.draftRevision + 1, pendingEdit: null },
      rooms: previous.rooms, selectedRoomId: previous.selectedRoomId,
    }));
  }, [update]);

  const retryPending = useCallback(() => {
    const pending = current.current.plan.pendingEdit;
    if (pending && !commandRunning.current) void runPending(pending, current.current);
  }, [runPending]);
  const discardPending = useCallback(() => {
    if (commandRunning.current) return;
    commandEpoch.current++;
    update(document => ({ ...document, plan: { ...document.plan, pendingEdit: null } }));
    setError("");
  }, [update]);

  return { doc, response, error, busy, update, command, drawWall,
    undo, canUndo: undoCount > 0, retryPending, discardPending,
    clearError: () => setError("") };
}
