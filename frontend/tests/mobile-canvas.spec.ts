import { expect, test } from "@playwright/test";
import { graphRectangle, openGraph, openProject, screenPoint, setSidebarOpen, settle, stored, toRules, touchSession } from "./fixtures/projects";

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const toolNames = ["Выбрать", "Добавить вершину", "Соединить стены", "Стена", "Угол", "Переместить вершину", "Переместить полотно", "Выбрать помещение"];

test("single touch pan follows the finger before release", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить полотно", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const geometry = await canvas.getAttribute("data-geometry");
  const initial = await canvas.getAttribute("viewBox");
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 701, x: 210, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 701, x: 260, y: 455 }]);
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(initial);
  const moving = await canvas.getAttribute("viewBox");
  await touch.dispatch("touchEnd", []);
  await expect(canvas).toHaveAttribute("viewBox", moving!);
  expect(await canvas.getAttribute("data-geometry")).toBe(geometry);
  await touch.close();
});

for (const width of [320, 375, 430]) {
  test(`ten single-finger pans track the pointer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await openGraph(page, graphRectangle());
    await page.getByRole("button", { name: "Переместить полотно", exact: true }).click();
    const canvas = page.locator("svg[data-geometry]");
    const geometry = await canvas.getAttribute("data-geometry");
    const touch = await touchSession(page);
    for (let index = 0; index < 10; index++) {
      const id = 800 + index;
      const before = await screenPoint(page, 2000, 1500);
      const start = { id, x: width / 2 + 30, y: 390 };
      await touch.dispatch("touchStart", [start]);
      await touch.dispatch("touchMove", [{ ...start, x: start.x + 18, y: start.y + 12 }]);
      await expect.poll(async () => (await screenPoint(page, 2000, 1500)).x - before.x).toBeCloseTo(18, 0);
      const moving = await canvas.getAttribute("viewBox");
      await touch.dispatch("touchEnd", []);
      await expect(canvas).toHaveAttribute("viewBox", moving!);
    }
    expect(await canvas.getAttribute("data-geometry")).toBe(geometry);
    await touch.close();
  });
}

test("snap preview has no type label", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const point = await screenPoint(page, 2000, 1500);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".snap-status")).toHaveCount(0);
});

test("wall tool previews thickness and commits once on release", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 500, centerY: 500, zoom: 4 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await expect(page.getByLabel("Толщина новой стены")).toHaveValue("100");
  const start = await screenPoint(page, 0, 500);
  const end = await screenPoint(page, 1000, 500);
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/plan/command") && request.postDataJSON()?.command?.type === "drawWall") calls++;
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect(page.locator(".physical-wall-preview")).toBeVisible();
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(1);
  await expect(page.locator(".physical-wall")).toBeVisible();
  expect((await stored(page)).plan.draft.chains[0].thicknessMm).toBe(100);
  expect(calls).toBe(1);
});

test("selected wall thickness updates without changing its identity", async ({ page }) => {
  await openGraph(page, graphRectangle(2000, 2000), { centerX: 1000, centerY: 1000, zoom: 3 });
  const before = await stored(page);
  await page.locator('[data-target="segment:as0"]').focus();
  await page.locator('[data-target="segment:as0"]').press("Enter");
  const field = page.getByLabel("Толщина выбранной стены");
  await expect(field).toHaveValue("100");
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/plan/command") && request.postDataJSON()?.command?.type === "setWallThickness") commands++;
  });
  await field.fill("-20");
  await field.press("Enter");
  await expect(page.getByRole("alert")).toContainText("положительную толщину");
  expect((await stored(page)).plan.draft.chains[0].thicknessMm).toBe(100);
  expect(commands).toBe(0);
  await field.fill("200");
  await field.press("Enter");
  await expect.poll(async () => (await stored(page)).plan.draft.chains[0].thicknessMm).toBe(200);
  expect((await stored(page)).plan.draft.chains[0].id).toBe(before.plan.draft.chains[0].id);
});

for (const width of [320, 375, 430]) {
  test(`wall control remains accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await openGraph(page, graphRectangle());
    const button = page.getByRole("button", { name: "Стена", exact: true });
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const field = page.getByLabel("Толщина новой стены");
    await expect(field).toBeVisible();
    await field.focus();
    await expect(field).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await setSidebarOpen(page, false);
    await expect(page.locator("svg[data-geometry]")).toBeVisible();
    await setSidebarOpen(page, true);
    await page.setViewportSize({ width: 760, height: width });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);
  });
}

