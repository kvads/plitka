import { canvasPick, goStage, selectRoomByIndex, selectTool, setSidebarOpen } from "./fixtures/projects";
import { test, expect } from "@playwright/test";
import {
  openProject,
  openGraph,
  graphTwoRooms,
  graphValidate,
  confirmRoom,
  toRules,
  commit,
  settle,
  stored,
} from "./fixtures/projects";

test("wheel zoom stays anchored at the cursor and never scrolls the page over canvas", async ({ page }) => {
  await openGraph(page, graphRectangle(2000, 2000), { centerX: 1000, centerY: 1000, zoom: 2 });
  const canvas = page.locator("svg[data-geometry]");
  const start = await screenPoint(page, 1100, 1100);
  const point = { x: Math.round(start.x), y: Math.round(start.y) };
  await page.mouse.move(point.x, point.y);
  const anchor = await canvas.evaluate((svg, client) => {
    const p = new DOMPoint(client.x, client.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!.inverse());
    return { x: p.x, y: -p.y };
  }, point);
  const before = await canvas.getAttribute("data-geometry");
  const initialZoom = (await stored(page)).viewport.zoom;
  let firstZoom = initialZoom;
  for (const delta of [...Array(10).fill(-25), ...Array(10).fill(25)]) {
    await page.mouse.wheel(0, delta);
    await expect.poll(async () => (await stored(page)).viewport.zoom).toBeGreaterThan(0);
    const previousZoom = (await stored(page)).viewport.zoom;
    if (delta < 0) firstZoom = previousZoom;
    const now = await screenPoint(page, anchor.x, anchor.y);
    expect(Math.hypot(now.x - point.x, now.y - point.y)).toBeLessThanOrEqual(2);
  }
  expect(firstZoom).toBeGreaterThan(initialZoom);
  expect((await stored(page)).viewport.zoom).toBeLessThan(firstZoom);
  expect(await canvas.getAttribute("data-geometry")).toBe(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const width = await canvas.evaluate((svg) => svg.getBoundingClientRect().width);
  expect((await stored(page)).viewport.zoom).toBeLessThanOrEqual(Math.max(8, 5400 / width));
  await page.mouse.wheel(0, -5000);
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBeCloseTo(Math.max(8, 5400 / width), 3);
  const upper = (await stored(page)).viewport;
  await page.mouse.wheel(0, -5000);
  expect((await stored(page)).viewport).toEqual(upper);
  await page.mouse.wheel(0, 5000);
  await expect.poll(async () => (await stored(page)).viewport.zoom).toBe(0.2);
  const lower = (await stored(page)).viewport;
  await page.mouse.wheel(0, 5000);
  expect((await stored(page)).viewport).toEqual(lower);
  for (const tool of ["Стена"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    const cursor = await screenPoint(page, anchor.x, anchor.y);
    await page.mouse.move(Math.round(cursor.x), Math.round(cursor.y));
    for (const delta of [...Array(10).fill(-25), ...Array(10).fill(25)]) {
      await page.mouse.wheel(0, delta);
      const current = await screenPoint(page, anchor.x, anchor.y);
      expect(Math.hypot(current.x - Math.round(cursor.x), current.y - Math.round(cursor.y))).toBeLessThanOrEqual(2);
    }
  }
  await setSidebarOpen(page, true);
  const sidebar = page.locator(".canvas-sidebar");
  await sidebar.evaluate((node) => {
    const spacer = document.createElement("div");
    spacer.style.cssText = "min-height:1000px; flex:none";
    node.appendChild(spacer);
  });
  const box = await sidebar.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => sidebar.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

test("selected wall exposes three temporary handles and arrows nudge by one millimeter", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await canvasPick(page, "segment", "as0");
  await expect(page.locator("[data-wall-handle]")).toHaveCount(3);
  await expect(page.locator('.wall-chevron, .wall-direction-marker, [data-wall-direction]')).toHaveCount(0);
  await page.locator('[data-wall-handle="end"]').click();
  await page.getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: { id: string }) => v.id === "av1")?.x).toBe(4001);
  await selectTool(page, 'Выбрать');
  await expect(page.locator("[data-wall-handle]")).toHaveCount(0);
});

test("ten wall-end arrow presses are one millimeter each and Undo reverses the last", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await canvasPick(page, "segment", "as0");
  await page.locator('[data-wall-handle="end"]').click();
  const arrow = page.getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" });
  for (let n = 1; n <= 10; n++) {
    await arrow.click();
    await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: { id: string }) => v.id === "av1")?.x).toBe(4000 + n);
  }
  await page.getByRole("button", { name: "Отменить правку" }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: { id: string }) => v.id === "av1")?.x).toBe(4009);
});

