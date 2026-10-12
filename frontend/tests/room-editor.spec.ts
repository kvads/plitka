import { chooseAngle } from "./fixtures/projects";
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
test("graph API derives rooms and preserves independent points", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (graph) => {
    const r = await fetch("/api/plan/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 3,
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
            schemaVersion: 3,
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
  expect(result.faces[0].areaMm2).toBe(11750000);
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
        schemaVersion: 3,
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
          schemaVersion: 3,
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
test("graph UI numeric vertices persist and connect explicitly", async ({
  page,
}) => {
  await openProject(page);
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  await addPoint(page, 6000, 1000);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("plitka-projects-v3")!).projects[0]
            .plan.draft.vertices.length,
      ),
    )
    .toBe(5);
  await page.reload();
  await expect(page.locator('[data-target^="vertex:"]')).toHaveCount(5);
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", 1);
  await canvasPick(page, "vertex", 5);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("plitka-projects-v3")!).projects[0]
            .plan.draft.segments.length,
      ),
    )
    .toBeGreaterThan(4);
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
  expect(rectangle.faces[0].areaMm2 / 1e6).toBeCloseTo(15.12, 6);
  const g = graphRectangle();
  g.vertices[2] = { ...g.vertices[2], x: 5500, y: 1500 * Math.sqrt(3) };
  g.vertices[3] = { ...g.vertices[3], x: 1500, y: 1500 * Math.sqrt(3) };
  const r = await graphValidate(page, g);
  expect(r.faces[0].validation.valid).toBeTruthy();
  expect(r.faces[0].areaMm2 / 1e6).toBeCloseTo(10.392305, 3);
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
  expect(r.faces[0].areaMm2 / 1e6).toBeCloseTo(10.392305, 3);
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
test("angle raw comma survives successful solve and reload", async ({
  page,
}) => {
  await openGraph(page, graphRectangle());
  await chooseAngle(page, "as0", "as1", "cw");
  await commit(page, "Угол между стенами", "60,5");
  await expect
    .poll(async () => (await stored(page)).plan.pendingEdit)
    .toBeNull();
  await expect(
    page.getByLabel("Угол между стенами", { exact: true }),
  ).toHaveValue("60,5");
  await settle(page);
  await page.reload();
  await settle(page);
  await chooseAngle(page, "as0", "as1", "cw");
  await expect(
    page.getByLabel("Угол между стенами", { exact: true }),
  ).toHaveValue("60,5");
});
test("split and merge detach records and never inherit confirmation", async ({
  page,
}) => {
  const g: any = graphRectangle();
  g.vertices.push(
    { id: "left", x: 0, y: 1500 },
    { id: "right", x: 4000, y: 1500 },
  );
  await openGraph(page, g);
  await confirmRoom(page);
  await settle(page);
  const old = (await stored(page)).selectedRoomId;
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", "left");
  await canvasPick(page, "vertex", "right");

  await settle(page);
  const split = await stored(page);
  expect(split.selectedRoomId).toBeNull();
  expect(split.rooms.find((r: any) => r.id === old).binding).toBe("detached");
  expect(split.rooms.filter((r: any) => r.binding === "attached")).toHaveLength(
    2,
  );
  const partition = split.plan.draft.segments.find(
    (s: any) => s.startVertexId === "left" && s.endVertexId === "right",
  );
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", partition.id);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Удалить (стену|вершину)/ }).click();
  await settle(page);
  const merged = await stored(page);
  expect(
    merged.rooms.filter((r: any) => r.binding === "attached"),
  ).toHaveLength(1);
  expect(
    merged.rooms.find((r: any) => r.binding === "attached").confirmed,
  ).toBeNull();
  expect(merged.rooms.find((r: any) => r.id === old).binding).toBe("detached");
});
test("deleting constrained vertex previews and removes incident conditions", async ({
  page,
}) => {
  const g: any = graphRectangle();
  g.constraints.push({
    id: "total",
    kind: "chainLength",
    target: { chainId: "ac0" },
    value: 4000,
    fixed: true,
  });
  await openGraph(page, g);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "vertex", "av0");
  page.on("dialog", async (d) => {
    expect(d.message()).toContain("4000");
    await d.accept();
  });
  await page.getByRole("button", { name: /Удалить (стену|вершину)/ }).click();
  await settle(page);
  const d = await stored(page);
  expect(d.plan.pendingEdit).toBeNull();
  expect(d.plan.draft.vertices).toHaveLength(3);
  expect(d.plan.draft.constraints).toHaveLength(0);
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
    await expect(page.getByLabel("Стена", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-diagnostic-vertex]")).toHaveCount(2);
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

for (const zoom of [0.5, 1, 2])
  test(`safety rings stay 12 CSS pixels zoom ${zoom}`, async ({ page }) => {
    await openGraph(page, graphSafetyPoints(), { zoom });
    await page
      .getByRole("button", { name: "Добавить вершину", exact: true })
      .click();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const ring = page.locator('[data-safety-vertex="point"]');
      // Chromium's boundingBox includes the non-scaling stroke; measure the circle itself.
      const diameter = () =>
        ring.evaluate((el) => {
          const c = el as SVGCircleElement;
          return 2 * c.r.baseVal.value * c.getScreenCTM()!.a;
        });
      await expect.poll(diameter).toBeCloseTo(24, 4);
      if (width === 1440 && zoom === 1)
        await page.screenshot({ path: "/tmp/plitka-safety-zone-desktop.png" });
      await page
        .getByRole("button", { name: "Увеличить", exact: true })
        .click();
      await expect.poll(diameter).toBeCloseTo(24, 4);
    }
    await page.getByRole("button", { name: "Выбрать", exact: true }).click();
    await expect(page.locator("[data-safety-vertex]")).toHaveCount(0);
  });

for (const pointerType of ["mouse", "touch", "pen"])
  test(`safety ${pointerType} checks snapped 11/12/13 pixel boundary`, async ({
    page,
  }) => {
    // World points are on the horizontal grid axis; no nearby vertical grid line.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGraph(page, graphSafetyPoints(), { gridStepMm: 1000 });
    await page
      .getByRole("button", { name: "Добавить вершину", exact: true })
      .click();
    const svg = page.getByRole("group", { name: "Редактор плана помещений" });
    const center = await screenPoint(page, 2500, 1800);
    const before = await stored(page);
    let commands = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/plan/command")) commands++;
    });
    for (const d of [11, 12]) {
      await svg.dispatchEvent("pointerdown", {
        pointerId: 1,
        pointerType,
        button: 0,
        clientX: center.x + d,
        clientY: center.y,
      });
      await svg.dispatchEvent("pointerup", {
        pointerId: 1,
        pointerType,
        button: 0,
        clientX: center.x + d,
        clientY: center.y,
      });
      await expect(page.getByRole("alert")).toContainText(/вершине|вершина/);
      expect((await stored(page)).plan).toEqual(before.plan);
      expect(commands).toBe(0);
    }
    await svg.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType,
      button: 0,
      clientX: center.x + 13,
      clientY: center.y,
    });
    await svg.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType,
      button: 0,
      clientX: center.x + 13,
      clientY: center.y,
    });
    await expect
      .poll(async () => (await stored(page)).plan.draft.vertices.length)
      .toBe(2);
    expect(commands).toBe(1);
  });