test("wall preview stops at the physical face before an axis junction", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1000, y: 0 }],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [{ id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 500, centerY: 200, zoom: 4 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const start = await screenPoint(page, 500, 700);
  const end = await screenPoint(page, 500, -700);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  const preview = await page.locator(".physical-wall-preview").getAttribute("d");
  expect(preview).toContain("50");
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(2);
  const chain = (await stored(page)).plan.draft.chains[1];
  const vertex = (await stored(page)).plan.draft.vertices.find((v: any) => v.id === chain.endVertexId);
  expect(vertex.y).toBe(0);
});

test("second finger cancels an unfinished wall", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 500, centerY: 500, zoom: 4 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const first = { id: 91, x: 140, y: 340 };
  const second = { id: 92, x: 230, y: 340 };
  await touch.dispatch("touchStart", [first]);
  await touch.dispatch("touchMove", [{ ...first, x: 170, y: 360 }]);
  await expect(page.locator(".physical-wall-preview")).toBeVisible();
  await touch.dispatch("touchStart", [{ ...first, x: 170, y: 360 }, second]);
  await expect(page.locator(".physical-wall-preview")).toHaveCount(0);
  await touch.dispatch("touchEnd", []);
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  await touch.close();
});

test("ten wall strokes stop at the first existing wall", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2000, y: 0 }],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [{ id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 1000, centerY: 0, zoom: 3 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  for (let index = 0; index < 10; index++) {
    const x = 100 + index * 180;
    const start = await screenPoint(page, x, 700);
    const end = await screenPoint(page, x, -700);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
    await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(index + 2);
    const draft = (await stored(page)).plan.draft;
    const chain = draft.chains.at(-1);
    expect(draft.vertices.find((v: any) => v.id === chain.endVertexId).y).toBe(0);
  }
});

test("touch placement keeps the marker but hides numbers and needs three actions", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await setSidebarOpen(page, true);
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const before = (await stored(page)).plan.draft.vertices.length;
  const target = await screenPoint(page, 2000, 1500);
  await page.touchscreen.tap(target.x, target.y + 48);
  const group = page.getByRole("group", { name: "Размещение вершины" });
  await expect(group).toBeVisible();
  await expect(group).not.toContainText(/\d+\s*[×;]\s*\d+/);
  await expect(page.locator(".snap-status")).toHaveCount(0);
  await group.getByRole("button", { name: "Поставить вершину" }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.length).toBe(before + 1);
});

