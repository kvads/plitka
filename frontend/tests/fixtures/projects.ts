import { expect, type Page } from "@playwright/test";
import { initial } from "../../src/types";

export type TouchPoint = { id: number; x: number; y: number };

export async function touchSession(page: Page) {
  const client = await page.context().newCDPSession(page);
  const canvas = page.locator("svg[data-geometry]");
  return {
    dispatch: (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: TouchPoint[]) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: points }),
    snapshot: async () => ({
      geometry: await canvas.getAttribute("data-geometry"),
      layout: await canvas.getAttribute("data-layout"),
    }),
    close: () => client.detach(),
  };
}

export async function openProject(page: Page, plan = initial) {
  await page.addInitScript((p) => {
    if (!localStorage.getItem("plitka-projects-v1"))
      localStorage.setItem(
        "plitka-projects-v1",
        JSON.stringify([
          {
            id: "test",
            name: "Тестовый проект",
            address: "Тестовый адрес",
            plan: p,
          },
        ]),
      );
    if (!location.hash) location.hash = "project/test";
  }, plan);
  await page.goto("/");
}
export async function confirmRoom(page: Page) {
  await page
    .getByRole("button", { name: "Выбрать помещение", exact: true })
    .click();
  const geometry = await page
    .locator("[data-geometry]")
    .getAttribute("data-geometry");
  const validation = await graphValidate(page, JSON.parse(geometry!));
  const document = await stored(page);
  const key = document.rooms.find(
    (r: any) => r.id === document.selectedRoomId,
  )?.topologyKey;
  const polygon = (
    validation.faces.find((f: any) => f.topologyKey === key) ||
    validation.faces[0]
  ).polygon;
  // The small fixtures use convex rooms; choose an interior point away from holes.
  const point = polygon.outline.reduce(
    (p: number[], q: number[]) => [
      p[0] + q[0] / polygon.outline.length,
      p[1] + q[1] / polygon.outline.length,
    ],
    [0, 0],
  );
  const screen = await screenPoint(page, point[0], point[1]);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.getByLabel("Название помещения")).toBeVisible();
}
export async function toRules(page: Page) {
  await page.getByRole('button', {name:'2. Варианты',exact:true}).click();
  const picker = page.getByRole('combobox',{name:'Помещение',exact:true});
  await expect(picker.locator('option')).not.toHaveCount(1);
  await picker.selectOption({index:1});
}
export async function commit(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press("Enter");
}
export async function stored(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("plitka-projects-v3")!).projects[0],
  );
}
export async function settle(page: Page) {
  await expect(
    page.getByText("Проверяем геометрию…", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
}
export async function importFile(page: Page, data: unknown) {
  await page.locator("input[type=file]").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole("button", { name: "Заменить открытый проект" }).click();
  await settle(page);
}

// Small independent fixtures for the graph editor. Never populate user storage.
export function graphRectangle(width = 4000, height = 3000, prefix = "a") {
  const vertices = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y], i) => ({ id: `${prefix}v${i}`, x, y }));
  const segments = vertices.map((v, i) => ({
    id: `${prefix}s${i}`,
    startVertexId: v.id,
    endVertexId: vertices[(i + 1) % 4].id,
    chainId: `${prefix}c${i}`,
  }));
  return {
    vertices,
    segments,
    chains: segments.map((s) => ({
      id: s.chainId,
      startVertexId: s.startVertexId,
      endVertexId: s.endVertexId,
      segmentIds: [s.id],
    })),
    voids: [],
    constraints: [],
    fieldInputs: {},
  };
}
export function graphTwoRooms() {
  const a = graphRectangle(),
    b = graphRectangle(2000, 2000, "b");
  b.vertices.forEach((v) => (v.x += 5000));
  return {
    vertices: [...a.vertices, ...b.vertices, { id: "free", x: 8000, y: 1000 }],
    segments: [...a.segments, ...b.segments],
    chains: [...a.chains, ...b.chains],
    voids: [],
    constraints: [],
    fieldInputs: {},
  };
}
export function graphOpen() {
  const g = graphRectangle();
  g.vertices = g.vertices.slice(0, 3);
  g.segments = g.segments.slice(0, 2);
  g.chains = g.chains.slice(0, 2);
  return g;
}
export function graphMeasured() {
  const g = graphRectangle();
  return {
    ...g,
    constraints: [
      {
        id: "length4000",
        kind: "chainLength" as const,
        target: { chainId: "ac0" },
        value: 4000,
        fixed: true,
      },
    ],
  };
}
export function graphWithVoid() {
  const g = graphRectangle(),
    v = graphRectangle(500, 500, "hole");
  v.vertices.forEach((p) => {
    p.x += 1000;
    p.y += 1000;
  });
  return {
    vertices: [...g.vertices, ...v.vertices],
    segments: [...g.segments, ...v.segments],
    chains: [...g.chains, ...v.chains],
    constraints: [],
    fieldInputs: {},
    voids: [
      {
        id: "void",
        boundary: v.segments.map((s) => ({ segmentId: s.id, forward: true })),
      },
    ],
  };
}
export async function graphCommand(
  page: Page,
  graph: unknown,
  command: unknown,
  commandId = crypto.randomUUID(),
) {
  return page.evaluate(
    async ({ graph, command, commandId }) => {
      const r = await fetch("/api/plan/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 3,
          commandId,
          draftRevision: 1,
          basisKey: "e2e",
          graph,
          command,
        }),
      });
      return { http: r.status, ...(await r.json()) };
    },
    { graph, command, commandId },
  );
}
export async function graphValidate(page: Page, graph: unknown) {
  return page.evaluate(async (graph) => {
    const r = await fetch("/api/plan/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 3,
        requestId: "e2e",
        draftRevision: 0,
        basisKey: "e2e",
        graph,
      }),
    });
    return { http: r.status, ...(await r.json()) };
  }, graph);
}
export async function openGraph(
  page: Page,
  graph: unknown,
  viewport: Record<string, number> = {},
) {
  const document = {
    schemaVersion: 3,
    id: "test",
    name: "Тестовый проект",
    address: "Тестовый адрес",
    documentRevision: 0,
    plan: {
      draft: graph,
      draftRevision: 0,
      pendingEdit: null,
      restorePoint: null,
    },
    rooms: [],
    selectedRoomId: null,
    workflow: { requestedStage: "object" },
    viewport: {
      centerX: 2500,
      centerY: 1800,
      zoom: 1,
      gridStepMm: 100,
      ...viewport,
    },
  };
  await page.addInitScript((document) => {
    if (!localStorage.getItem("plitka-projects-v3"))
      localStorage.setItem(
        "plitka-projects-v3",
        JSON.stringify({ schemaVersion: 3, projects: [document] }),
      );
    if (!location.hash) location.hash = "project/test";
  }, document);
  await page.goto("/");
  await settle(page);
  if((await page.getByRole("button",{name:"Параметры",exact:true}).textContent())?.includes(" · "))await page.getByRole("button",{name:"Параметры",exact:true}).click();
}
export function graphConflict() {
  const g: any = graphRectangle(4200, 3600);
  for (let i = 0; i < 4; i++)
    g.constraints.push({
      id: "o" + i,
      kind: "orientation",
      target: { chainId: "ac" + i },
      value: i * 90,
      fixed: true,
    });
  g.constraints.push(
    {
      id: "bottom",
      kind: "chainLength",
      target: { chainId: "ac0" },
      value: 4200,
      fixed: true,
    },
    {
      id: "top",
      kind: "chainLength",
      target: { chainId: "ac2" },
      value: 4200,
      fixed: true,
    },
  );
  return g;
}
import { createDocument } from "../../src/domain/project/migration";
import { legacyAcknowledgment } from "../../src/domain/project/legacy-v2";
import { geometryKey } from "../../src/domain/project/keys";
export function legacyV2Fixture(pending = false) {
  const d = createDocument(
      "Старый проект",
      "Адрес",
      initial,
      "test" as ReturnType<typeof crypto.randomUUID>,
    ),
    g = d.room.draft;
  const wall = g.outer.walls[0],
    a = g.outer.vertices[0],
    b = g.outer.vertices[1];
  g.constraints.push({
    id: "legacy-length",
    wallId: wall.id,
    kind: "length",
    value: Math.hypot(b.x - a.x, b.y - a.y),
    fixed: true,
  });
  const ack = legacyAcknowledgment(g);
  d.room.acknowledgment = ack;
  d.room.confirmed = {
    geometry: structuredClone(g),
    geometryKey: geometryKey(g),
    measurementKey: ack.measurementKey,
    acknowledgment: ack,
    sourceDraftRevision: 0,
  };
  d.workflow.requestedStage = "tile";
  if (pending) {
    d.room.draftRevision = 1;
    d.room.pendingEdit = {
      operation: { type: "setLength", wallId: wall.id, value: 3175.5 },
      basisGeometry: structuredClone(g),
      targetDraftRevision: 1,
    };
    g.constraints[0].value = 3175.5;
    g.fieldInputs[wall.id + ":length"] = "3175,5";
    d.workflow.requestedStage = "object";
  }
  return d;
}
export async function openV2(page: Page, d = legacyV2Fixture()) {
  await page.addInitScript((d) => {
    if (!localStorage.getItem("plitka-projects-v2"))
      localStorage.setItem(
        "plitka-projects-v2",
        JSON.stringify({ schemaVersion: 2, projects: [d] }),
      );
    if (!location.hash) location.hash = "project/test";
  }, d);
  await page.goto("/");
  await settle(page);
}