test("center handle moves both ends of the selected wall and keeps distant corners", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await canvasPick(page, "segment", "as0");
  await page.locator('[data-wall-handle="center"]').click();
  await page.getByRole("button", { name: "Сдвинуть стену → на 1 мм" }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices[0].x).toBe(1);
  const vertices = (await stored(page)).plan.draft.vertices;
  expect(vertices.map((vertex: { x: number }) => vertex.x)).toEqual([1, 4001, 4000, 0]);
});

test("invalid wall nudge leaves draft revision unchanged and permits another arrow", async ({ page }) => {
  const graph = {
    vertices: [{ id: "a", x: 0, y: 0 }, { id: "m", x: 1000, y: 0 }, { id: "b", x: 2000, y: 0 }, { id: "far", x: 1000, y: 1000 }],
    segments: [{ id: "s0", startVertexId: "a", endVertexId: "m", chainId: "main" },
      { id: "s1", startVertexId: "m", endVertexId: "b", chainId: "main" },
      { id: "branch", startVertexId: "m", endVertexId: "far", chainId: "side" }],
    chains: [{ id: "main", startVertexId: "a", endVertexId: "b", segmentIds: ["s0", "s1"], thicknessMm: 100 },
      { id: "side", startVertexId: "m", endVertexId: "far", segmentIds: ["branch"], thicknessMm: 100 }],
    voids: [], constraints: [], fieldInputs: {},
  };
  await openGraph(page, graph);
  await canvasPick(page, "segment", "s0");
  await page.locator('[data-wall-handle="end"]').click();
  const before = await stored(page);
  await page.getByRole("button", { name: "Сдвинуть точку стены ↑ на 1 мм" }).click();
  await expect(page.getByRole("alert")).toContainText("прямолинейность");
  expect((await stored(page)).plan.draftRevision).toBe(before.plan.draftRevision);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  await page.getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: { id: string }) => v.id === "b")?.x).toBe(2001);
});

test("wall mouse cursor is a ten millimeter textured square", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await selectTool(page, 'Стена');
  const point = await screenPoint(page, 1500, 1500);
  await page.mouse.move(point.x, point.y);
  const cursor = page.locator(".wall-cursor");
  await expect(cursor).toHaveAttribute("width", "10");
  await expect(cursor).toHaveAttribute("height", "10");
  await expect(cursor).toHaveAttribute("fill", "url(#wall-cursor-hatch)");
  expect((await stored(page)).plan.draft.chains).toHaveLength(4);
});

test("wall thickness keeps room identity and blocks an unusable room", async ({ page }) => {
  await openGraph(page, graphRectangle(2000, 2000), { centerX: 1000, centerY: 1000, zoom: 2 });
  await expect.poll(async () => (await stored(page)).rooms.length).toBe(1);
  await confirmRoom(page);
  const roomId = (await stored(page)).rooms[0].id;
  await canvasPick(page, "segment", "as0");
  const field = page.getByLabel("Толщина выбранной стены");
  await field.fill("200");
  await field.press("Enter");
  await expect.poll(async () => (await stored(page)).plan.draft.chains[0].thicknessMm).toBe(200);
  expect((await stored(page)).rooms[0].id).toBe(roomId);
  await field.fill("5000");
  await field.press("Enter");
  await expect.poll(async () => (await stored(page)).plan.draft.chains[0].thicknessMm).toBe(5000);
  await page.reload();
  await settle(page);
  expect((await stored(page)).rooms[0].id).toBe(roomId);
  expect((await stored(page)).plan.draft.chains[0].thicknessMm).toBe(5000);
  await goStage(page, 'variants');
  await expect(page.getByRole("button", { name: "Подобрать раскладку", exact: true })).toBeDisabled();
});

test("diagnostic vertices have names without numeric coordinates", async ({ page }) => {
  const graph = graphRectangle();
  graph.vertices[1].x = graph.vertices[0].x;
  graph.vertices[1].y = graph.vertices[0].y;
  await openGraph(page, graph);
  const parameters = page.getByRole("button", { name: "Параметры", exact: true });
  if (await parameters.getAttribute("aria-expanded") === "false") await parameters.click();
  const issues = page.locator(".geometry-issues");
  await expect(issues).toContainText("Вершина");
  await expect(issues).not.toContainText(/\(\s*-?\d+\s*;\s*-?\d+\s*\)\s*мм/);
});