test("touch sidebar starts closed in portrait and wide landscape and keeps manual choice", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openGraph(page, graphRectangle(), {}, false);
  const toggle = page.locator(".canvas-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Добавить вершину", exact: true })).toHaveCount(0);
  await setSidebarOpen(page, true);
  await expect(page.getByRole("button", { name: "Добавить вершину", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 812, height: 375 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(812);
  await setSidebarOpen(page, false);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeVisible();
});

for (const width of [320, 375, 430]) {
  test(`ten two-finger gestures leave every tool's geometry unchanged at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 812 });
    await openGraph(page, graphRectangle());
    const touch = await touchSession(page);
    const canvas = page.locator("svg[data-geometry]");
    const baseline = await touch.snapshot();
    const initialDraft = (await stored(page)).plan.draft;
    for (const name of toolNames) {
      await page.getByRole("button", { name, exact: true }).click();
      for (let index = 0; index < 10; index++) {
        const first = { id: index * 2 + 1, x: width / 2 - 25, y: 420 };
        const second = { id: index * 2 + 2, x: width / 2 + 25, y: 420 };
        await touch.dispatch("touchStart", [first, second]);
        await touch.dispatch("touchMove", [
          { ...first, x: first.x - (index % 2 ? 8 : 18), y: 430 },
          { ...second, x: second.x + (index % 2 ? 8 : 18), y: 430 },
        ]);
        await touch.dispatch("touchEnd", index % 2 ? [second] : [first]);
        await touch.dispatch("touchEnd", []);
        const snapshot = await touch.snapshot();
        expect(snapshot.geometry).toBe(baseline.geometry);
        expect(snapshot.layout).toBe(baseline.layout);
        const zoom = (await stored(page)).viewport.zoom;
        expect(zoom).toBeGreaterThanOrEqual(0.2);
        expect(zoom).toBeLessThanOrEqual(8);
      }
      await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Перемещение вершины" })).toHaveCount(0);
    }
    expect((await stored(page)).plan.draft).toEqual(initialDraft);
    expect(await canvas.getAttribute("viewBox")).not.toBeNull();
    await touch.close();
  });
}

test("second finger and touch cancellation discard an unfinished point", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const touch = await touchSession(page);
  const baseline = await touch.snapshot();
  const one = { id: 91, x: 230, y: 420 };
  const two = { id: 92, x: 280, y: 420 };
  await touch.dispatch("touchStart", [one]);
  await touch.dispatch("touchStart", [one, two]);
  await touch.dispatch("touchMove", [{ ...one, x: 210 }, { ...two, x: 300 }]);
  await touch.dispatch("touchCancel", []);
  expect(await touch.snapshot()).toEqual(baseline);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
  await page.touchscreen.tap(240, 440);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toBeVisible();
  await touch.close();
});

test("pinch keeps the world point under the moving midpoint with an open panel", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить полотно", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const anchor = await canvas.evaluate((svg) => {
    const p = new DOMPoint(190, 420).matrixTransform((svg as SVGSVGElement).getScreenCTM()!.inverse());
    return { x: p.x, y: -p.y };
  });
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 61, x: 160, y: 420 }, { id: 62, x: 220, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 61, x: 155, y: 450 }, { id: 62, x: 285, y: 450 }]);
  await expect.poll(async () => (await screenPoint(page, anchor.x, anchor.y)).x).toBeCloseTo(220, 0);
  const after = await screenPoint(page, anchor.x, anchor.y);
  expect(after.y).toBeCloseTo(450, 0);
  await touch.dispatch("touchEnd", []);
  await touch.close();
});

test("two-finger gestures never shift the selected layout", async ({ page }) => {
  await openProject(page);
  await toRules(page);
  await page.getByRole("button", { name: "Подобрать раскладку", exact: true }).click();
  const canvas = page.locator("svg[data-layout]");
  await expect(canvas).toHaveAttribute("data-layout", /offset_x/);
  const touch = await touchSession(page);
  const before = await touch.snapshot();
  let shifts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/layout")) shifts++; });
  for (let index = 0; index < 10; index++) {
    await touch.dispatch("touchStart", [{ id: 401 + index * 2, x: 165, y: 420 }, { id: 402 + index * 2, x: 225, y: 420 }]);
    await touch.dispatch("touchMove", [{ id: 401 + index * 2, x: 155, y: 440 }, { id: 402 + index * 2, x: 245, y: 440 }]);
    await touch.dispatch("touchEnd", []);
  }
  expect(await touch.snapshot()).toEqual(before);
  expect(shifts).toBe(0);
  await touch.close();
});

test("single-finger pan does not shift the selected layout", async ({ page }) => {
  await openProject(page);
  await toRules(page);
  await page.getByRole("button", { name: "Подобрать раскладку", exact: true }).click();
  const canvas = page.locator("svg[data-layout]");
  await expect(canvas).toHaveAttribute("data-layout", /offset_x/);
  const original = await canvas.getAttribute("data-layout");
  const before = (await stored(page)).viewport;
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 911, x: 200, y: 350 }]);
  await touch.dispatch("touchMove", [{ id: 911, x: 230, y: 370 }]);
  await expect(canvas).toHaveAttribute("data-layout", original!);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).viewport.centerX).not.toBe(before.centerX);
  await expect(canvas).toHaveAttribute("data-layout", original!);
  await touch.close();
});

test("pinch clamps at both zoom limits without changing the grid", async ({ page }) => {
  await openGraph(page, graphRectangle(), { zoom: 7.5 });
  const grid = (await stored(page)).viewport.gridStepMm;
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 501, x: 165, y: 420 }, { id: 502, x: 205, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 501, x: 65, y: 420 }, { id: 502, x: 305, y: 420 }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBe(8);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("plitka-projects-v4")!);
    state.projects[0].viewport.zoom = 0.25;
    localStorage.setItem("plitka-projects-v4", JSON.stringify(state));
  });
  await page.reload();
  await settle(page);
  await touch.dispatch("touchStart", [{ id: 503, x: 105, y: 420 }, { id: 504, x: 305, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 503, x: 195, y: 420 }, { id: 504, x: 215, y: 420 }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBe(0.2);
  expect((await stored(page)).viewport.gridStepMm).toBe(grid);
  await touch.close();
});

test("two fingers navigate without editing; a touch point needs confirmation", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const geometry = await canvas.getAttribute("data-geometry");
  const before = await canvas.getAttribute("viewBox");
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: 220, y: 400, id: 1 }, { x: 270, y: 400, id: 2 },
  ] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: 185, y: 425, id: 1 }, { x: 305, y: 425, id: 2 },
  ] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(before);
  const afterZoom = await canvas.getAttribute("viewBox");
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: 220, y: 390, id: 3 }, { x: 280, y: 390, id: 4 },
  ] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: 250, y: 420, id: 3 }, { x: 310, y: 420, id: 4 },
  ] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(afterZoom);
  expect(await canvas.getAttribute("data-geometry")).toBe(geometry);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);

  await page.touchscreen.tap(250, 440);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toBeVisible();
  expect(await canvas.getAttribute("data-geometry")).toBe(geometry);
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(await canvas.getAttribute("data-geometry")).toBe(geometry);

  await page.touchscreen.tap(250, 440);
  await page.getByRole("button", { name: "Поставить вершину" }).click();
  await settle(page);
  const next = JSON.parse((await canvas.getAttribute("data-geometry"))!);
  expect(next.vertices).toHaveLength(JSON.parse(geometry!).vertices.length + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

for (const width of [320, 430]) {
  test(`mobile controls fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await openGraph(page, graphRectangle());
    await expect(page.getByRole("button", { name: "Увеличить" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить вершину", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("touch vertex move waits for confirmation and can be cancelled", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const before = await canvas.getAttribute("data-geometry");
  const point = await screenPoint(page, 4000, 0);
  const client = await page.context().newCDPSession(page);
  const drag = async (id: number) => {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x - 45, y: point.y - 45, id }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await drag(1);
  await expect(page.getByRole("group", { name: "Перемещение вершины" })).toBeVisible();
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: 220, y: 400, id: 3 }, { x: 270, y: 400, id: 4 },
  ] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("group", { name: "Перемещение вершины" })).toHaveCount(0);
  expect(await canvas.getAttribute("data-geometry")).toBe(before);

  await drag(5);
  await page.getByRole("group", { name: "Перемещение вершины" }).getByRole("button", { name: "Отмена" }).click();
  expect(await canvas.getAttribute("data-geometry")).toBe(before);

  await drag(6);
  await page.getByRole("group", { name: "Перемещение вершины" })
    .getByRole("button", { name: "Переместить вершину" }).click();
  await settle(page);
  const after = JSON.parse((await canvas.getAttribute("data-geometry"))!);
  expect(after.vertices.find((v: { id: string }) => v.id === "av1")).not.toEqual(
    JSON.parse(before!).vertices.find((v: { id: string }) => v.id === "av1"),
  );
});

test("ten addition and move previews cancel without a graph command", async ({ page }) => {
  await openGraph(page, graphRectangle());
  const canvas = page.locator("svg[data-geometry]");
  const before = await canvas.getAttribute("data-geometry");
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  for (let i = 0; i < 10; i++) {
    await page.touchscreen.tap(210, 420);
    await page.getByRole("group", { name: "Размещение вершины" }).getByRole("button", { name: "Отмена" }).click();
  }
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const origin = await screenPoint(page, 4000, 0);
  const touch = await touchSession(page);
  for (let i = 0; i < 10; i++) {
    await touch.dispatch("touchStart", [{ id: 101 + i, ...origin }]);
    await touch.dispatch("touchMove", [{ id: 101 + i, x: origin.x - 35, y: origin.y - 35 }]);
    await touch.dispatch("touchEnd", []);
    await page.getByRole("group", { name: "Перемещение вершины" }).getByRole("button", { name: "Отмена" }).click();
  }
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
  await touch.close();
});

test("Escape, tool change, and touch cancellation clear placement previews", async ({ page }) => {
  await openGraph(page, graphRectangle());
  const canvas = page.locator("svg[data-geometry]");
  const before = await canvas.getAttribute("data-geometry");
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  await page.touchscreen.tap(210, 420);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
  await page.touchscreen.tap(210, 420);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const origin = await screenPoint(page, 4000, 0);
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 191, ...origin }]);
  await touch.dispatch("touchMove", [{ id: 191, x: origin.x - 35, y: origin.y - 35 }]);
  await touch.dispatch("touchCancel", []);
  await expect(page.getByRole("group", { name: "Перемещение вершины" })).toHaveCount(0);
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
  await touch.close();
});