export function graphCoincident(short = false) {
  const g = graphRectangle();
  g.vertices.push({ id: "duplicate", x: short ? 5e-8 : 0, y: 0 });
  g.segments.push({
    id: "zero",
    startVertexId: "av0",
    endVertexId: "duplicate",
    chainId: "zero-chain",
  });
  g.chains.push({
    id: "zero-chain",
    startVertexId: "av0",
    endVertexId: "duplicate",
    segmentIds: ["zero"],
  });
  return g;
}
export function graphSafetyPoints() {
  return {
    vertices: [{ id: "point", x: 2500, y: 1800 }],
    segments: [],
    chains: [],
    constraints: [],
    voids: [],
    fieldInputs: {},
  };
}
export function graphSafetySolve() {
  return {
    vertices: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1000, y: 0 },
      { id: "obstacle", x: 2000, y: 0 },
      { id: "precise", x: 6000.000000005, y: 4000 },
    ],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [
      { id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"] },
    ],
    constraints: [],
    voids: [],
    fieldInputs: {},
  };
}
export async function screenPoint(page: Page, x: number, y: number) {
  return page.locator("svg[data-geometry]").evaluate(
    (svg, p) => {
      const q = new DOMPoint(p.x, -p.y).matrixTransform(
        (svg as SVGSVGElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}

export function legacySafetyPending() {
  const d: any = legacyV2Fixture(true);
  const g = {
    outer: {
      id: "outer",
      kind: "outer",
      winding: "ccw",
      closed: false,
      vertices: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 1000, y: 0 },
      ],
      walls: [{ id: "s", startVertexId: "a", endVertexId: "b" }],
    },
    holes: [
      {
        id: "isolated",
        kind: "hole",
        winding: "cw",
        closed: false,
        vertices: [{ id: "obstacle", x: 2000, y: 0 }],
        walls: [],
      },
    ],
    constraints: [],
    fieldInputs: {},
  };
  d.room.draft = structuredClone(g);
  d.room.draft.constraints = [
    { id: "length", wallId: "s", kind: "length", value: 2000, fixed: true },
  ];
  d.room.draft.fieldInputs = { "s:length": "2000" };
  d.room.pendingEdit = {
    operation: { type: "setLength", wallId: "s", value: 2000 },
    basisGeometry: g,
    targetDraftRevision: 1,
  };
  d.room.confirmed = null;
  d.room.acknowledgment = null;
  return d;
}

export function legacySafetyCoincident() {
  const d: any = legacyV2Fixture(true);
  const alter = (g: any, suffix: string) => {
    g.outer.vertices[1].x = g.outer.vertices[0].x;
    g.outer.vertices[1].y = g.outer.vertices[0].y;
    g.fieldInputs["old:" + suffix] = suffix;
  };
  alter(d.room.draft, "draft");
  alter(d.room.pendingEdit.basisGeometry, "basis");
  alter(d.room.confirmed.geometry, "confirmed");
  return d;
}

export function graphNeighbours() {
  const g = graphRectangle(2000, 2000);
  g.vertices.push(
    { id: "right0", x: 4000, y: 0 },
    { id: "right1", x: 4000, y: 2000 },
    { id: "exterior", x: 2000, y: 3000 },
    { id: "independent", x: 6000, y: 2000 },
  );
  for (const [id, startVertexId, endVertexId] of [
    ["rightBottom", "av1", "right0"],
    ["rightWall", "right0", "right1"],
    ["rightTop", "right1", "av2"],
    ["external", "av2", "exterior"],
  ]) {
    g.segments.push({ id, startVertexId, endVertexId, chainId: id + "Chain" });
    g.chains.push({
      id: id + "Chain",
      startVertexId,
      endVertexId,
      segmentIds: [id],
    });
  }
  return g;
}
export function graphRange(fixed?: boolean) {
  const g: any = {
    vertices: [0, 1000, 2000, 3000].map((x, i) => ({ id: "v" + i, x, y: 0 })),
    segments: [],
    chains: [],
    constraints: [],
    voids: [],
    fieldInputs: {},
  };
  g.vertices.push({ id: "foreign", x: 1500, y: 1000 });
  for (let i = 0; i < 3; i++)
    g.segments.push({
      id: "s" + i,
      startVertexId: "v" + i,
      endVertexId: "v" + (i + 1),
      chainId: "chain",
    });
  g.chains.push({
    id: "chain",
    startVertexId: "v0",
    endVertexId: "v3",
    segmentIds: ["s0", "s1", "s2"],
  });
  if (fixed !== undefined)
    g.constraints.push(
      {
        id: "range",
        kind: "chainLength",
        target: {
          chainId: "chain",
          range: { startVertexId: "v0", endVertexId: "v2" },
        },
        value: 2000,
        fixed,
      },
      {
        id: "full",
        kind: "chainLength",
        target: { chainId: "chain" },
        value: 3000,
        fixed: false,
      },
    );
  return g;
}
export function graphJunction() {
  const g: any = {
    vertices: [
      { id: "center", x: 2000, y: 1500 },
      { id: "east", x: 3500, y: 1500 },
      { id: "north", x: 2000, y: 3000 },
      { id: "west", x: 500, y: 1500 },
      { id: "freeA", x: 4500, y: 1000 },
      { id: "freeB", x: 5500, y: 1000 },
    ],
    segments: [],
    chains: [],
    constraints: [],
    voids: [],
    fieldInputs: {},
  };
  for (const [id, a, b] of [
    ["eastWall", "center", "east"],
    ["northWall", "center", "north"],
    ["westWall", "center", "west"],
    ["freeWall", "freeA", "freeB"],
  ]) {
    g.segments.push({
      id,
      startVertexId: a,
      endVertexId: b,
      chainId: id + "Chain",
    });
    g.chains.push({
      id: id + "Chain",
      startVertexId: a,
      endVertexId: b,
      segmentIds: [id],
    });
  }
  return g;
}
export function graphDamagedVoid() {
  const g = graphWithVoid();
  g.voids[0].boundary.pop();
  return g;
}

export async function fullGraphDocument(
  pending: "graphV3" | "legacyV2" | null = null,
) {
  const { migrateV2 } = await import("../../src/domain/plan/migration");
  const d = await migrateV2(legacyV2Fixture(pending === "legacyV2"));
  const detached = structuredClone(d.rooms[0]);
  detached.id = "detached";
  detached.topologyKey = null;
  detached.binding = "detached";
  detached.material.tile = 777;
  detached.fieldInputs.tile = "777,0";
  d.rooms.push(detached);
  d.plan.draft.fieldInputs["unrelated:raw"] = "7,5";
  d.plan.restorePoint = {
    graph: structuredClone(d.plan.draft),
    bindings: d.rooms.map((r) => ({
      roomId: r.id,
      topologyKey: r.topologyKey,
    })),
    selectedRoomId: d.selectedRoomId,
  };
  if (pending === "graphV3") {
    d.plan.draftRevision++;
    d.plan.pendingEdit = {
      kind: "graphV3",
      commandId: "pending-add",
      command: { type: "addVertex", point: { x: 7000, y: 7000 } },
      basisGraph: structuredClone(d.plan.draft),
      targetDraftRevision: d.plan.draftRevision,
    };
  }
  return d;
}
export async function openDocument(page: Page, document: unknown) {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("plitka-projects-v3"))
      localStorage.setItem(
        "plitka-projects-v3",
        JSON.stringify({ schemaVersion: 3, projects: [document] }),
      );
    if (!location.hash) location.hash = "project/test";
  }, document);
  await page.goto("/");
  await settle(page);
}
export async function clearProject(page: Page) {
  if (
    !(await page
      .getByRole("button", { name: "Очистить проект", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Очистить проект", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Очистить проект" })
    .getByRole("button", { name: "Очистить", exact: true })
    .click();
}

export async function canvasPick(
  page: Page,
  kind: "vertex" | "segment" | "room" | "void" | "constraint",
  id: string | number,
) {
  const label = {
    vertex: "Вершина",
    segment: "Стена",
    room: "Помещение",
    void: "Отверстие",
    constraint: "Условие",
  }[kind];
  const locator =
    typeof id === "number"
      ? page.getByRole("button", { name: `${label} ${id}`, exact: true })
      : page.locator("[data-target]").filter({ has: page.locator(":scope") });
  const target =
    typeof id === "number"
      ? locator
      : page.locator(`[data-target="${kind}:${id}"]`);
  await target.focus();
  await target.press("Enter");
}
export async function addPoint(page: Page, x: number, y: number) {
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  let p = await screenPoint(page, x, y);
  const size = page.viewportSize()!;
  for (
    let i = 0;
    i < 5 &&
    (p.x < 180 ||
      p.x > size.width - 30 ||
      p.y < 250 ||
      p.y > size.height - 100);
    i++
  ) {
    await page.getByRole("button", { name: "Уменьшить", exact: true }).click();
    p = await screenPoint(page, x, y);
  }
  await page.mouse.click(p.x, p.y);
  await settle(page);
}
export async function chooseAngle(
  page: Page,
  first: string,
  second: string,
  sector: "cw" | "ccw",
) {
  await page.getByRole("button", { name: "Угол", exact: true }).click();
  await canvasPick(page, "segment", first);
  await canvasPick(page, "segment", second);
  const arc = page.getByRole("button", {
    name:
      sector === "ccw"
        ? "Дуга против часовой стрелки"
        : "Дуга по часовой стрелке",
    exact: true,
  });
  await arc.focus();
  await arc.press("Enter");
}

/** Isolated migration fixture; seed once so reload can detect resurrection. */
export async function deletionProjects(page: Page, count = 2) {
  await page.addInitScript(({ plan, count }) => {
    if (localStorage.getItem('delete-fixture-seeded')) return;
    localStorage.setItem('delete-fixture-seeded', 'yes');
    localStorage.setItem('plitka-projects-v1', JSON.stringify(
      Array.from({ length: count }, (_, i) => ({ id: `delete-${i}`, name: 'Одинаковое имя', address: `Адрес ${i}`, plan }))));
  }, { plan: initial, count });
  await page.goto('/');
  await expect(page.locator('.project-row')).toHaveCount(count);
}
export async function projectCatalog(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v3')!));
}
export async function openDelete(page: Page, row = 0) {
  await page.locator('.project-row').nth(row).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  return page.getByRole('dialog', { name: 'Удалить проект', exact: true });
}
export async function deleteFromEditor(page: Page) {
  if (!await page.getByRole('button', { name: 'Удалить проект', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить проект', exact: true }).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
}
export async function holdProjectWrites(page: Page) {
  await page.evaluate(() => {
    (window as any).deleteLockReady = false;
    void navigator.locks.request('plitka-projects-write', async () => {
      (window as any).deleteLockReady = true;
      await new Promise<void>(resolve => { (window as any).releaseDeleteLock = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).deleteLockReady)).toBe(true);
}
