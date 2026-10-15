import { graphSchema } from "./domain/plan/schema";
import { geometry } from "./domain/project/schema";
export async function api<T>(
  route: string,
  project: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  let body: string;
  try {
    res = await fetch("/api/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    body = await res.text();
  } catch (error) {
    if (signal?.aborted || (error as Error).name === "AbortError") throw error;
    throw new Error(
      "Нет связи с сервером расчёта. Проверьте, что FastAPI запущен, и повторите запрос.",
    );
  }

  // A development proxy or gateway can return an empty/HTML error response.
  // Do not let JSON parsing hide the original HTTP failure.
  let data: unknown;
  try {
    data = body.trim() ? JSON.parse(body) : undefined;
  } catch {
    data = undefined;
  }
  const object =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;

  if (!res.ok) {
    if (
      object?.error &&
      typeof object.error === "object" &&
      typeof (object.error as { message?: unknown }).message === "string"
    )
      throw new Error((object.error as { message: string }).message);
    if (typeof object?.detail === "string") throw new Error(object.detail);
    if (res.status === 422)
      throw new Error("Проверьте размеры, координаты и параметры плитки.");
    throw new Error(
      `Сервер расчёта недоступен или завершил запрос с ошибкой (HTTP ${res.status}). Повторите запрос; если ошибка сохраняется, проверьте сервер FastAPI.`,
    );
  }

  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const rings = (v: unknown): boolean =>
    Array.isArray(v) &&
    v.every(
      (r) =>
        Array.isArray(r) &&
        r.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite)),
    );
  const polygon = (v: unknown): boolean =>
    record(v) && Array.isArray(v.outline) && Array.isArray(v.holes) &&
    rings([v.outline, ...v.holes]);
  const layout = (v: unknown): boolean =>
    record(v) &&
    Array.isArray(v.parts) &&
    v.parts.length > 0 &&
    v.parts.every(
      (p) =>
        record(p) &&
        typeof p.id === "string" &&
        rings(p.rings) &&
        Array.isArray(p.issues) &&
        p.issues.every((x) => typeof x === "string") &&
        [p.width, p.height, p.min_width, p.area].every(finite),
    ) &&
    record(v.metrics) &&
    [
      "tiles",
      "full",
      "cut",
      "fragments",
      "warnings",
      "min_width",
      "room_area",
      "laying_area",
      "covered_area",
      "grout_area",
      "waste_area",
      "waste_percent",
    ].every((k) => finite((v.metrics as Record<string, unknown>)[k])) &&
    (v.metrics.symmetry === null || finite(v.metrics.symmetry)) &&
    [v.angle, v.offset_x, v.offset_y].every(finite);
  let valid = false;
  if (object && route === "plan/deletion-preview") {
    const request = project as {
      requestId: string;
      draftRevision: number;
      basisKey: string;
      target: { kind: string; topologyKey?: string; voidId?: string };
    };
    const strings = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string");
    const target = object.target,
      impact = object.impact;
    valid =
      object.schemaVersion === 4 &&
      object.requestId === request.requestId &&
      object.draftRevision === request.draftRevision &&
      object.basisKey === request.basisKey &&
      record(target) &&
      target.kind === request.target.kind &&
      target.topologyKey === request.target.topologyKey &&
      target.voidId === request.target.voidId &&
      Array.isArray(object.issues) &&
      object.issues.every(
        (i) =>
          record(i) &&
          typeof i.code === "string" &&
          typeof i.message === "string" &&
          strings(i.entityIds) &&
          strings(i.affectedRoomKeys) &&
          ["global", "component", "room"].includes(i.scope as string),
      );
    if (object.status === "ready")
      valid =
        valid &&
        record(impact) &&
        typeof impact.impactKey === "string" &&
        /^[a-f0-9]{64}$/.test(impact.impactKey) &&
        [
          "segmentIds",
          "vertexIds",
          "retiredChainIds",
          "constraintIds",
          "voidIds",
          "affectedRoomKeys",
          "disappearedRoomKeys",
        ].every(
          (k) =>
            strings(impact[k]) && new Set(impact[k]).size === impact[k].length,
        ) &&
        strings(impact.disappearedRoomKeys) &&
        strings(impact.affectedRoomKeys) &&
        impact.disappearedRoomKeys.every((k) =>
          (impact.affectedRoomKeys as string[]).includes(k),
        );
    else valid = valid && object.status === "invalid" && impact === null;
  } else if (object && route.startsWith("plan/")) {
    const request = project as {
      requestId?: string;
      commandId?: string;
      draftRevision: number;
      basisKey: string;
    };
    valid =
      object.schemaVersion === 4 &&
      object.requestId === request.requestId &&
      object.commandId === request.commandId &&
      object.draftRevision === request.draftRevision &&
      object.basisKey === request.basisKey &&
      ["valid", "invalid", "unresolved", "applied"].includes(
        object.status as string,
      ) &&
      Array.isArray(object.faces) &&
      Array.isArray(object.wallArea) &&
      object.wallArea.every(polygon) &&
      Array.isArray(object.issues) &&
      Array.isArray(object.measurements);
    if (valid) {
      try {
        graphSchema(object.graph);
        valid =
          (object.faces as unknown[]).every(
            (f) =>
              record(f) &&
              typeof f.topologyKey === "string" &&
              typeof f.dependencyKey === "string" &&
              typeof f.measurementKey === "string" &&
              polygon(f.axisPolygon) &&
              (f.polygon === null ? f.areaMm2 === null : polygon(f.polygon) && finite(f.areaMm2)) &&
              record(f.validation) &&
              typeof f.validation.valid === "boolean",
          ) &&
          (object.issues as unknown[]).every(
            (i) =>
              record(i) &&
              typeof i.message === "string" &&
              Array.isArray(i.entityIds) &&
              Array.isArray(i.affectedRoomKeys),
          );
      } catch {
        valid = false;
      }
    }
    if (valid && object) {
      const strings = (v: unknown): boolean =>
        Array.isArray(v) && v.every((x) => typeof x === "string");
      const refs = (v: unknown): boolean =>
        Array.isArray(v) &&
        v.every(
          (x) =>
            record(x) &&
            typeof x.segmentId === "string" &&
            typeof x.forward === "boolean",
        );
      const issue = (v: unknown): boolean =>
        record(v) &&
        typeof v.code === "string" &&
        typeof v.message === "string" &&
        strings(v.entityIds) &&
        strings(v.affectedRoomKeys) &&
        ["global", "component", "room"].includes(v.scope as string);
      valid =
        (object.faces as unknown[]).every(
          (f) =>
            record(f) &&
            typeof f.geometryKey === "string" &&
            strings(f.dependencyIds) &&
            refs(f.outer) &&
            Array.isArray(f.holes) &&
            f.holes.every(refs) &&
            record(f.validation) &&
            Array.isArray(f.validation.issues) &&
            f.validation.issues.every(issue),
        ) &&
        (object.measurements as unknown[]).every(
          (m) =>
            record(m) &&
            typeof m.key === "string" &&
            typeof m.kind === "string" &&
            record(m.target) &&
            (m.value === null || finite(m.value)) &&
            ["entered", "derived"].includes(m.source as string),
        ) &&
        (object.issues as unknown[]).every(issue);
      if (route === "plan/command")
        valid =
          valid &&
          record(object.splitMap) &&
          Object.values(object.splitMap).every(strings) &&
          strings(object.addedIds) &&
          strings(object.removedIds) &&
          strings(object.affectedChainIds);
    }
  } else if (object && route.startsWith("geometry/")) {
    const v = object.validation;
    const request = project as { requestId: string; draftRevision: number };
    valid =
      object.requestId === request.requestId &&
      object.draftRevision === request.draftRevision &&
      record(v) &&
      [
        "valid",
        "incomplete",
        "constraint_conflict",
        "invalid_topology",
        "unresolved",
      ].includes(v.status as string) &&
      Array.isArray(v.issues) &&
      v.issues.every(
        (i) =>
          record(i) &&
          typeof i.message === "string" &&
          typeof i.code === "string" &&
          [i.wallIds, i.vertexIds, i.constraintIds].every(
            (a) => Array.isArray(a) && a.every((x) => typeof x === "string"),
          ),
      ) &&
      Array.isArray(v.measurements) &&
      v.measurements.every(
        (m) =>
          record(m) &&
          typeof m.wallId === "string" &&
          finite(m.length) &&
          finite(m.orientation) &&
          (m.interiorAngle === null || finite(m.interiorAngle)),
      ) &&
      (v.areaMm2 === null || finite(v.areaMm2)) &&
      (v.closureGapMm === null || finite(v.closureGapMm));
    if (valid && route === "geometry/solve") {
      try {
        geometry(object.geometry);
      } catch {
        valid = false;
      }
    }
  } else if (object) {
    valid =
      route === "optimize"
        ? Array.isArray(object.variants) && object.variants.every(layout)
        : layout(object);
  }
  if (!valid) {
    throw new Error(
      body.trim()
        ? "Сервер вернул некорректный ответ вместо результата расчёта. Повторите запрос."
        : "Сервер вернул пустой ответ. Повторите запрос.",
    );
  }
  return data as T;
}
