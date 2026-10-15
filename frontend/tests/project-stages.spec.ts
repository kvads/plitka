import { canvasPick } from "./fixtures/projects";
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
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
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

test("precise X and Y fields still add a new vertex", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const parameters = page.getByRole("button", { name: "Параметры", exact: true });
  if (await parameters.getAttribute("aria-expanded") === "false") await parameters.click();
  await page.getByText("Точное положение", { exact: true }).click();
  await commit(page, "Новая вершина X", "2000");
  await commit(page, "Новая вершина Y", "1500");
  await page.getByRole("button", { name: "Поставить точку", exact: true }).click();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.length).toBe(5);
  expect((await stored(page)).plan.draft.vertices.at(-1)).toMatchObject({ x: 2000, y: 1500 });
});

test("mouse sidebar stays open in a narrow window and closed controls leave tab order", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openGraph(page, graphRectangle(), {}, false);
  const toggle = page.locator(".canvas-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const stage = page.getByRole("button", { name: "1. План", exact: true });
  await expect(stage).toHaveAttribute("aria-current", "step");
  const tool = page.getByRole("button", { name: "Выбрать", exact: true });
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  await expect(tool).toHaveAttribute("title", "Выбрать");
  await page.getByRole("button", { name: "2. Варианты", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(tool).toBeFocused();
  await expect(page.locator(".sidebar-tooltip")).toHaveText("Выбрать");
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await expect(toggle).toBeFocused();
  await expect(tool).toHaveCount(0);
  await expect(stage).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(toggle).not.toBeFocused();
  await page.getByRole("button", { name: "Раскрыть меню", exact: true }).click();
  await expect(page.getByRole("button", { name: "Добавить вершину", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await expect(page.getByRole("button", { name: "2. Варианты", exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await page.getByRole("button", { name: "Раскрыть меню", exact: true }).click();
  await expect(page.getByRole("button", { name: "2. Варианты", exact: true })).toHaveAttribute("aria-current", "step");
});
test("two pages use one canvas and retain values", async ({page}) => {
  await openProject(page); await expect(page.locator('[data-project-canvas]')).toHaveCount(1);
  await toRules(page); await commit(page,'Сторона плитки','650');
  await page.getByRole('button',{name:'1. План',exact:true}).click();
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('650');
});
test("invalid material persists and comma input recovers", async ({ page }) => {
  await openProject(page);
  await confirmRoom(page);
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
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
    if (r.url().endsWith("/api/optimize")) calls++;
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
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await commit(page, "Сторона плитки", "700");
  await page.getByRole("button", { name: "1. План", exact: true }).click();
  await canvasPick(page, "room", 2);
  await confirmRoom(page);
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "600",
  );
  await settle(page);
  expect(
    (await stored(page)).rooms.some((r: any) => r.material.tile === 700),
  ).toBeTruthy();
});
test("mobile overlays do not add points and keyboard focus remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openProject(page);
  await settle(page);
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  const count = (await stored(page)).plan.draft.vertices.length;
  await page.getByRole("button", { name: "Параметры", exact: true }).click();
  await page.getByRole("button", { name: "Параметры", exact: true }).click();
  expect((await stored(page)).plan.draft.vertices.length).toBe(count);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  if (
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .click();
  await page.getByRole("button", { name: "Параметры", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Инструмент", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/plitka-graph-mobile.png" });
});
test("mouse and keyboard edits keep immediate commands and Undo", async ({ page }) => {
  await openGraph(page, graphRectangle());
  const canvas = page.locator("svg[data-geometry]");
  const before = (await stored(page)).plan.draft;
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  const point = await screenPoint(page, 2000, 1500);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.length).toBe(5);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
  await page.getByRole("button", { name: "Переместить вершину", exact: true }).click();
  const origin = await screenPoint(page, 4000, 0);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x - 35, origin.y - 35);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.find((v: any) => v.id === "av1").x).not.toBe(4000);
  await expect(page.getByRole("group", { name: "Перемещение вершины" })).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить вершину", exact: true }).click();
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page)).plan.draft.vertices.length).toBe(6);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toHaveLength(5);
  expect((await stored(page)).plan.draft).not.toEqual(before);
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
for (const width of [375, 1440])
  test(`canvas node line snapping and drag cancellation ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openProject(page);
    await settle(page);
    await page.evaluate(() => {
      const key = "plitka-projects-v4",
        c = JSON.parse(localStorage.getItem(key)!);
      c.projects[0].viewport = {
        centerX: 2100,
        centerY: 1800,
        zoom: 8,
        gridStepMm: 100,
      };
      localStorage.setItem(key, JSON.stringify(c));
    });
    await page.reload();
    await settle(page);
    await page
      .getByRole("button", { name: "Добавить вершину", exact: true })
      .click();
    if (
      await page
        .getByRole("button", { name: "Закрыть параметры", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Закрыть параметры", exact: true })
        .click();
    const before = (await stored(page)).plan.draft.vertices.length;
    const node = await screenPoint(page, 2102, 1802);
    await page.mouse.click(node.x, node.y);
    await expect
      .poll(async () => (await stored(page)).plan.draft.vertices.length)
      .toBe(before + 1);
    const line = await screenPoint(page, 2102, 1750);
    await page.mouse.click(line.x, line.y);
    await expect
      .poll(async () => (await stored(page)).plan.draft.vertices.length)
      .toBe(before + 2);
    const vertices = (await stored(page)).plan.draft.vertices;
    expect(
      vertices.some((v: any) => v.x === 2100 && v.y === 1800),
    ).toBeTruthy();
    expect(
      vertices.some((v: any) => v.x === 2100 && Math.abs(v.y - 1750) < 0.01),
    ).toBeTruthy();
    await page.mouse.move(node.x, node.y);
    await page.mouse.down();
    await page.mouse.move(node.x + 40, node.y + 40);
    await page.mouse.up();
    await settle(page);
    expect((await stored(page)).plan.draft.vertices.length).toBe(before + 2);
    await page.screenshot({ path: `/tmp/plitka-graph-${width}.png` });
  });
test("touch adds one independent point and undo restores whole graph", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:5173",
    viewport: { width: 375, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await openProject(page);
  await settle(page);
  const before = (await stored(page)).plan.draft;
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .tap();
  if (
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .tap();
  const p = await screenPoint(page, 2500, 1800);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.getByRole("group", { name: "Размещение вершины" })).toBeVisible();
  await page.getByRole("button", { name: "Поставить вершину" }).tap();
  await expect
    .poll(async () => (await stored(page)).plan.draft.vertices.length)
    .toBe(before.vertices.length + 1);
  await page.getByRole("button", { name: "Параметры", exact: true }).tap();
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .tap();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before);
  await context.close();
});
test("pointer cancellation and Escape clear unfinished connections", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  await canvasPick(page, "vertex", 1);
  await page.keyboard.press("Escape");
  if (
    (await page
      .getByRole("button", { name: "Параметры", exact: true })
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByRole("button", { name: "Параметры", exact: true }).click();
  await expect(
    page.locator('[data-target^="vertex:"]').first(),
  ).not.toHaveClass(/selected/);
  await page
    .getByRole("button", { name: "Добавить вершину", exact: true })
    .click();
  if (
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Закрыть параметры", exact: true })
      .click();
  const before = (await stored(page)).plan.draft;
  const p = await screenPoint(page, 2200, 1700);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page
    .getByRole("group", { name: "Редактор плана помещений" })
    .dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: p.x,
      clientY: p.y,
    });
  await page.mouse.up();
  expect((await stored(page)).plan.draft).toEqual(before);
});
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
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", prefix + "s0");
  await commit(page, "Общая длина стены", "-1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled();
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
  await page.getByRole("button", { name: "Проект", exact: true }).click();
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
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await commit(page, "Сторона плитки", "700");
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await commit(page, "Отступ от стен", "15");
  await page.getByRole("button", { name: "1. План", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as0");
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Отступ от стен", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
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
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
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
              : operation;
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
          page.getByRole("button", { name: "2. Варианты", exact: true }),
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
    if (target === "tile")
      await page
        .getByRole("button", { name: "2. Варианты", exact: true })
        .click();
    if (target === "object")
      await page
        .getByRole("button", { name: "1. План", exact: true })
        .click();
    await settle(page);
    const before = await stored(page);
    await page.getByRole("button", { name: "Проект", exact: true }).click();
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
      page.getByRole("button", { name: "2. Варианты", exact: true }),
    ).toBeEnabled();
  });

test("context room settings survive object selection and clear Undo; new room gets defaults", async ({
  page,
}) => {
  const { addPoint } = await import("./fixtures/projects");
  await openProject(page);
  await toRules(page);
  await commit(page, "Отступ от стен", "17");
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await commit(page, "Сторона плитки", "700");
  await settle(page);
  const before = await stored(page);
  await page.getByRole("button", { name: "1. План", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", 1);
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveCount(
    0,
  );
  await canvasPick(page, "vertex", 1);
  await page.getByRole("button", { name: "2. Варианты", exact: true }).click();
  await expect(page.getByLabel("Сторона плитки", { exact: true })).toHaveValue(
    "700",
  );
  await clearProject(page);
  await settle(page);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).rooms).toEqual(before.rooms);
  await clearProject(page);
  await settle(page);
  for (const [x, y] of [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ])
    await addPoint(page, x, y);
  const ids = (await stored(page)).plan.draft.vertices.map((v: any) => v.id);
  await page
    .getByRole("button", { name: "Соединить стены", exact: true })
    .click();
  for (let i = 0; i < 4; i++) {
    await canvasPick(page, "vertex", ids[i]);
    await canvasPick(page, "vertex", ids[(i + 1) % 4]);
    await settle(page);
  }
  const rooms = (await stored(page)).rooms;
  expect(rooms).toHaveLength(1);
  expect(rooms[0].material.tile).toBe(600);
  expect(rooms[0].rules.gap).toBe(10);
});

import { deletionProjects, projectCatalog, openDelete } from './fixtures/projects';
test('delete project from editor closes it permanently', async ({ page }) => {
  await deletionProjects(page, 1);
  await page.getByRole('link', { name: 'Открыть проект Одинаковое имя' }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
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
              : operation;
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
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
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
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
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
  await page.getByRole('button', { name: '2. Варианты', exact: true }).click();
  await expect(page.getByLabel('Помещение', { exact: true })).toBeVisible();
  await expect(page.getByText('Подтверждаю показанные размеры', { exact: true })).toHaveCount(0);
});

async function flowRoom(page: import('@playwright/test').Page) {
  await openGraph(page, graphTwoRooms());
  await page.getByRole('button', {name:'2. Варианты',exact:true}).click();
  await page.getByLabel('Помещение',{exact:true}).selectOption({index:1});
}
test('room flow individual settings names and reload', async ({page}) => {
  await flowRoom(page);
  await commit(page,'Сторона плитки','700');
  await page.getByLabel('Название помещения').fill('Кухня');
  await page.getByLabel('Название помещения').press('Enter');
  await page.getByLabel('Помещение',{exact:true}).selectOption({index:2});
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('600');
  await page.getByLabel('Помещение',{exact:true}).selectOption({index:1});
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('700');
  await settle(page); await page.reload();
  await expect(page.getByLabel('Название помещения')).toHaveValue('Кухня');
  await expect(page.locator('[data-room-label]').filter({hasText:'Кухня'})).toHaveCount(1);
});
test('room flow actual calculation exports and navigation', async ({page}) => {
  await flowRoom(page);
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'1. План',exact:true}).click();
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
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
  await page.route('**/api/optimize', async route => {
    await gate;
    if(mode==='error') await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:'Контрольная ошибка'})});
    else await route.continue();
  });
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await page.getByRole('button',{name:'1. План',exact:true}).click(); release();
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
  if(mode==='success') await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  else await expect(page.getByRole('alert').filter({hasText:'Контрольная ошибка'})).toBeVisible();
});
test('room flow invalid material blocks only calculation',async({page})=>{
  await flowRoom(page); await commit(page,'Сторона плитки','нет');
  await expect(page.getByRole('button',{name:'Подобрать раскладку',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'1. План',exact:true}).click();
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
  await expect(page.getByLabel('Сторона плитки',{exact:true})).toHaveValue('нет');
});

for (const mode of ['success','error']) test(`room flow background manual layout ${mode}`,async({page})=>{
  await flowRoom(page); await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  let release!:()=>void; const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/layout',async route=>{await gate; if(mode==='error')await route.fulfill({status:500,contentType:'application/json',body:'{"detail":"Ошибка сдвига"}'});else await route.continue();});
  await commit(page,'Сдвиг X','25'); await page.getByRole('button',{name:'1. План',exact:true}).click();release();
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
  if(mode==='success') { await expect(page.getByRole('button',{name:'Отменить сдвиг'})).toHaveCount(0); await expect(page.getByLabel('Сдвиг X',{exact:true})).toHaveValue('25'); }
  else {await expect(page.getByRole('alert').filter({hasText:'Ошибка сдвига'})).toBeVisible();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeDisabled();await page.getByRole('button',{name:'Отменить сдвиг'}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();}
});
test('room flow restores renamed room after wall recreation with new IDs',async({page})=>{
  await flowRoom(page); await page.getByLabel('Название помещения').fill('Кухня');await page.getByLabel('Название помещения').press('Enter');await commit(page,'Сторона плитки','700');await settle(page);
  const before=await stored(page), room=before.rooms.find((r:any)=>r.id===before.selectedRoomId);
  await page.getByRole('button',{name:'1. План',exact:true}).click();
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();await canvasPick(page,'segment','as0');
  page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Удалить стену',exact:true}).click();await settle(page);
  expect((await stored(page)).rooms.find((r:any)=>r.id===room.id).binding).toBe('detached');
  await expect(page.locator('[data-room-label]').filter({hasText:'Кухня'})).toHaveCount(0);
  await page.reload();await settle(page);
  await page.getByRole('button',{name:'Соединить стены',exact:true}).click();
  await canvasPick(page,'vertex','av0');await canvasPick(page,'vertex','av1');await settle(page);
  const after=(await stored(page)).rooms.find((r:any)=>r.id===room.id);
  expect(after.binding).toBe('attached');expect(after.name).toBe('Кухня');expect(after.material.tile).toBe(700);
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
for(const [mm,label] of [[999.9,'999,9 мм'],[1000,'1 м'],[3175,'3,175 м'],[3175.5,'3,1755 м']] as const) test(`room flow dimensions ${mm} retain exact coordinates`,async({page})=>{
  await openGraph(page,flowRectangle(mm,2000));
  await expect(page.locator('svg text').filter({hasText:label}).first()).toBeVisible();
  const before=(await stored(page)).plan.draft;
  await page.getByRole('button',{name:'Увеличить',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('svg text').filter({hasText:label}).first()).toBeVisible();
  expect((await stored(page)).plan.draft).toEqual(before);
});
test('room flow split does not transfer parameters and merge restores boundary',async({page})=>{
  await flowRoom(page);await commit(page,'Сторона плитки','777');await settle(page);
  const original=(await stored(page)).selectedRoomId;
  await page.getByRole('button',{name:'1. План',exact:true}).click();await page.getByRole('button',{name:'Соединить стены',exact:true}).click();
  await canvasPick(page,'vertex','av0');await canvasPick(page,'vertex','av2');await settle(page);
  const split=await stored(page);expect(split.rooms.find((r:any)=>r.id===original).binding).toBe('detached');
  expect(split.rooms.filter((r:any)=>r.binding==='attached').every((r:any)=>r.material.tile===600)).toBe(true);
  const diagonal=split.plan.draft.segments.find((s:any)=>s.startVertexId==='av0'&&s.endVertexId==='av2');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();await canvasPick(page,'segment',diagonal.id);
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
  await page.route('**/api/optimize',async route=>{await gate;await route.continue();});
  await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();
  await page.getByLabel('Помещение',{exact:true}).selectOption({index:2});
  const response=page.waitForResponse('**/api/optimize');release();await response;
  await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Подобрать раскладку',exact:true})).toBeEnabled();
});

test('room flow physical area and request invariant under zoom resize',async({page})=>{
  const g=flowRectangle(4000,3000);g.vertices[2].x+=1500;g.vertices[3].x+=1500;g.vertices[2].y=1500*Math.sqrt(3);g.vertices[3].y=1500*Math.sqrt(3);
  await openGraph(page,g);await toRules(page);
  const run=async()=>{const response=page.waitForResponse('**/api/optimize');await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();const r=await response;return {input:r.request().postDataJSON(),output:await r.json()};};
  const first=await run();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'Увеличить',exact:true}).click();await page.setViewportSize({width:1440,height:900});
  const second=await run();expect(second.input).toEqual(first.input);expect(second.output).toEqual(first.output);
  expect(first.output.variants[0].metrics.room_area).toBeCloseTo(9.7039,4);
});
test('room flow setting same length as fixed invalidates previous result',async({page})=>{
  await flowRoom(page);await page.getByRole('button',{name:'Подобрать раскладку',exact:true}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeEnabled();
  await page.getByRole('button',{name:'1. План',exact:true}).click();await page.getByRole('button',{name:'Выбрать',exact:true}).click();await canvasPick(page,'segment','as0');
  await commit(page,'Общая длина стены','4000');await settle(page);
  await page.getByRole('button',{name:'2. Варианты',exact:true}).click();await expect(page.getByRole('button',{name:'План с размерами · SVG'})).toBeDisabled();
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
