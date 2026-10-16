import { addPoint, canvasPick } from "./fixtures/projects";
import { test, expect } from "@playwright/test";
import {
  openProject,
  openGraph,
  commit,
  settle,
  stored,
  confirmRoom,
  graphRectangle,
  graphTwoRooms,
  graphWithVoid,
  graphCommand,
  graphValidate,
} from "./fixtures/projects";

test("only the selected wall shows three handles and obsolete controls stay hidden", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await expect(page.locator(".graph-vertex")).toHaveCount(0);
  await expect(page.locator("[data-wall-handle]")).toHaveCount(0);
  for (const label of ["Добавить вершину", "Переместить вершину", "Соединить стены", "Угол", "Увеличить", "Уменьшить", "Скачать проект", "Открыть файл"])
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  await canvasPick(page, "segment", "as0");
  await expect(page.locator("[data-wall-handle]")).toHaveCount(3);
  await expect(page.locator(".snap-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await expect(page.locator("[data-wall-handle]")).toHaveCount(0);
});

test("wall end and center handles expose four keyboard reachable one millimeter arrows", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await canvasPick(page, "segment", "as0");
  for (const handle of ["start", "center", "end"] as const) {
    await page.locator(`[data-wall-handle="${handle}"]`).click();
    const label = handle === "center" ? "стену" : "точку стены";
    for (const direction of ["←", "→", "↑", "↓"]) {
      const button = page.getByRole("button", { name: `Сдвинуть ${label} ${direction} на 1 мм` });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.focus();
      await expect(button).toBeFocused();
    }
  }
  await page.getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" }).press("Enter");
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: { id: string }) => v.id === "av1")?.x).toBe(4001);
});

test("graph API derives rooms and preserves independent points", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (graph) => {
    const r = await fetch("/api/plan/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 4,
        requestId: "test-validate",
        draftRevision: 0,
        basisKey: "basis",
        graph,
      }),
    });
    return { status: r.status, data: await r.json() };
  }, graphTwoRooms());
  expect(result.status).toBe(200);
  expect(result.data.faces).toHaveLength(2);
  expect(result.data.faces.every((f: any) => f.validation.valid)).toBeTruthy();
  expect(result.data.graph.vertices).toHaveLength(9);
});
test("graph API explicit hole excludes inner room", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (graph) =>
      (
        await fetch("/api/plan/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 4,
            requestId: "hole-test",
            draftRevision: 0,
            basisKey: "basis",
            graph,
          }),
        })
      ).json(),
    graphWithVoid(),
  );
  expect(result.faces).toHaveLength(1);
  expect(result.faces[0].areaMm2).toBe(10950000);
  expect(result.faces[0].validation.valid).toBeTruthy();
});
test("graph command adds independent vertex on closed plan", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (graph) => {
    const r = await fetch("/api/plan/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 4,
        commandId: "add-test",
        draftRevision: 1,
        basisKey: "basis",
        graph,
        command: { type: "addVertex", point: { x: 1000, y: 1000 } },
      }),
    });
    return { status: r.status, data: await r.json() };
  }, graphRectangle());
  expect(result.status).toBe(200);
  expect(result.data.status).toBe("applied");
  expect(result.data.graph.vertices).toHaveLength(5);
  expect(result.data.graph.segments).toHaveLength(4);
});