test("separate vertex creation and X/Y fields are absent", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await expect(page.getByRole("button", { name: "Добавить вершину", exact: true })).toHaveCount(0);
  await expect(page.getByText("Точное положение", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Новая вершина X")).toHaveCount(0);
  await expect(page.getByLabel("Новая вершина Y")).toHaveCount(0);
});

test("mouse sidebar stays open in a narrow window and closed controls leave tab order", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openGraph(page, graphRectangle(), {}, false);
  const toggle = page.locator(".canvas-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const stage = page.getByRole("button", { name: "1. План", exact: true });
  await expect(stage).toHaveAttribute("aria-current", "step");
  const tool = page.getByRole("button", { name: "Выбрать", exact: true });
  await expect(tool).toHaveAttribute("aria-pressed", "false");
  await expect(tool).toHaveAttribute("title", "Выбрать");
  await page.getByRole("button", { name: "2. Раскладка", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(tool).toBeFocused();
  await expect(page.locator(".sidebar-tooltip")).toHaveText("Выбрать");
  await selectTool(page, 'Стена');
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tool).toHaveCount(0);
  await expect(stage).toHaveCount(0);
  await page.getByRole("button", { name: "Раскрыть меню", exact: true }).click();
  await expect(page.getByRole("button", { name: "Стена", exact: true })).toHaveAttribute("aria-pressed", "true");
  await goStage(page, 'variants');
  await setSidebarOpen(page, true);
  await expect(page.getByRole("button", { name: "2. Раскладка", exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await page.getByRole("button", { name: "Раскрыть меню", exact: true }).click();
  await expect(page.getByRole("button", { name: "2. Раскладка", exact: true })).toHaveAttribute("aria-current", "step");
});
test("two pages use one canvas and retain values", async ({page}) => {
  await openProject(page); await expect(page.locator('[data-project-canvas]')).toHaveCount(1);
  await toRules(page); await commit(page,'Сторона плитки','650');
  await goStage(page, 'object');
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveCount(0);
  await goStage(page, 'variants');
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('650');
});
test("invalid material persists and comma input recovers", async ({ page }) => {
  await openProject(page);
  await confirmRoom(page);
  await goStage(page, 'variants');
  await commit(page, "Сторона плитки", "нет");
  await expect(
    page.getByRole("button", { name: "Подобрать раскладку", exact: true }),
  ).toBeDisabled();
  await settle(page);
  await page.reload();
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "нет",
  );
  await commit(page, "Сторона плитки", "600,5");
  await expect(
    page.getByRole("button", { name: "Подобрать раскладку", exact: true }),
  ).toBeEnabled();
});
test("material and rules limits do not auto calculate", async ({ page }) => {
  await openProject(page);
  await toRules(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v5/optimize")) calls++;
  });
  for (const [label, bad, good] of [
    ["Отступ от стен", "101", "10"],
    ["Минимальная ширина детали", "0", "100"],
    ["Угол укладки", "90", "0"],
  ]) {
    await commit(page, label, bad);
    await expect(
      page.getByRole("button", { name: "Подобрать раскладку", exact: true }),
    ).toBeDisabled();
    await commit(page, label, good);
    await expect(
      page.getByRole("button", { name: "Подобрать раскладку", exact: true }),
    ).toBeEnabled();
  }
  expect(calls).toBe(0);
});
test("two rooms retain separate parameters", async ({ page }) => {
  await openGraph(page, graphTwoRooms());
  await canvasPick(page, "room", 1);
  await confirmRoom(page);
  await goStage(page, 'variants');
  await commit(page, "Сторона плитки", "700");
  await goStage(page, 'object');
  await canvasPick(page, "room", 2);
  await confirmRoom(page);
  await goStage(page, 'variants');
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "600",
  );
  await settle(page);
  expect(
    (await stored(page)).rooms.some((r: any) => r.material.tile === 700),
  ).toBeTruthy();
});


test("numeric inset may launch and fail without losing input", async ({
  page,
}) => {
  const graph = graphTwoRooms();
  graph.vertices = graph.vertices.filter((v) => v.id.startsWith("a"));
  graph.segments = graph.segments.filter((v) => v.id.startsWith("a"));
  graph.chains = graph.chains.filter((v) => v.id.startsWith("a"));
  graph.vertices.forEach((v) => {
    v.x *= 0.05;
  });
  await openGraph(page, graph);
  await toRules(page);
  await commit(page, "Отступ от стен", "50");
  await page
    .getByRole("button", { name: "Подобрать раскладку", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Отступ от стен", { exact: true })).toHaveValue(
    "50",
  );
  await commit(page, "Отступ от стен", "1");
  await page
    .getByRole("button", { name: "Подобрать раскладку", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Таблица деталей · CSV", exact: true }),
  ).toBeEnabled();
});
async function screenPoint(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
) {
  return page.getByRole("group", { name: "Редактор плана помещений" }).evaluate(
    (svg, p) => {
      const q = new DOMPoint(p.x, -p.y).matrixTransform(
        (svg as SVGSVGElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}
async function drawWallStroke(page: import("@playwright/test").Page, x1: number, y1: number, x2: number, y2: number) {
  await selectTool(page, 'Стена');
  const start = await screenPoint(page, x1, y1);
  const end = await screenPoint(page, x2, y2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}
test("failed dimension in independent room does not block selected room", async ({
  page,
}) => {
  await openGraph(page, graphTwoRooms());
  await canvasPick(page, "room", 1);
  await confirmRoom(page);
  await settle(page);
  const d = await stored(page),
    selected = d.rooms.find((r: any) => r.id === d.selectedRoomId),
    selectedFace = (await graphValidate(page, d.plan.draft)).faces.find((face: any) => face.topologyKey === selected.topologyKey),
    prefix = selectedFace.outer[0].segmentId[0] === "a" ? "b" : "a";
  await selectTool(page, 'Выбрать');
  await canvasPick(page, "segment", prefix + "s0");
  await commit(page, "Общая длина стены", "-1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Далее", exact: true })).toHaveCount(0);
});

test("clear project ignores an old geometry response after clear and Undo", async ({
  page,
}) => {
  await openGraph(page, graphTwoRooms());
  const before = await stored(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/plan/validate", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await setSidebarOpen(page, true); await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Очистить проект", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Очистить", exact: true })
    .click();
  await expect(page.locator("[data-geometry]")).toHaveAttribute(
    "data-geometry",
    /"vertices":\[\]/,
  );
  release();
  await settle(page);
  expect((await stored(page)).rooms).toEqual([]);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
});

import { clearProject, fullGraphDocument } from "./fixtures/projects";
test("context stage forms keep room settings when a wall is selected", async ({
  page,
}) => {
  await openGraph(page, graphTwoRooms());
  await confirmRoom(page);
  await goStage(page, 'variants');
  await commit(page, "Сторона плитки", "700");
  await goStage(page, 'variants');
  await commit(page, "Отступ от стен", "15");
  await goStage(page, 'object');
  await selectTool(page, 'Выбрать');
  await canvasPick(page, "segment", "as0");
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Отступ от стен", { exact: true })).toHaveCount(
    0,
  );
  await goStage(page, 'variants');
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "700",
  );
  await clearProject(page);
  await settle(page);
  expect((await stored(page)).rooms).toEqual([]);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await goStage(page, 'variants');
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "700",
  );
  expect(
    (await stored(page)).rooms.find((r: any) => r.material.tile === 700).rules
      .gap,
  ).toBe(15);
});

import { openDocument, graphRectangle, chooseAngle } from "./fixtures/projects";
for (const operation of [
  "command",
  "validate",
  "optimize",
  "layout",
] as const)
  for (const failure of [false, true])
    for (const undo of [false, true])
      test(`clear project late ${operation} ${failure ? "error" : "success"} cannot cross ${undo ? "clear Undo" : "clear only"}`, async ({
        page,
      }) => {
        if (operation === "legacy")
          await openDocument(page, await fullGraphDocument("legacyV2"));
        else await openGraph(page, graphRectangle(1800, 1200));
        if (operation === "optimize" || operation === "layout") {
          await toRules(page);
          if (operation === "layout") {
            await page
              .getByRole("button", { name: "Подобрать раскладку", exact: true })
              .click();
            await expect(
              page.getByLabel("Сдвиг X", { exact: true }),
            ).toBeVisible();
          }
        }
        let release!: () => void, started!: () => void, finished!: () => void;
        const gate = new Promise<void>((r) => (release = r)),
          begin = new Promise<void>((r) => (started = r)),
          done = new Promise<void>((r) => (finished = r));
        let captured = false;
        const endpoint =
          operation === "legacy"
            ? "geometry/solve"
            : operation === "command" || operation === "validate"
              ? "plan/" + operation
              : "v5/" + operation;
        await page.route("**/api/" + endpoint, async (route) => {
          if (captured) {
            await route.continue();
            return;
          }
          captured = true;
          const response = await route.fetch();
          started();
          await gate;
          if (failure)
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                error: { message: "Запоздавшая ошибка" },
              }),
            });
          else await route.fulfill({ response });
          finished();
        });
        if (operation === "command" || operation === "validate") {
          await canvasPick(page, "segment", "as0");
          await commit(
            page,
            "Общая длина стены",
            operation === "command" ? "1900" : "ошибка",
          );
        } else if (operation === "legacy") {
          await page
            .getByRole("button", { name: "Параметры", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Повторить действие", exact: true })
            .click();
        } else if (operation === "optimize")
          await page
            .getByRole("button", { name: "Подобрать раскладку", exact: true })
            .click();
        else await commit(page, "Сдвиг X", "15");
        await begin;
        await clearProject(page);
        if (undo)
          await page
            .getByRole("button", { name: "Отменить правку", exact: true })
            .click();
        await settle(page);
        const after = await stored(page);
        release();
        await done;
        await expect(
          page.getByText("Запоздавшая ошибка", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "2. Раскладка", exact: true }),
        ).toBeEnabled();
        expect((await stored(page)).plan).toEqual(after.plan);
      });
for (const target of ["object", "tile", "rules", "variants"] as const)
  test(`clear project available at ${target} stage preserves metadata and cancellation`, async ({
    page,
  }) => {
    await openProject(page);
    await toRules(page);
    if (target === "variants") {
      await page
        .getByRole("button", { name: "Подобрать раскладку", exact: true })
        .click();
      await expect(page.locator(".variant-list button").first()).toBeVisible();
    }
    if (target === "tile") await goStage(page, 'variants');
    if (target === "object") await goStage(page, 'object');
    await settle(page);
    const before = await stored(page);
    await setSidebarOpen(page, true); await page.getByRole("button", { name: "Проект", exact: true }).click();
    await page
      .getByRole("button", { name: "Очистить проект", exact: true })
      .click();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    expect((await stored(page)).plan).toEqual(before.plan);
    await clearProject(page);
    await settle(page);
    const after = await stored(page);
    expect([after.id, after.name, after.address]).toEqual([
      before.id,
      before.name,
      before.address,
    ]);
    expect(after.plan.draft.vertices).toEqual([]);
    expect(after.rooms).toEqual([]);
    expect(after.workflow.requestedStage).toBe("object");
    await expect(
      page.getByRole("button", { name: "2. Раскладка", exact: true }),
    ).toBeEnabled();
  });



import { deletionProjects, projectCatalog, openDelete } from './fixtures/projects';
test('delete project from editor closes it permanently', async ({ page }) => {
  await deletionProjects(page, 1);
  await page.getByRole('link', { name: 'Открыть проект Одинаковое имя' }).click();
  await settle(page);
  await setSidebarOpen(page, true); await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить проект', exact: true }).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  expect((await projectCatalog(page)).projects).toEqual([]);
});
test('delete project from another tab closes active editor', async ({ page, context }) => {
  await deletionProjects(page, 1);
  await page.getByRole('link', { name: 'Открыть проект Одинаковое имя' }).click();
  await settle(page);
  const other = await context.newPage(); await other.goto('/');
  const dialog = await openDelete(other);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  expect((await projectCatalog(page)).projects).toEqual([]);
});

import { deleteFromEditor } from "./fixtures/projects";
for (const operation of [
  "command",
  "validate",
  "optimize",
  "layout",
] as const)
  for (const failure of [false, true])
      test(`delete project late ${operation} ${failure ? "error" : "success"} ignored`, async ({
        page,
      }) => {
        if (operation === "legacy")
          await openDocument(page, await fullGraphDocument("legacyV2"));
        else await openGraph(page, graphRectangle(1800, 1200));
        if (operation === "optimize" || operation === "layout") {
          await toRules(page);
          if (operation === "layout") {
            await page
              .getByRole("button", { name: "Подобрать раскладку", exact: true })
              .click();
            await expect(
              page.getByLabel("Сдвиг X", { exact: true }),
            ).toBeVisible();
          }
        }
        let release!: () => void, started!: () => void, finished!: () => void;
        const gate = new Promise<void>((r) => (release = r)),
          begin = new Promise<void>((r) => (started = r)),
          done = new Promise<void>((r) => (finished = r));
        let captured = false;
        const endpoint =
          operation === "legacy"
            ? "geometry/solve"
            : operation === "command" || operation === "validate"
              ? "plan/" + operation
              : "v5/" + operation;
        await page.route("**/api/" + endpoint, async (route) => {
          if (captured) {
            await route.continue();
            return;
          }
          captured = true;
          const response = await route.fetch();
          started();
          await gate;
          if (failure)
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                error: { message: "Запоздавшая ошибка" },
              }),
            });
          else await route.fulfill({ response });
          finished();
        });
        if (operation === "command" || operation === "validate") {
          await canvasPick(page, "segment", "as0");
          await commit(
            page,
            "Общая длина стены",
            operation === "command" ? "1900" : "ошибка",
          );
        } else if (operation === "legacy") {
          await page
            .getByRole("button", { name: "Параметры", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Повторить действие", exact: true })
            .click();
        } else if (operation === "optimize")
          await page
            .getByRole("button", { name: "Подобрать раскладку", exact: true })
            .click();
        else await commit(page, "Сдвиг X", "15");
        await begin;
        await deleteFromEditor(page);
        release();
        await done;
        await expect(
          page.getByText("Запоздавшая ошибка", { exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
        expect((await projectCatalog(page)).projects).toEqual([]);
      });

for (const width of [375, 1440])
test(`delete project tile stage accessible dialog ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openProject(page); await settle(page); await confirmRoom(page);
  await goStage(page, 'variants');
  await setSidebarOpen(page, true);
  await setSidebarOpen(page, true); await page.getByRole('button', { name: 'Проект', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Удалить проект', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Удалить проект', exact: true });
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.screenshot({ path: `/home/kvasy/vibe/plitka/frontend/test-results/delete-dialog-${width}.png` });
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await deleteFromEditor(page);
});
test('delete project changed local draft requires fresh confirmation', async ({ page }) => {
  await openGraph(page, graphRectangle(1800,1200));
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>(r => release = r), begin = new Promise<void>(r => started = r), done = new Promise<void>(r => finished = r);
  await page.route('**/api/plan/command', async route => {
    const response = await route.fetch(); started(); await gate;
    await route.fulfill({ response }); finished();
  });
  await canvasPick(page, 'segment', 'as0'); await commit(page, 'Общая длина стены', '1900'); await begin;
  await setSidebarOpen(page, true); await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  release(); await done;
  await expect.poll(async () => (await stored(page)).plan.pendingEdit).toBeNull();
  const dialog = page.getByRole('dialog', { name: 'Удалить проект', exact: true });
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('изменён');
  expect((await projectCatalog(page)).projects).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
});

test('delete project older parent without removal callback still returns to list', async ({ page }) => {
  // Simulate an editor parent loaded before the removal callback was introduced.
  await page.route('**/src/Projects.tsx', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('onRemoved: removed,');
    await route.fulfill({ response, body: source.replace('onRemoved: removed,', 'onRemoved: undefined,') });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await deletionProjects(page, 1);
  await page.getByRole('link', { name: 'Открыть проект Одинаковое имя' }).click();
  await settle(page);
  await deleteFromEditor(page);
  expect((await projectCatalog(page)).projects).toEqual([]);
  await expect(page.getByRole('dialog', { name: 'Удалить проект', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('room flow two pages allow navigation without confirmation', async ({ page }) => {
  await openGraph(page, graphTwoRooms());
  await expect(page.getByRole('button', { name: '1. План', exact: true })).toBeVisible();
  await goStage(page, 'variants');
  await expect(page.locator('.room-face')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Помещение', exact: true })).toHaveCount(0);
  await expect(page.getByText('Подтверждаю показанные размеры', { exact: true })).toHaveCount(0);
});

async function flowRoom(page: import('@playwright/test').Page) {
  await openGraph(page, graphTwoRooms());
  await goStage(page, 'variants');
  await selectRoomByIndex(page, 1);
}
test('room flow individual settings names and reload', async ({page}) => {
  await flowRoom(page);
  await commit(page,'Сторона плитки','700');
  await page.getByLabel('Название помещения').fill('Кухня');
  await page.getByLabel('Название помещения').press('Enter');
  await selectRoomByIndex(page, 2);
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('600');
  await selectRoomByIndex(page, 1);
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('700');
  await settle(page); await page.reload();
  await expect(page.getByLabel('Название помещения')).toHaveValue('Кухня');
  await expect(page.locator('[data-room-label]').filter({hasText:'Кухня'})).toHaveCount(1);
});
test('room flow actual calculation exports and navigation', async ({page}) => {
  await flowRoom(page);
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await goStage(page, 'object');
  await goStage(page, 'variants');
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'Закрепить раскладку'}).click();
  await expect(page.getByLabel('Сдвиг X',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Разблокировать',exact:true}).click();
  await commit(page,'Сдвиг X','20');
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
});
for (const mode of ['success','error']) test(`room flow background optimize ${mode}`, async ({page}) => {
  await flowRoom(page);
  let release!: () => void;
  const gate = new Promise<void>(r => release=r);
  await page.route('**/api/v5/optimize', async route => {
    await gate;
    if(mode==='error') await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:'Контрольная ошибка'})});
    else await route.continue();
  });
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await goStage(page, 'object'); release();
  await goStage(page, 'variants');
  if(mode==='success') await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  else await expect(page.getByRole('alert').filter({hasText:'Контрольная ошибка'})).toBeVisible();
});
test('room flow invalid material blocks only calculation',async({page})=>{
  await flowRoom(page); await commit(page,'Сторона плитки','нет');
  await expect(page.getByRole('button',{name:'Подобрать раскладку',exact:true})).toBeDisabled();
  await goStage(page, 'object');
  await goStage(page, 'variants');
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('нет');
});

for (const mode of ['success','error']) test(`room flow background manual layout ${mode}`,async({page})=>{
  await flowRoom(page); await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  let release!:()=>void; const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/v5/layout',async route=>{await gate; if(mode==='error')await route.fulfill({status:500,contentType:'application/json',body:'{"detail":"Ошибка сдвига"}'});else await route.continue();});
  await commit(page,'Сдвиг X','25'); await goStage(page, 'object');release();
  await goStage(page, 'variants');
  if(mode==='success') { await expect(page.getByRole('button',{name:'Отменить сдвиг'})).toHaveCount(0); await expect(page.getByLabel('Сдвиг X',{exact:true})).toHaveValue('25'); }
  else {await expect(page.getByRole('alert').filter({hasText:'Ошибка сдвига'})).toBeVisible();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeDisabled();await page.getByRole('button',{name:'Отменить сдвиг'}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();}
});

for (const width of [375,1440]) test(`room flow labels and keyboard at width ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await flowRoom(page);
  await expect(page.locator('[data-room-label]')).toHaveCount(2);
  await page.getByLabel('Название помещения').fill('');await page.getByLabel('Название помещения').press('Enter');
  await expect(page.getByLabel('Название помещения')).not.toHaveValue('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/home/kvasy/vibe/plitka/frontend/test-results/room-flow-${width}.png`});
});

import {graphRectangle as flowRectangle, graphWithVoid as flowVoid} from './fixtures/projects';
for(const [mm,label] of [[999.9,'999,9 мм'],[1000,'1000 мм'],[3175,'3175 мм'],[3175.5,'3175,5 мм']] as const) test(`room flow dimensions ${mm} retain exact coordinates`,async({page})=>{
  await openGraph(page,flowRectangle(mm,2000));
  await expect(page.locator('svg text').filter({hasText:label}).first()).toBeVisible();
  const before=(await stored(page)).plan.draft;
  const canvas = page.locator('svg[data-geometry]');const box=await canvas.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.wheel(0,-250);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('svg text').filter({hasText:label}).first()).toBeVisible();
  expect((await stored(page)).plan.draft).toEqual(before);
});
test('room flow split does not transfer parameters and merge restores boundary',async({page})=>{
  await flowRoom(page);await commit(page,'Сторона плитки','777');await settle(page);
  const original=(await stored(page)).selectedRoomId;
  await goStage(page, 'object');
  const originalChains=new Set((await stored(page)).plan.draft.chains.map((chain:{id:string})=>chain.id));
  await drawWallStroke(page,0,0,4000,3000);await settle(page);
  const split=await stored(page);expect(split.rooms.find((r:any)=>r.id===original).binding).toBe('detached');
  expect(split.rooms.filter((r:any)=>r.binding==='attached').every((r:any)=>r.material.tile===600)).toBe(true);
  const diagonalChain=split.plan.draft.chains.find((chain:{id:string})=>!originalChains.has(chain.id));
  const diagonal=split.plan.draft.segments.find((segment:{id:string})=>segment.id===diagonalChain.segmentIds[0]);
  await selectTool(page, 'Выбрать');await canvasPick(page,'segment',diagonal.id);
  page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Удалить стену',exact:true}).click();await settle(page);
  expect((await stored(page)).rooms.find((r:any)=>r.id===original).binding).toBe('attached');
  expect((await stored(page)).rooms.find((r:any)=>r.id===original).material.tile).toBe(777);
});
test('room flow void label is placed outside excluded area',async({page})=>{
  await openGraph(page,flowVoid());await expect(page.locator('[data-room-label]')).toHaveCount(1);
  const pos=await page.locator('[data-room-label]').evaluate(el=>[Number(el.getAttribute('x')),Number(el.getAttribute('y'))]);
  const g=(await stored(page)).plan.draft;
  const hole=g.voids[0].boundary.map((r:any)=>{const s=g.segments.find((s:any)=>s.id===r.segmentId);return g.vertices.find((v:any)=>v.id===s.startVertexId);});
  expect(pos[0]<Math.min(...hole.map((v:any)=>v.x))||pos[0]>Math.max(...hole.map((v:any)=>v.x))||pos[1]<Math.min(...hole.map((v:any)=>v.y))||pos[1]>Math.max(...hole.map((v:any)=>v.y))).toBe(true);
});
test('room flow old optimization cannot replace another selection',async({page})=>{
  await flowRoom(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/v5/optimize',async route=>{await gate;await route.continue();});
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await selectRoomByIndex(page, 2);
  const response=page.waitForResponse('**/api/v5/optimize');release();await response;
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Подобрать раскладку',exact:true})).toBeEnabled();
});

test('room flow physical area and request invariant under zoom resize',async({page})=>{
  const g=flowRectangle(4000,3000);
  await openGraph(page,g);await toRules(page);
  const run=async()=>{const response=page.waitForResponse('**/api/v5/optimize');await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();const r=await response;return {input:r.request().postDataJSON(),output:await r.json()};};
  const first=await run();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  const canvas=page.locator('svg[data-geometry]');const box=await canvas.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.wheel(0,-250);await page.setViewportSize({width:1440,height:900});
  const second=await run();expect(second.input).toEqual(first.input);expect(second.output).toEqual(first.output);
  expect(first.output.variants[0].metrics.room_area).toBeGreaterThan(9_000_000);
  expect(first.output.variants[0].metrics.room_area * 10).toBe(Math.round(first.output.variants[0].metrics.room_area * 10));
});
test('room flow setting same length as fixed invalidates previous result',async({page})=>{
  await flowRoom(page);await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await goStage(page, 'object');await selectTool(page, 'Выбрать');await canvasPick(page,'segment','as0');
  await commit(page,'Общая длина стены','4000');await settle(page);
  await goStage(page, 'variants');await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeDisabled();
});
test('room flow alternatives details download and rename preserve result',async({page})=>{
  await flowRoom(page);await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  const choices=page.locator('.variant-list button');expect(await choices.count()).toBeGreaterThan(1);await choices.nth(1).click();
  await page.getByLabel('Деталь',{exact:true}).selectOption({index:1});
  await page.getByLabel('Название помещения').fill('Новое имя');await page.getByLabel('Название помещения').press('Enter');
  for(const label of ['План с размерами · SVG','Таблица деталей · CSV']) {
    const download=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();
    expect((await download).suggestedFilename()).toMatch(/\.(svg|csv)$/);
  }
});

test('idle canvas pans, repeated tool and Escape return to idle without editing geometry', async ({ page }) => {
  await openGraph(page, graphRectangle(), { centerX: 2000, centerY: 1500, zoom: 3 });
  await expect(page.getByRole('button', { name: 'Переместить полотно' })).toHaveCount(0);
  const before = await stored(page);
  const canvas = page.locator('svg[data-geometry]');
  const box = await canvas.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 30); await page.mouse.up();
  await expect.poll(async () => (await stored(page)).viewport.centerX).not.toBe(before.viewport.centerX);
  expect((await stored(page)).plan).toEqual(before.plan);
  await selectTool(page, 'Стена');
  await expect(page.getByRole('button', { name: 'Раскрыть меню' })).toBeVisible();
  await page.getByRole('button', { name: 'Раскрыть меню' }).click();
  await selectTool(page, 'Стена');
  await expect(page.getByRole('button', { name: 'Раскрыть меню' })).toBeVisible();
  await page.locator('svg[data-geometry]').focus();
  await page.keyboard.press('Escape');
  expect((await stored(page)).plan).toEqual(before.plan);
});

test.describe('mobile mode control', () => {
test.use({ hasTouch: true, isMobile: true });
for (const width of [320, 375, 430]) {
  test(`mobile mode menu and tool panel fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await openGraph(page, graphRectangle());
    await selectTool(page, 'Стена');
    await expect(page.getByRole('button', { name: 'Раскрыть меню' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Далее' })).toHaveCount(0);
    const mode = page.getByRole('button', { name: 'Режим: План' });
    await expect(mode).toBeVisible();
    await mode.click();
    const menu = page.getByRole('menu', { name: '' });
    await expect(menu.getByRole('menuitem', { name: 'Раскладка' })).toBeVisible();
    const modeBox = await mode.boundingBox(), menuBox = await menu.boundingBox();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(modeBox!.x + 1);
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    await menu.getByRole('menuitem', { name: 'Раскладка' }).click();
    await expect(page.getByRole('button', { name: 'Режим: Раскладка' })).toBeVisible();
    await page.getByRole('button', { name: 'Раскрыть меню' }).click();
    const sideBox = await page.locator('.canvas-sidebar-shell').boundingBox();
    const panelBox = await page.locator('.canvas-panel').boundingBox();
    expect(panelBox!.x).toBeGreaterThanOrEqual(sideBox!.x + sideBox!.width);
  });
}
test('mode controls remain reachable with large text and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await openGraph(page, graphRectangle());
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  const mode = page.getByRole('button', { name: 'Режим: План' });
  await expect(mode).toBeVisible();
  await mode.click();
  await expect(page.getByRole('menuitem', { name: 'Раскладка' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('menuitem', { name: 'Раскладка' }).press('Escape');
  await expect(mode).toBeFocused();
});
});