test("move preview remains visible above the dragging finger", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const origin = await screenPoint(page, 4000, 0);
  const finger = { x: origin.x - 40, y: origin.y - 40 };
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 201, ...origin }]);
  await touch.dispatch("touchMove", [{ id: 201, ...finger }]);
  const marker = page.locator("svg[data-geometry] circle[data-drag-preview]");
  await expect(marker).toBeVisible();
  const markerScreen = await marker.evaluate((el) => {
    const p = new DOMPoint(Number(el.getAttribute("cx")), Number(el.getAttribute("cy"))).matrixTransform((el as SVGCircleElement).getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  expect(Math.abs(markerScreen.x - finger.x)).toBeLessThan(12);
  expect(markerScreen.y).toBeLessThan(finger.y - 35);
  await touch.dispatch("touchEnd", []);
  await touch.close();
});

test("rejected confirmed move shows an error and retains the graph", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const before = await page.locator("svg[data-geometry]").getAttribute("data-geometry");
  const origin = await screenPoint(page, 4000, 0);
  const destination = await screenPoint(page, 0, 0);
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 301, ...origin }]);
  await touch.dispatch("touchMove", [{ id: 301, ...destination }]);
  await touch.dispatch("touchEnd", []);
  await page.getByRole("group", { name: "Перемещение вершины" }).getByRole("button", { name: "Переместить вершину" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(await page.locator("svg[data-geometry]").getAttribute("data-geometry")).toBe(before);
  await touch.close();
});