test("graph splits measured wall and preserves total", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async (graph) => {
    async function command(g: any, c: any, id: string) {
      const r = await fetch("/api/plan/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 4,
          commandId: id,
          draftRevision: 1,
          basisKey: "test",
          graph: g,
          command: c,
        }),
      });
      return r.json();
    }
    graph.vertices.push({ id: "free-tip", x: 1500, y: -1000 });
    (graph.constraints as any[]).push({
      id: "total",
      kind: "chainLength",
      target: { chainId: "ac0" },
      value: 4000,
      fixed: true,
    });
    const a = await command(
      graph,
      {
        type: "connect",
        thicknessMm: 100,
        fromVertexId: "free-tip",
        to: { segmentId: "as0", point: { x: 1500, y: 0 } },
      },
      "split-test",
    );
    const first = a.graph.chains.find((c: any) => c.id === "ac0").segmentIds[0];
    const b = await command(
      a.graph,
      {
        type: "setLength",
        constraintId: "part",
        target: { kind: "segment", id: first },
        value: 1500,
      },
      "part-test",
    );
    return { a, b };
  }, graphRectangle());
  expect(result.a.status).toBe("applied");
  expect(
    result.a.graph.chains.find((c: any) => c.id === "ac0").segmentIds,
  ).toHaveLength(2);
  expect(result.b.status).toBe("applied");
  expect(
    result.b.graph.constraints.find((c: any) => c.id === "total").value,
  ).toBe(4000);
  const ms = result.b.measurements.filter(
    (m: any) => m.kind === "segmentLength",
  );
  expect(ms.some((m: any) => Math.abs(m.value - 2500) < 0.1)).toBeTruthy();
});

