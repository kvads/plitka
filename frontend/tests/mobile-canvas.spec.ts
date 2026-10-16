import { expect, test } from "@playwright/test";
import { canvasPick, graphRectangle, openGraph, openProject, screenPoint, setSidebarOpen, settle, stored, toRules, touchSession } from "./fixtures/projects";

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const toolNames = ["Выбрать", "Стена", "Переместить полотно", "Выбрать помещение"];

test("mobile wall uses two taps and keeps the first point through a pan", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 500, centerY: 500, zoom: 4 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const first = await screenPoint(page, 0, 0);
  await touch.dispatch("touchStart", [{ id: 1001, x: first.x, y: first.y }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toBeVisible();
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  const rulerY = await page.locator(".wall-ruler line").first().getAttribute("y1");
  const outside = await screenPoint(page, 150, 150);
  await touch.dispatch("touchStart", [{ id: 1004, x: outside.x, y: outside.y }]);
  await touch.dispatch("touchEnd", []);
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  await touch.dispatch("touchStart", [{ id: 1002, x: 210, y: 500 }]);
  await touch.dispatch("touchMove", [{ id: 1002, x: 230, y: 500 }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toBeVisible();
  await expect(page.locator(".wall-ruler line").first()).toHaveAttribute("y1", rulerY!);
  await touch.dispatch("touchStart", [{ id: 1005, x: 170, y: 450 }, { id: 1006, x: 230, y: 450 }]);
  await touch.dispatch("touchMove", [{ id: 1005, x: 150, y: 450 }, { id: 1006, x: 250, y: 450 }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.locator(".wall-ruler line").first()).toHaveAttribute("y1", rulerY!);
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  const second = await screenPoint(page, 600, 0);
  await touch.dispatch("touchStart", [{ id: 1003, x: second.x, y: second.y }]);
  await touch.dispatch("touchMove", [{ id: 1003, x: second.x + 1, y: second.y }]);
  await expect(page.locator(".wall-ruler text")).toContainText("600 мм");
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(1);
  await touch.close();
});

for (let attempt = 0; attempt < 10; attempt++) {
  test(`mobile two-tap wall commits exactly once, attempt ${attempt + 1}`, async ({ page }) => {
    await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
      { centerX: 500, centerY: 500, zoom: 4 });
    await page.getByRole("button", { name: "Стена", exact: true }).click();
    const touch = await touchSession(page);
    let commands = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/plan/command") && request.postDataJSON()?.command?.type === "drawWall") commands++;
    });
    const start = await screenPoint(page, 0, 0);
    await touch.dispatch("touchStart", [{ id: 1400 + attempt * 2, x: start.x, y: start.y }]);
    await touch.dispatch("touchEnd", []);
    expect(commands).toBe(0);
    const end = await screenPoint(page, 900, 0);
    await touch.dispatch("touchStart", [{ id: 1401 + attempt * 2, x: end.x, y: end.y }]);
    await touch.dispatch("touchEnd", []);
    await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(1);
    expect(commands).toBe(1);
    await touch.close();
  });
}

test("perpendicular candidate from a slanted wall keeps a precise right angle", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1000, y: 1000 }],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [{ id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 900, centerY: 1100, zoom: 12 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const start = await screenPoint(page, 1000, 1000);
  await touch.dispatch("touchStart", [{ id: 1101, x: start.x, y: start.y }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toBeVisible();
  const guide = page.locator('[data-candidate="perpendicularGuide"]').first();
  await expect(guide).toBeAttached();
  const end = await guide.evaluate((element) => {
    const svg = element.ownerSVGElement!;
    const p = new DOMPoint(Number(element.getAttribute("cx")), -Number(element.getAttribute("cy"))).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await touch.dispatch("touchStart", [{ id: 1102, x: end.x, y: end.y }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(2);
  const vertices = (await stored(page)).plan.draft.vertices;
  const newEnd = vertices.find((v: { id: string }) => v.id !== "a" && v.id !== "b");
  expect(Math.abs((newEnd.x - 1000) + (newEnd.y - 1000))).toBeLessThan(0.01);
  await touch.close();
});

test("edge of a wall-end touch target uses the exact stored junction", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 37, y: 43 }, { id: "b", x: 533, y: 443 }],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [{ id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 500, centerY: 300, zoom: 10 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const start = await screenPoint(page, 533, 443);
  const end = await screenPoint(page, 600, 0);
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 1501, x: start.x + 20, y: start.y }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toBeVisible();
  await touch.dispatch("touchStart", [{ id: 1502, x: end.x, y: end.y }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(2);
  const draft = (await stored(page)).plan.draft;
  const added = draft.chains.find((chain: { id: string }) => chain.id !== "c");
  const point = draft.vertices.find((vertex: { id: string }) => vertex.id === added.startVertexId);
  expect(point).toMatchObject({ x: 533, y: 443 });
  await touch.close();
});

test("a wall end wins over nearby grid points as the second tap", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 37, y: 43 }, { id: "b", x: 533, y: 443 }],
    segments: [{ id: "s", startVertexId: "a", endVertexId: "b", chainId: "c" }],
    chains: [{ id: "c", startVertexId: "a", endVertexId: "b", segmentIds: ["s"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 500, centerY: 300, zoom: 10 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const start = await screenPoint(page, 400, 0);
  await touch.dispatch("touchStart", [{ id: 1701, x: start.x, y: start.y }]);
  await touch.dispatch("touchEnd", []);
  const end = await screenPoint(page, 533, 443);
  await touch.dispatch("touchStart", [{ id: 1702, x: end.x + 20, y: end.y }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(2);
  const draft = (await stored(page)).plan.draft;
  const added = draft.chains.find((chain: { id: string }) => chain.id !== "c");
  const endpoint = draft.vertices.find((vertex: { id: string }) => vertex.id === added.endVertexId);
  expect(endpoint).toMatchObject({ x: 533, y: 443 });
  await touch.close();
});

test("two competing wall ends refuse an ambiguous touch until zoomed closer", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: -300, y: 0 }, { id: "b", x: 0, y: 0 }, { id: "c", x: 60, y: 0 }, { id: "d", x: 360, y: 0 }],
    segments: [{ id: "s1", startVertexId: "a", endVertexId: "b", chainId: "w1" }, { id: "s2", startVertexId: "c", endVertexId: "d", chainId: "w2" }],
    chains: [{ id: "w1", startVertexId: "a", endVertexId: "b", segmentIds: ["s1"], thicknessMm: 100 }, { id: "w2", startVertexId: "c", endVertexId: "d", segmentIds: ["s2"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph, { centerX: 30, centerY: 0, zoom: 10 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const middle = await screenPoint(page, 30, 0);
  await touch.dispatch("touchStart", [{ id: 1801, x: middle.x, y: middle.y }]);
  await touch.dispatch("touchEnd", []);
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  expect((await stored(page)).plan.draft.chains).toHaveLength(2);
  await touch.close();
});

test("mobile major-grid candidates thin out on zoom out and stay 44px apart", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 1000, centerY: 1000, zoom: 0.2 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const countFar = await page.locator('[data-candidate="majorGrid"]').count();
  await page.evaluate(() => {
    const catalog = JSON.parse(localStorage.getItem("plitka-projects-v4")!);
    catalog.projects[0].viewport.zoom = 8;
    localStorage.setItem("plitka-projects-v4", JSON.stringify(catalog));
  });
  await page.reload();
  await setSidebarOpen(page, true);
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const grid = page.locator('[data-candidate="majorGrid"]');
  await expect.poll(() => grid.count()).toBeGreaterThan(countFar);
  const spacing = await grid.evaluateAll((circles) => {
    const svg = circles[0]?.ownerSVGElement!;
    const points = circles.map((circle) => new DOMPoint(Number(circle.getAttribute("cx")), -Number(circle.getAttribute("cy"))).matrixTransform(svg.getScreenCTM()!));
    let minimum = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++)
      minimum = Math.min(minimum, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    return minimum;
  });
  expect(spacing).toBeGreaterThanOrEqual(43.9);
  await expect(page.locator('[data-candidate="minorGrid"]')).toHaveCount(0);
});

for (const width of [320, 375, 430]) for (const landscape of [false, true]) {
  test(`mobile wall controls fit ${width}px ${landscape ? "landscape" : "portrait"}`, async ({ page }) => {
    await page.setViewportSize(landscape ? { width: 812, height: width } : { width, height: 812 });
    await openGraph(page, graphRectangle(), {}, false);
    await expect(page.locator(".canvas-sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    await setSidebarOpen(page, true);
    await canvasPick(page, "segment", "as0");
    const handle = page.locator('[data-wall-handle="end"] circle').first();
    const handleBox = await handle.boundingBox();
    expect(handleBox!.width).toBeGreaterThanOrEqual(44);
    await page.locator('[data-wall-handle="end"]').click();
    const arrow = page.getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" });
    await expect(arrow).toBeVisible();
    const arrowBox = await arrow.boundingBox();
    expect(arrowBox!.width).toBeGreaterThanOrEqual(44);
    expect(arrowBox!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(landscape ? 812 : width);
  });
}

test("mobile sidebar scrolls without moving the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openGraph(page, graphRectangle());
  const canvas = page.locator("svg[data-geometry]");
  const view = await canvas.getAttribute("viewBox");
  const sidebar = page.locator(".canvas-sidebar");
  await sidebar.evaluate((node) => {
    const spacer = document.createElement("div");
    spacer.style.cssText = "min-height:1000px;flex:none";
    node.appendChild(spacer);
  });
  const box = await sidebar.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => sidebar.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute("viewBox", view!);
});

test("Escape, tool switch and explicit cancel discard an unfinished mobile wall", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 500, centerY: 500, zoom: 4 });
  const touch = await touchSession(page);
  const tap = async (id: number) => {
    const start = await screenPoint(page, 0, 0);
    await touch.dispatch("touchStart", [{ id, x: start.x, y: start.y }]);
    await touch.dispatch("touchEnd", []);
    await expect(page.getByRole("button", { name: "Отменить начало стены" })).toBeVisible();
  };
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await tap(1201);
  await page.locator("svg[data-geometry]").press("Escape");
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  await tap(1202);
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await tap(1203);
  await page.getByRole("button", { name: "Отменить начало стены" }).click();
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  expect((await stored(page)).plan.draft.chains).toHaveLength(0);
  await touch.close();
});

for (const width of [320, 375, 430]) {
  test(`10/100 mm grid becomes readable at maximum zoom on ${width}px canvas`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await openGraph(page, graphRectangle(), { zoom: 0.2 });
    const canvas = page.locator("svg[data-geometry]");
    const baseline = await canvas.getAttribute("data-geometry");
    expect(await page.locator(".canvas-grid-major line").count()).toBeGreaterThan(0);
    await expect(page.locator(".canvas-grid-minor line")).toHaveCount(0);
    const initialWidth = await canvas.evaluate((svg) => svg.getBoundingClientRect().width);
    await page.evaluate((canvasWidth) => {
      const state = JSON.parse(localStorage.getItem("plitka-projects-v4")!);
      state.projects[0].viewport.zoom = Math.max(8, 5400 / canvasWidth);
      localStorage.setItem("plitka-projects-v4", JSON.stringify(state));
    }, initialWidth);
    await page.reload();
    await expect.poll(() => page.locator(".canvas-grid-minor line").count()).toBeGreaterThan(0);
    const overlap = await page.evaluate(() => {
      const major = new Set([...document.querySelectorAll(".canvas-grid-major line")].map((line) => line.getAttribute("x1") === line.getAttribute("x2") ? `x:${line.getAttribute("x1")}` : `y:${line.getAttribute("y1")}`));
      return [...document.querySelectorAll(".canvas-grid-minor line")].some((line) => major.has(line.getAttribute("x1") === line.getAttribute("x2") ? `x:${line.getAttribute("x1")}` : `y:${line.getAttribute("y1")}`));
    });
    expect(overlap).toBe(false);
    const actualWidth = await canvas.evaluate((svg) => svg.getBoundingClientRect().width);
    expect(10 * actualWidth * (await stored(page)).viewport.zoom / 9000).toBeGreaterThanOrEqual(6);
    expect(await canvas.getAttribute("data-geometry")).toBe(baseline);
    expect((await stored(page)).viewport.gridStepMm).toBe(100);
  });
}

test("resizing the open canvas clamps zoom to its new measured width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await openGraph(page, graphRectangle(), { zoom: 16.875 });
  const before = (await stored(page)).plan.draft;
  await page.setViewportSize({ width: 430, height: 812 });
  const canvas = page.locator("svg[data-geometry]");
  const width = await canvas.evaluate((svg) => svg.getBoundingClientRect().width);
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBeCloseTo(Math.max(8, 5400 / width), 3);
  expect((await stored(page)).plan.draft).toEqual(before);
  expect((await stored(page)).viewport.gridStepMm).toBe(100);
});

test("pointer cancellation restores the last committed viewport", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить полотно", exact: true }).click();
  const canvas = page.locator("svg[data-geometry]");
  const before = await canvas.getAttribute("viewBox");
  const beforeViewport = (await stored(page)).viewport;
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 1301, x: 220, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 1301, x: 255, y: 450 }]);
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(before);
  await touch.dispatch("touchCancel", []);
  expect((await stored(page)).viewport).toEqual(beforeViewport);
  await touch.close();
});

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
    const viewport = (await stored(page)).viewport;
    await page.reload();
    await expect.poll(async () => (await stored(page)).viewport).toEqual(viewport);
  });
}