for (const shape of ["rectangle", "lShape"])
  test(`safety ${shape} collision rejects whole template`, async ({ page }) => {
    await page.goto("/");
    const g = graphSafetyPoints();
    const r = await graphCommand(page, g, {
      type: "addTemplate",
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

test("safety snapping decides placement before distance and zoom permits closer points", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const g = graphSafetyPoints();
  g.vertices = [
    { id: "point", x: 2500, y: 1850 },
    { id: "inverse", x: 2535, y: 1000 },
  ];
  await openGraph(page, g, { zoom: 1.25 });
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  const c = await screenPoint(page, 2500, 1850);
  const before = await stored(page);
  // Raw distance 13, snaps to (2500,1900), distance 10.
  await page.mouse.click(c.x + 5, c.y - 12);
  await expect(page.getByRole("alert")).toContainText("близко");
  expect((await stored(page)).plan).toEqual(before.plan);
  // Raw distance 9 from the second vertex, snaps to (2600,1000), distance 13.
  const inverse = await screenPoint(page, 2580, 1000);
  await page.mouse.click(inverse.x, inverse.y);
  await expect
    .poll(async () => (await stored(page)).plan.draft.vertices.length)
    .toBe(3);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  // At the larger zoom, the same world position (2500,1900) is > 12 px away.
  await page.getByRole("button", { name: "Увеличить", exact: true }).click();
  const next = await screenPoint(page, 2500, 1900);
  await page.mouse.click(next.x, next.y);
  await expect
    .poll(async () => (await stored(page)).plan.draft.vertices.length)
    .toBe(3);
  expect((await stored(page)).plan.draft.vertices[2]).toMatchObject({
    x: 2500,
    y: 1900,
  });
});

test("safety overlapping zones choose a stable nearest id and numeric entry ignores pixel radius", async ({
  page,
}) => {
  const g = graphSafetyPoints();
  g.vertices = [
    { id: "z", x: 2470, y: 1800 },
    { id: "a", x: 2530, y: 1800 },
  ];
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGraph(page, g, { gridStepMm: 1000 });
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  const p = await screenPoint(page, 2500, 1800);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('[data-safety-vertex="a"]')).toHaveClass(/blocked/);
  await expect(page.getByRole("alert")).toHaveCount(1);
  const rejected = await graphCommand(page, g, {
    type: "addVertex",
    point: { x: 2530, y: 1800 },
  });
  expect(rejected.status).toBe("invalid");
  expect(rejected.graph.vertices).toEqual(g.vertices);
  const accepted = await graphCommand(page, g, {
    type: "addVertex",
    point: { x: 2530.05, y: 1800 },
  });
  expect(accepted.status).toBe("applied");
  expect(accepted.graph.vertices[2]).toMatchObject({ x: 2530.05, y: 1800 });
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

for (const mode of ["drag", "numeric command"])
  test(`safety ${mode} move preserves basis on disconnected vertex collision`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const g = graphSafetySolve();
    await openGraph(page, g);
    if (mode === "drag") {
      await page
        .getByRole("button", { name: "Переместить вершину", exact: true })
        .click();
      const a = await screenPoint(page, 1000, 0),
        b = await screenPoint(page, 2000, 0);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await page.mouse.up();
    } else {
      const result = await graphCommand(page, g, {
        type: "moveVertex",
        vertexId: "b",
        point: { x: 2000, y: 0 },
      });
      expect(result.status).toBe("invalid");
      expect(result.graph).toEqual(g);
      expect(
        result.issues.some(
          (i: any) =>
            i.code === "coincident_vertices" &&
            i.entityIds.includes("obstacle"),
        ),
      ).toBeTruthy();
      return;
    }
    await expect
      .poll(async () => (await stored(page)).plan.pendingEdit)
      .not.toBeNull();
    await settle(page);
    expect((await stored(page)).plan.draft.vertices).toEqual(g.vertices);
    await expect(page.locator(".geometry-issues")).toContainText(
      "b и obstacle",
    );
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
  await canvasPick(page, "vertex", "av0");
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

test("safety mobile diagnostic stays visible above menus and touch radius uses CSS pixels", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 375, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page = await context.newPage();
  const g = graphCoincident();
  await openGraph(page, g);
  const issue = page
    .locator(".geometry-issues")
    .getByRole("button")
    .filter({ hasText: "Координаты концов стены совпадают" });
  await issue.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Параметры", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-diagnostic-wall="zero"]')).toBeVisible();
  await page.screenshot({ path: "/tmp/plitka-safety-diagnostic-375.png" });
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .tap();
  const c = await screenPoint(page, 0, 0);
  await page.touchscreen.tap(c.x, c.y);
  await expect(page.getByRole("alert")).toContainText("уже есть");
  expect((await stored(page)).plan.draft).toEqual(g);
  const radius = await page
    .locator('[data-safety-vertex="av0"]')
    .evaluate((el) => {
      const c = el as SVGCircleElement;
      return c.r.baseVal.value * c.getScreenCTM()!.a;
    });
  expect(radius).toBeCloseTo(12, 4);
  await page.screenshot({ path: "/tmp/plitka-safety-zone-375.png" });
  await context.close();
});

test("context direct canvas selection replaces lists and presets; deleting closes the panel", async ({
  page,
}) => {
  await openGraph(page, graphRectangle());
  await expect(page.getByLabel("Стена", { exact: true })).toHaveCount(0);
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
    await page.getByRole("button", { name: "Вершина 3", exact: true }).click();
    await page.getByRole("button", { name: "Вершина 5", exact: true }).click();
    await expect(
      page.getByText("Выберите вершину этой стены.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Вершина 1", exact: true }).click();
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
test("context keyboard creates, moves and cancels without coordinate forms", async ({
  page,
}) => {
  await openGraph(page, {
    vertices: [],
    segments: [],
    chains: [],
    constraints: [],
    voids: [],
    fieldInputs: {},
  });
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  const canvas = page.getByRole("group", {
    name: "Редактор плана помещений",
    exact: true,
  });
  await canvas.focus();
  await canvas.press("ArrowRight");
  await canvas.press("Enter");
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toHaveLength(1);
  await page
    .getByRole("button", { name: "Переместить вершину", exact: true })
    .click();
  const vertex = page.getByRole("button", { name: "Вершина 1", exact: true });
  await vertex.focus();
  await vertex.press("Enter");
  await vertex.press("ArrowRight");
  await vertex.press("Escape");
  await settle(page);
  expect((await stored(page)).plan.draft.vertices[0].x).toBe(2600);
});

for (const [sector, value] of [
  ["ccw", "60,5"],
  ["cw", "270"],
] as const)
  test(`angle tool explicit pair and ${value} degree sector`, async ({
    page,
  }) => {
    await openGraph(page, graphJunction());
    let commands = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/plan/command")) commands++;
    });
    await page.getByRole("button", { name: "Угол", exact: true }).click();
    await page.getByRole("button", { name: "Стена 1", exact: true }).click();
    await page.getByRole("button", { name: "Стена 4", exact: true }).click();
    await expect(
      page.getByText("Выберите другую стену с общей вершиной.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Стена 2", exact: true }).click();
    await expect(
      page.getByLabel("Угол между стенами", { exact: true }),
    ).toHaveCount(0);
    expect(commands).toBe(0);
    const arc = page.getByRole("button", {
      name:
        sector === "ccw"
          ? "Дуга против часовой стрелки"
          : "Дуга по часовой стрелке",
      exact: true,
    });
    await arc.focus();
    await arc.press("Enter");
    await commit(page, "Угол между стенами", value);
    await settle(page);
    const d = await stored(page);
    expect(d.plan.pendingEdit).toBeNull();
    expect(d.plan.draft.constraints).toHaveLength(1);
    expect(d.plan.draft.constraints[0].value).toBe(
      Number(value.replace(",", ".")),
    );
    expect(commands).toBe(1);
  });
for (const value of ["0", "180", "360"])
  test(`angle tool rejects manually entered ${value} with preserved raw`, async ({
    page,
  }) => {
    await openGraph(page, graphJunction());
    const before = (await stored(page)).plan.draft.vertices;
    await page.getByRole("button", { name: "Угол", exact: true }).click();
    await page.getByRole("button", { name: "Стена 1", exact: true }).click();
    await page.getByRole("button", { name: "Стена 2", exact: true }).click();
    const arc = page.getByRole("button", {
      name: "Дуга против часовой стрелки",
      exact: true,
    });
    await arc.focus();
    await arc.press("Enter");
    await commit(page, "Угол между стенами", value);
    await settle(page);
    const d = await stored(page);
    expect(d.plan.pendingEdit).not.toBeNull();
    expect(d.plan.draft.vertices).toEqual(before);
    await expect(
      page.getByLabel("Угол между стенами", { exact: true }),
    ).toHaveValue(value);
  });

test("angle tool derived straight angle keeps vertex and no fixed condition", async ({
  page,
}) => {
  await openGraph(page, graphJunction());
  const before = await stored(page);
  await chooseAngle(page, "eastWall", "westWall", "ccw");
  await expect(
    page.getByLabel("Угол между стенами", { exact: true }),
  ).toHaveValue("180");
  await page.keyboard.press("Escape");
  expect((await stored(page)).plan).toEqual(before.plan);
  expect((await stored(page)).plan.draft.constraints).toEqual([]);
});
for (const width of [375, 1440])
  test(`context accessible canvas and dialogs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openGraph(page, graphJunction());
    const before = await stored(page);
    await chooseAngle(page, "northWall", "westWall", "ccw");
    await expect(
      page.getByLabel("Угол между стенами", { exact: true }),
    ).toBeFocused();
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

test("context keyboard connects to projected wall and commits move once", async ({
  page,
}) => {
  await openGraph(page, graphRange());
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", "foreign");
  const wall = page.getByRole("button", { name: "Стена 1", exact: true });
  await wall.focus();
  await wall.press("ArrowRight");
  await wall.press("Enter");
  await settle(page);
  const connected = await stored(page);
  expect(connected.plan.pendingEdit).toBeNull();
  expect(
    connected.plan.draft.vertices.some(
      (v: any) => Math.abs(v.x - 600) < 0.1 && v.y === 0,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Переместить вершину", exact: true })
    .click();
  const vertex = page.getByRole("button", { name: "Вершина 5", exact: true });
  await vertex.focus();
  await vertex.press("Enter");
  await vertex.press("ArrowUp");
  await vertex.press("Enter");
  await settle(page);
  expect(
    (await stored(page)).plan.draft.vertices.find(
      (v: any) => v.id === "foreign",
    ).y,
  ).toBe(1100);
});

test("context range survives an accepted internal split and closes on imported removal", async ({
  page,
}) => {
  await openGraph(page, graphRange());
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    begin = new Promise<void>((r) => (started = r));
  await page.route("**/api/plan/command", async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", "foreign");
  await canvasPick(page, "segment", "s0");
  await begin;
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "s1");
  await page
    .getByRole("button", { name: "Выбрать диапазон", exact: true })
    .click();
  await canvasPick(page, "vertex", "v0");
  await canvasPick(page, "vertex", "v2");
  release();
  await settle(page);
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveValue(
    "2000",
  );
  expect(
    (await stored(page)).plan.draft.chains.find((c: any) => c.id === "chain")
      .segmentIds,
  ).toHaveLength(4);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveValue(
    "2000",
  );
  const document = await stored(page);
  document.plan.draft = {
    vertices: [],
    segments: [],
    chains: [],
    constraints: [],
    voids: [],
    fieldInputs: {},
  };
  document.rooms = [];
  document.selectedRoomId = null;
  document.plan.restorePoint = null;
  const { importFile } = await import("./fixtures/projects");
  await importFile(page, {
    format: "plitka-project",
    version: 3,
    project: document,
  });
  await expect(page.getByLabel("Длина диапазона", { exact: true })).toHaveCount(
    0,
  );
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
  await page.keyboard.press("Tab");
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

test("angle tool participant lost through ordinary Undo closes context and restores canvas focus", async ({
  page,
}) => {
  await openGraph(page, graphJunction());
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", "north");
  await canvasPick(page, "vertex", "west");
  await settle(page);
  const added = (await stored(page)).plan.draft.segments.find(
    (s: any) => !graphJunction().segments.some((old: any) => old.id === s.id),
  );
  await chooseAngle(page, "northWall", added.id, "ccw");
  await expect(
    page.getByLabel("Угол между стенами", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await expect(
    page.getByLabel("Угол между стенами", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("svg[data-geometry]")).toBeFocused();
  expect((await stored(page)).plan.draft).toEqual(graphJunction());
});

test("context exact new point stays folded and preserves precision inside safety radius", async ({
  page,
}) => {
  await openGraph(page, graphRange());
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  await page.getByRole("button", { name: "Параметры", exact: true }).click();
  await expect(
    page.getByLabel("Новая вершина X", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("Точное положение", { exact: true }).click();
  await commit(page, "Новая вершина X", "0,125");
  await commit(page, "Новая вершина Y", "0");
  await page
    .getByRole("button", { name: "Поставить точку", exact: true })
    .click();
  await settle(page);
  expect(
    (await stored(page)).plan.draft.vertices.some(
      (v: any) => v.x === 0.125 && v.y === 0,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "vertex", "v0");
  await expect(page.getByLabel("Координата X", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Новая вершина X", { exact: true })).toHaveCount(
    0,
  );
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
      name: "Вернуть план к последнему подтверждению",
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