test("graph measured 4000 wall solves 1500 segment and resplit retains range", async ({
  page,
}) => {
  await page.goto("/");
  const g: any = graphRectangle();
  g.vertices.push({ id: "tip", x: 2000, y: -1000 });
  g.constraints.push({
    id: "total",
    kind: "chainLength",
    target: { chainId: "ac0" },
    value: 4000,
    fixed: true,
  });
  let r = await graphCommand(page, g, {
    type: "connect",
        thicknessMm: 100,
    fromVertexId: "tip",
    to: { segmentId: "as0", point: { x: 2000, y: 0 } },
  });
  expect(r.status).toBe("applied");
  const sid = r.graph.chains[0].segmentIds[0];
  r = await graphCommand(page, r.graph, {
    type: "setLength",
    constraintId: "part",
    target: { kind: "segment", id: sid },
    value: 1500,
  });
  expect(r.status).toBe("applied");
  expect(
    r.measurements.find((m: any) => m.target.segmentId === sid).value,
  ).toBeCloseTo(1500, 1);
  expect(
    r.measurements.some(
      (m: any) => m.kind === "segmentLength" && Math.abs(m.value - 2500) < 0.1,
    ),
  ).toBeTruthy();
  r.graph.vertices.push({ id: "tip2", x: 500, y: -1000 });
  r = await graphCommand(page, r.graph, {
    type: "connect",
        thicknessMm: 100,
    fromVertexId: "tip2",
    to: { segmentId: sid, point: { x: 500, y: 0 } },
  });
  expect(r.status).toBe("applied");
  expect(
    r.graph.constraints.find((c: any) => c.id === "part").target.range,
  ).toBeTruthy();
  expect(r.graph.constraints.find((c: any) => c.id === "part").value).toBe(
    1500,
  );
});
test("graph multiple crossing nodes and deterministic replay", async ({
  page,
}) => {
  await page.goto("/");
  const g: any = graphRectangle();
  g.vertices.push(
    { id: "left", x: -1000, y: 1500 },
    { id: "right", x: 5000, y: 1500 },
  );
  const c = {
    type: "connect",
        thicknessMm: 100,
    fromVertexId: "left",
    to: { vertexId: "right" },
  };
  const a = await graphCommand(page, g, c, "replay"),
    b = await graphCommand(page, g, c, "replay");
  expect(a.status).toBe("applied");
  expect(a.graph).toEqual(b.graph);
  expect(a.faces).toHaveLength(2);
  expect(Object.keys(a.splitMap)).toEqual(
    expect.arrayContaining(["as1", "as3"]),
  );
  expect(a.graph.vertices).toHaveLength(8);
});
test("graph rectangle and parallelogram preserve physical area", async ({
  page,
}) => {
  await page.goto("/");
  const rectangle = await graphValidate(page, graphRectangle(4200, 3600));
  expect(rectangle.faces[0].areaMm2 / 1e6).toBeCloseTo(14.35, 6);
  const g = graphRectangle();
  g.vertices[2] = { ...g.vertices[2], x: 5500, y: 1500 * Math.sqrt(3) };
  g.vertices[3] = { ...g.vertices[3], x: 1500, y: 1500 * Math.sqrt(3) };
  const r = await graphValidate(page, g);
  expect(r.faces[0].validation.valid).toBeTruthy();
  expect(r.faces[0].areaMm2 / 1e6).toBeCloseTo(9.703852, 3);
});
test("graph conflicts retain desired values and can repair another constraint", async ({
  page,
}) => {
  await page.goto("/");
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
  const bad = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "bottom",
    target: { kind: "chain", id: "ac0" },
    value: 4300,
  });
  expect(bad.status).toBe("unresolved");
  expect(bad.graph.vertices).toEqual(g.vertices);
  expect(bad.graph.constraints.find((c: any) => c.id === "bottom").value).toBe(
    4300,
  );
  const fixed = await graphCommand(page, bad.graph, {
    type: "setLength",
    constraintId: "top",
    target: { kind: "chain", id: "ac2" },
    value: 4300,
  });
  expect(fixed.status).toBe("applied");
  expect(
    fixed.measurements
      .filter(
        (m: any) =>
          m.kind === "chainLength" && ["ac0", "ac2"].includes(m.target.chainId),
      )
      .every((m: any) => Math.abs(m.value - 4300) <= 0.1),
  ).toBeTruthy();
});
test("graph scope tolerates independent invalid draft", async ({ page }) => {
  await page.goto("/");
  const g: any = graphTwoRooms();
  g.constraints.push({
    id: "bad",
    kind: "chainLength",
    target: { chainId: "bc0" },
    value: -5,
    fixed: true,
  });
  const r = await graphValidate(page, g);
  expect(r.faces.filter((f: any) => f.validation.valid)).toHaveLength(1);
  const solved = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "good",
    target: { kind: "chain", id: "ac0" },
    value: 4200,
  });
  expect(solved.status).toBe("applied");
});
test("graph invalid topology and malformed envelope are diagnosed", async ({
  page,
}) => {
  await page.goto("/");
  const g: any = graphRectangle();
  g.vertices[1].x = 0;
  const r = await graphValidate(page, g);
  expect(r.status).toBe("invalid");
  expect(r.issues.length).toBeGreaterThan(0);
  g.segments[0].startVertexId = "missing";
  const bad = await graphValidate(page, g);
  expect(bad.http).toBe(422);
});
test("correcting invalid raw dimension solves and keeps decimal comma", async ({
  page,
}) => {
  await openProject(page);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", 1);
  await commit(page, "Общая длина стены", "ошибка");
  await settle(page);
  await commit(page, "Общая длина стены", "3175,5");
  await expect
    .poll(async () => (await stored(page)).plan.pendingEdit)
    .toBeNull();
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("3175,5");
  expect(
    (await stored(page)).plan.draft.constraints.some(
      (c: any) => c.value === 3175.5,
    ),
  ).toBeTruthy();
});
test("graph solves measured parallelogram and directed 270 degree sector", async ({
  page,
}) => {
  await page.goto("/");
  const g: any = graphRectangle();
  for (let i = 0; i < 4; i++)
    g.constraints.push(
      {
        id: "l" + i,
        kind: "chainLength",
        target: { chainId: "ac" + i },
        value: i % 2 ? 3000 : 4000,
        fixed: true,
      },
      {
        id: "angle" + i,
        kind: "angle",
        target: {
          vertexId: "av" + i,
          firstSegmentId: "as" + ((i + 3) % 4),
          secondSegmentId: "as" + i,
          sector: "cw",
        },
        value: i % 2 ? 120 : 60,
        fixed: true,
      },
    );
  g.constraints.push({
    id: "orientation",
    kind: "orientation",
    target: { chainId: "ac0" },
    value: 0,
    fixed: true,
  });
  const r = await graphCommand(page, g, { type: "reconcile" });
  expect(r.status).toBe("applied");
  expect(r.faces[0].areaMm2 / 1e6).toBeCloseTo(9.703852, 3);
  const angle = await graphCommand(page, graphRectangle(), {
    type: "setAngle",
    constraintId: "reflex",
    vertexId: "av1",
    firstSegmentId: "as0",
    secondSegmentId: "as1",
    sector: "ccw",
    value: 270,
  });
  expect(angle.status).toBe("applied");
  expect(
    angle.measurements.find(
      (m: any) => m.target.sector === "ccw" && m.target.vertexId === "av1",
    ).value,
  ).toBeCloseTo(270, 1);
});
test("free wall keeps anchor and direction and release repairs conflict", async ({
  page,
}) => {
  await page.goto("/");
  const g = graphRectangle(3000, 1000);
  g.vertices = g.vertices.slice(0, 2);
  g.segments = g.segments.slice(0, 1);
  g.chains = g.chains.slice(0, 1);
  const r = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "length",
    target: { kind: "chain", id: "ac0" },
    value: 3500,
  });
  expect(r.status).toBe("applied");
  expect(r.graph.vertices).toEqual([
    { id: "av0", x: 0, y: 0 },
    { id: "av1", x: 3500, y: 0 },
  ]);
  r.graph.constraints.push({
    id: "bad",
    kind: "segmentLength",
    target: { segmentId: "as0" },
    value: 3400,
    fixed: true,
  });
  const released = await graphCommand(page, r.graph, {
    type: "releaseConstraint",
    constraintId: "bad",
  });
  expect(released.status).toBe("applied");
  const reconciled = await graphCommand(page, released.graph, {
    type: "reconcile",
  });
  expect(reconciled.status).toBe("applied");
});
import {
  graphCoincident,
  graphSafetyPoints,
  graphSafetySolve,
  screenPoint,
} from "./fixtures/projects";