test("snap preview has no type label", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Стена", exact: true }).click();
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

test("second finger interrupts touch drag without creating a wall", async ({ page }) => {
  await openGraph(page, { vertices: [], segments: [], chains: [], voids: [], constraints: [], fieldInputs: {} },
    { centerX: 500, centerY: 500, zoom: 4 });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const touch = await touchSession(page);
  const first = { id: 91, x: 140, y: 340 };
  const second = { id: 92, x: 230, y: 340 };
  await touch.dispatch("touchStart", [first]);
  await touch.dispatch("touchMove", [{ ...first, x: 170, y: 360 }]);
  await expect(page.locator(".physical-wall-preview")).toHaveCount(0);
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
    const preview = await page.locator(".physical-wall-preview").getAttribute("d");
    expect(preview).toContain("50");
    await page.mouse.up();
    await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(index + 2);
    const draft = (await stored(page)).plan.draft;
    const chain = draft.chains.at(-1);
    expect(draft.vertices.find((v: any) => v.id === chain.endVertexId).y).toBe(0);
  }
});



test("touch sidebar starts closed in portrait and wide landscape and keeps manual choice", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openGraph(page, graphRectangle(), {}, false);
  const toggle = page.locator(".canvas-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Стена", exact: true })).toHaveCount(0);
  await setSidebarOpen(page, true);
  await expect(page.getByRole("button", { name: "Стена", exact: true })).toBeVisible();
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
        expect(zoom).toBeLessThanOrEqual(Math.max(8, 5400 / (await canvas.evaluate((svg) => svg.getBoundingClientRect().width))));
      }
      await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Перемещение вершины" })).toHaveCount(0);
    }
    expect((await stored(page)).plan.draft).toEqual(initialDraft);
    expect(await canvas.getAttribute("viewBox")).not.toBeNull();
    await touch.close();
  });
}



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
  const canvas = page.locator("svg[data-geometry]");
  const maxZoom = Math.max(8, 5400 / (await canvas.evaluate((svg) => svg.getBoundingClientRect().width)));
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBeCloseTo(maxZoom, 3);
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



for (const width of [320, 430]) {
  test(`mobile controls fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await openGraph(page, graphRectangle());
    await expect(page.getByRole("button", { name: "Увеличить" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Стена", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