test("nine of ten preset touch targets save exactly at the preview marker", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const targets = [1000, 1600, 2200, 2800, 3400].flatMap((x) => [1000, 2000].map((y) => ({ x, y })));
  let successes = 0;
  for (const target of targets) {
    const screen = await screenPoint(page, target.x, target.y);
    const before = JSON.parse((await canvas.getAttribute("data-geometry"))!);
    await page.touchscreen.tap(screen.x, screen.y + 48);
    const marker = canvas.locator("circle[data-placement-blocked]");
    await expect(marker).toBeVisible();
    const preview = await marker.evaluate((el) => {
      const point = { x: Number(el.getAttribute("cx")), y: Number(el.getAttribute("cy")) };
      const screen = new DOMPoint(point.x, point.y).matrixTransform((el as SVGCircleElement).getScreenCTM()!);
      return { point: { x: point.x, y: point.y }, screen: { x: screen.x, y: screen.y } };
    });
    await page.getByRole("button", { name: "Поставить вершину" }).click();
    await settle(page);
    const after = JSON.parse((await canvas.getAttribute("data-geometry"))!);
    expect(after.vertices).toHaveLength(before.vertices.length + 1);
    const saved = after.vertices.at(-1);
    expect({ x: saved.x, y: saved.y }).toEqual(preview.point);
    if (Math.hypot(preview.screen.x - screen.x, preview.screen.y - screen.y) <= 12) successes++;
  }
  expect(successes).toBeGreaterThanOrEqual(9);
});

test("touch placement warns and blocks a point within twelve screen pixels", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const before = await canvas.getAttribute("data-geometry");
  const vertex = await screenPoint(page, 0, 0);
  await page.touchscreen.tap(vertex.x, vertex.y + 48);
  await expect(canvas.locator('circle[data-placement-blocked="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Поставить вершину" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
});

for (const [width, height] of [[320, 812], [375, 812], [430, 812], [812, 320], [812, 375], [812, 430]]) {
  test(`controls remain reachable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGraph(page, graphRectangle());
    const tools = page.getByRole("toolbar", { name: "Инструменты плана" });
    await tools.getByRole("button", { name: "Выбрать помещение", exact: true }).click();
    await tools.getByRole("button", { name: "Добавить вершину", exact: true }).click();
    const before = await page.locator("svg[data-geometry]").getAttribute("data-geometry");
    await page.getByRole("button", { name: "Параметры", exact: true }).click();
    await expect(page.getByRole("button", { name: "Закрыть параметры" })).toBeVisible();
    await page.getByRole("button", { name: "Закрыть параметры" }).click();
    await expect(tools.getByRole("button", { name: "Добавить вершину", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("svg[data-geometry]").getAttribute("data-geometry")).toBe(before);
    const target = await screenPoint(page, 2000, 2700);
    await page.touchscreen.tap(target.x, target.y + 48);
    const controls = page.getByRole("group", { name: "Размещение вершины" });
    await expect(controls).toBeVisible();
    for (const name of ["Поставить вершину", "Отмена"]) {
      const box = await controls.getByRole("button", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    }
    await controls.getByRole("button", { name: "Отмена" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