test("safety API rejects explicit duplicate, preserves nearby independent coordinate", async ({
  page,
}) => {
  await page.goto("/");
  const g = graphSafetyPoints();
  const r = await graphCommand(page, g, {
    type: "addVertex",
    point: { x: 2500, y: 1800 },
  });
  expect(r.status).toBe("invalid");
  expect(r.graph).toEqual(g);
  expect(
    r.issues.some(
      (i: any) =>
        i.code === "coincident_vertices" && i.entityIds.includes("point"),
    ),
  ).toBeTruthy();
  const near = await graphCommand(page, g, {
    type: "addVertex",
    point: { x: 2500.00000005, y: 1800 },
  });
  expect(near.status).toBe("applied");
  expect(near.graph.vertices).toHaveLength(2);
});
for (const short of [false, true])
  test(`safety diagnostic distinguishes ${short ? "short" : "coincident"} wall`, async ({
    page,
  }) => {
    const g = graphCoincident(short);
    await openGraph(page, g);
    const r = await graphValidate(page, g);
    expect(r.graph).toEqual(g);
    expect(r.issues.find((i: any) => i.code === "zero_wall").entityIds).toEqual(
      ["zero", "av0", "duplicate"],
    );
    const card = page
      .locator(".geometry-issues")
      .getByRole("button")
      .filter({
        hasText: short
          ? "Длина стены слишком мала"
          : "Координаты концов стены совпадают",
      })
      .first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByLabel("Вершина", { exact: true })).toHaveCount(0);
    await expect(page.locator(".canvas-panel").getByLabel("Стена", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-diagnostic-vertex]")).toHaveCount(0);
    await expect(page.locator('[data-diagnostic-wall="zero"]')).toHaveCount(1);
    expect((await stored(page)).plan.draft).toEqual(g);
    if (short)
      expect(
        r.issues.some((i: any) => i.code === "coincident_vertices"),
      ).toBeFalsy();
    else
      await page.screenshot({
        path: "/tmp/plitka-safety-diagnostic-desktop.png",
      });
  });

for (const shape of ["rectangle", "lShape"])
  test(`safety ${shape} collision rejects whole template`, async ({ page }) => {
    await page.goto("/");
    const g = graphSafetyPoints();
    const r = await graphCommand(page, g, {
      type: "addTemplate",
      thicknessMm: 100,
      shape,
      origin: { x: 2500, y: 1800 },
      width: 1000,
      height: 1000,
      notchWidth: 300,
      notchHeight: 300,
    });
    expect(r.status).toBe("invalid");
    expect(r.graph).toEqual(g);
    expect(r.addedIds).toEqual([]);
  });

test("safety move and length refuse disconnected collision without rounding outsiders", async ({
  page,
}) => {
  await page.goto("/");
  const g = graphSafetySolve();
  const moved = await graphCommand(page, g, {
    type: "moveVertex",
    vertexId: "b",
    point: { x: 2000, y: 0 },
  });
  expect(moved.status).toBe("invalid");
  expect(moved.graph).toEqual(g);
  expect(
    moved.issues.some(
      (i: any) =>
        i.code === "coincident_vertices" && i.entityIds.includes("obstacle"),
    ),
  ).toBeTruthy();
  const length = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "length",
    target: { kind: "chain", id: "c" },
    value: 2000,
  });
  expect(length.status).toBe("unresolved");
  expect(length.graph.vertices).toEqual(g.vertices);
  expect(length.graph.constraints[0].value).toBe(2000);
  const ok = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "length",
    target: { kind: "chain", id: "c" },
    value: 1500,
  });
  expect(ok.status).toBe("applied");
  expect(ok.graph.vertices.find((v: any) => v.id === "precise")).toEqual(
    g.vertices[3],
  );
});





test("safety three exact pairs, signed zero, old repairs and independent component edits", async ({
  page,
}) => {
  await page.goto("/");
  const g = graphSafetySolve();
  g.vertices.push({ id: "d", x: 0, y: -0 }, { id: "e", x: -0, y: 0 });
  const r = await graphValidate(page, g);
  expect(
    r.issues.filter((i: any) => i.code === "coincident_vertices"),
  ).toHaveLength(3);
  const duplicate = await graphCommand(page, g, {
    type: "addVertex",
    point: { x: -0, y: 0 },
  });
  expect(duplicate.status).toBe("invalid");
  expect(duplicate.graph).toEqual(JSON.parse(JSON.stringify(g)));
  const repaired = await graphCommand(page, g, {
    type: "moveVertex",
    vertexId: "d",
    point: { x: -100, y: 100 },
  });
  expect(repaired.status).toBe("applied");
  const deleted = await graphCommand(page, repaired.graph, {
    type: "deleteElements",
    vertexIds: ["e"],
    segmentIds: [],
    acknowledgedConstraintIds: [],
  });
  expect(deleted.status).toBe("applied");
  expect(
    deleted.issues.some((i: any) => i.code === "coincident_vertices"),
  ).toBeFalsy();
  const unrelated = await graphCommand(page, g, {
    type: "moveVertex",
    vertexId: "precise",
    point: { x: 7000.000000005, y: 4000 },
  });
  expect(unrelated.status).toBe("applied");
  expect(unrelated.graph.vertices.slice(0, 3)).toEqual(g.vertices.slice(0, 3));
  const newPair = await graphCommand(page, g, {
    type: "moveVertex",
    vertexId: "b",
    point: { x: 2000, y: 0 },
  });
  expect(newPair.status).toBe("invalid");
  expect(newPair.graph).toEqual(JSON.parse(JSON.stringify(g)));
});

test("safety ambiguous junction rejects all splits without merging old vertices", async ({
  page,
}) => {
  await page.goto("/");
  const g = graphSafetySolve();
  g.vertices.push(
    { id: "j1", x: 500, y: 0 },
    { id: "j2", x: 500, y: 0 },
    { id: "from", x: 500, y: 1000 },
  );
  const r = await graphCommand(page, g, {
    type: "connect",
        thicknessMm: 100,
    fromVertexId: "from",
    to: { segmentId: "s", point: { x: 500, y: 0 } },
  });
  expect(r.status).toBe("invalid");
  expect(r.graph).toEqual(g);
  expect(r.splitMap).toEqual({});
  expect(r.addedIds).toEqual([]);
  expect(
    r.issues.find((i: any) => i.code === "ambiguous_junction").entityIds,
  ).toEqual(["j1", "j2"]);
  const unique = structuredClone(g);
  unique.vertices = unique.vertices.filter((v) => v.id !== "j2");
  const good = await graphCommand(page, unique, {
    type: "connect",
        thicknessMm: 100,
    fromVertexId: "from",
    to: { segmentId: "s", point: { x: 500, y: 0 } },
  });
  expect(good.status).toBe("applied");
  expect(
    good.graph.vertices
      .filter((v: any) => v.x === 500 && v.y === 0)
      .map((v: any) => v.id),
  ).toEqual(["j1"]);
});

for (const mode of [
  "setOrientation",
  "releaseConstraint",
  "reconcile",
  "setAngle",
])
  test(`safety ${mode} rejects collision after solver normalization`, async ({
    page,
  }) => {
    await page.goto("/");
    const g: any = graphSafetySolve();
    g.vertices[1].x = 1000.000000005;
    g.vertices[2].x = 1000;
    let command: any = { type: mode };
    if (mode === "setOrientation")
      command = { type: mode, chainId: "c", constraintId: "o", value: 0 };
    if (mode === "releaseConstraint") {
      g.constraints.push({
        id: "l",
        kind: "chainLength",
        target: { chainId: "c" },
        value: 1000,
        fixed: true,
      });
      command.constraintId = "l";
    }
    if (mode === "setAngle") {
      g.vertices.push({ id: "tip", x: 1000.000000005, y: 1000 });
      g.segments.push({
        id: "s2",
        startVertexId: "b",
        endVertexId: "tip",
        chainId: "c2",
      });
      g.chains.push({
        id: "c2",
        startVertexId: "b",
        endVertexId: "tip",
        segmentIds: ["s2"],
        thicknessMm: 100,
      });
      command = {
        type: mode,
        constraintId: "angle",
        vertexId: "b",
        firstSegmentId: "s",
        secondSegmentId: "s2",
        sector: "cw",
        value: 90,
      };
    }
    const r = await graphCommand(page, g, command);
    expect(r.status).toBe("unresolved");
    expect(r.graph.vertices).toEqual(g.vertices);
    expect(
      r.issues.some(
        (i: any) =>
          i.code === "coincident_vertices" && i.entityIds.includes("obstacle"),
      ),
    ).toBeTruthy();
    if (mode === "releaseConstraint")
      expect(r.graph.constraints[0].fixed).toBe(false);
  });

test("safety diagnostic selection cannot delete neighbors and explicit wall deletion is safe", async ({
  page,
}) => {
  const g = graphCoincident();
  await openGraph(page, g);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "zero");
  await page
    .locator(".geometry-issues")
    .getByRole("button")
    .filter({ hasText: "Координаты концов стены совпадают" })
    .click();
  await expect(
    page.getByRole("button", { name: /Удалить (стену|вершину)/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "zero");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Удалить (стену|вершину)/ }).click();
  await settle(page);
  const d = await stored(page);
  expect(d.plan.draft.vertices).toEqual(g.vertices);
  expect(d.plan.draft.segments).toEqual(
    g.segments.filter((s) => s.id !== "zero"),
  );
  await expect(page.locator("[data-diagnostic-vertex]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(g);
});



test("context direct canvas selection replaces lists and presets; deleting closes the panel", async ({
  page,
}) => {
  await openGraph(page, graphRectangle());
  await expect(page.locator(".canvas-panel").getByLabel("Стена", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Вершина", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Прямоугольник", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Стена 1", exact: true }).click();
  await expect(page.getByLabel("Длина участка", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Удалить стену", exact: true })
    .click();
  await settle(page);
  await expect(page.getByLabel("Длина участка", { exact: true })).toHaveCount(
    0,
  );
});

import { graphRange, graphJunction } from "./fixtures/projects";
for (const fixed of [true, false])
  test(`context range canonical reverse pair reuses ${fixed ? "fixed" : "released"} constraint`, async ({
    page,
  }) => {
    await openGraph(page, graphRange(fixed));
    await page.getByRole("button", { name: "Стена 1", exact: true }).click();
    await page
      .getByRole("button", { name: "Выбрать диапазон", exact: true })
      .click();
    await canvasPick(page, "vertex", "v2");
    await canvasPick(page, "vertex", "v0");
    await commit(page, "Длина диапазона", "2200,5");
    await settle(page);
    const graph = (await stored(page)).plan.draft;
    expect(graph.constraints.filter((c: any) => c.target.range)).toHaveLength(
      1,
    );
    expect(graph.constraints.find((c: any) => c.id === "range").value).toBe(
      2200.5,
    );
    expect(
      graph.constraints.find((c: any) => c.id === "range").target.range,
    ).toEqual({ startVertexId: "v0", endVertexId: "v2" });
    expect(graph.vertices[0].x).toBe(0);
    expect(graph.constraints.find((c: any) => c.id === "full").value).toBe(
      3000,
    );
  });




for (const width of [375, 1440])
  test(`context accessible canvas and dialogs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openGraph(page, graphJunction());
    const before = await stored(page);
    await canvasPick(page, "segment", "northWall");
    await page.locator('[data-wall-handle="center"]').click();
    const arrow = page.getByRole("button", { name: "Сдвинуть стену → на 1 мм" });
    await arrow.focus();
    await expect(arrow).toBeFocused();
    await page.keyboard.press("Escape");
    expect((await stored(page)).plan).toEqual(before.plan);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Проект", exact: true }).click();
    await page
      .getByRole("button", { name: "Очистить проект", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Очистить проект" });
    await expect(
      dialog.getByRole("button", { name: "Отмена", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Очистить", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: `/tmp/plitka-context-${width}.png` });
  });





test("context range keyboard rejects repeated endpoint and cancels without a document edit", async ({
  page,
}) => {
  await openGraph(page, graphRange());
  const before = await stored(page);
  await canvasPick(page, "segment", "s0");
  await page
    .getByRole("button", { name: "Выбрать диапазон", exact: true })
    .click();
  await canvasPick(page, "vertex", "v0");
  await canvasPick(page, "vertex", "v0");
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveCount(
    0,
  );
  const first = page.locator('[data-target="vertex:v0"]');
  await first.focus();
  await first.press("ArrowRight");
  await expect(page.locator('[data-target="vertex:v1"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByLabel("Длина диапазона", { exact: true }).focus();
  await expect(
    page.getByLabel("Длина диапазона", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveCount(
    0,
  );
  expect((await stored(page)).plan).toEqual(before.plan);
  await expect(
    page.getByRole("button", { name: "Отменить правку", exact: true }),
  ).toBeDisabled();
});





test("context dimension focus identifies the full chain without moving geometry", async ({
  page,
}) => {
  await openGraph(page, graphRange());
  const before = await stored(page);
  await canvasPick(page, "segment", "s0");
  await page.getByLabel("Общая длина стены", { exact: true }).focus();
  await expect(page.locator(".graph-wall.selected")).toHaveCount(3);
  await page.getByLabel("Длина участка", { exact: true }).focus();
  await expect(page.locator(".graph-wall.selected")).toHaveCount(1);
  expect((await stored(page)).plan).toEqual(before.plan);
});

test("context range closes when explicit restoration removes its chain", async ({
  page,
}) => {
  const { fullGraphDocument, openDocument } = await import(
    "./fixtures/projects"
  );
  const d = await fullGraphDocument();
  d.plan.draft = graphRange();
  d.rooms = [];
  d.selectedRoomId = null;
  d.workflow.requestedStage = "object";
  d.plan.restorePoint = {
    graph: {
      vertices: [],
      segments: [],
      chains: [],
      constraints: [],
      voids: [],
      fieldInputs: {},
    },
    bindings: [],
    selectedRoomId: null,
  };
  await openDocument(page, d);
  await canvasPick(page, "segment", "s0");
  await page
    .getByRole("button", { name: "Выбрать диапазон", exact: true })
    .click();
  await canvasPick(page, "vertex", "v0");
  await canvasPick(page, "vertex", "v2");
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Вернуть план к сохранённому снимку",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Восстановить план", exact: true })
    .click();
  await settle(page);
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveCount(
    0,
  );
  expect((await stored(page)).plan.draft.vertices).toEqual([]);
});
