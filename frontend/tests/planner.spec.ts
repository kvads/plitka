import { addPoint, canvasPick, goStage, setSidebarOpen } from "./fixtures/projects";
import { test, expect } from "@playwright/test";
import {
  openProject,
  toRules,
  commit,
  settle,
  stored,
} from "./fixtures/projects";
async function calculate(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Подобрать раскладку", exact: true })
    .click();
  await expect(page.locator(".variant-list button").first()).toBeVisible();
}
test("optimize inspect shift lock and export", async ({ page }) => {
  await openProject(page);
  await toRules(page);
  const optimizeResponse = page.waitForResponse('**/api/v5/optimize');
  await calculate(page);
  const optimized = await (await optimizeResponse).json();
  expect(optimized.variants[0].metrics.room_area).toBeGreaterThan(1_000_000);
  expect(optimized.variants[0].metrics.room_area * 10).toBe(Math.round(optimized.variants[0].metrics.room_area * 10));
  await expect(page.getByText(/Плиток: .*отходы: .*%/)).toBeVisible();
  await page.getByLabel("Деталь", { exact: true }).selectOption({ index: 1 });
  const layoutResponse = page.waitForResponse('**/api/v5/layout');
  await commit(page, "Сдвиг X", "125");
  const acceptedLayout = await (await layoutResponse).json();
  await expect(
    page.getByRole("button", { name: "План с размерами · SVG" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Закрепить раскладку" }).click();
  await expect(page.getByLabel("Сдвиг X", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Разблокировать" }).click();
  for (const name of [
    "План с размерами · SVG",
    "Таблица деталей · CSV",
  ]) {
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const download = await wait;
    expect(await download.failure()).toBeNull();
    if (name.endsWith('SVG')) {
      const { readFile } = await import('node:fs/promises');
      const svg = await readFile(await download.path(), 'utf8');
      expect(svg).toContain('размеры в мм');
      expect(svg).not.toContain('м²');
    } else if (name.endsWith('CSV')) {
      const { readFile } = await import('node:fs/promises');
      const csv = await readFile(await download.path(), 'utf8');
      expect(csv).toContain('Площадь мм²');
      const firstArea = Number(csv.split('\n')[1].split(';')[3].replace(/\s/g, '').replace(',', '.'));
      expect(firstArea).toBe(acceptedLayout.parts[0].area);
    }
  }
  await settle(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Раскладка", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".variant-list button")).toHaveCount(0);
});
for (const response of [
  { name: "empty proxy error", status: 500, body: "", message: /HTTP 500/ },
  {
    name: "HTML gateway",
    status: 502,
    body: "<html>bad</html>",
    message: /HTTP 502/,
  },
  { name: "empty success", status: 200, body: "", message: /пустой ответ/ },
  {
    name: "truncated JSON",
    status: 200,
    body: '{"parts":',
    message: /некорректный ответ/,
  },
])
  test("recovery " + response.name, async ({ page }) => {
    await openProject(page);
    await toRules(page);
    await page.route("**/api/v5/optimize", (r) =>
      r.fulfill({ status: response.status, body: response.body }),
    );
    await page.getByRole("button", { name: "Подобрать раскладку" }).click();
    await expect(page.getByRole("alert")).toContainText(response.message);
    await page.unroute("**/api/v5/optimize");
    await calculate(page);
  });
test("late optimize cannot reopen results after navigating back", async ({
  page,
}) => {
  await openProject(page);
  await toRules(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const hit = new Promise<void>((r) => (entered = r));
  await page.route("**/api/v5/optimize", async (route) => {
    const res = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response: res });
  });
  await page.getByRole("button", { name: "Подобрать раскладку" }).click();
  await hit;
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  release();
  await setSidebarOpen(page, true);
  await expect(page.getByRole("button", { name: "1. План", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".variant-list button")).toHaveCount(0);
});
test("failed shift blocks export until cancelled", async ({ page }) => {
  await openProject(page);
  await toRules(page);
  await calculate(page);
  await page.route("**/api/v5/layout", (r) =>
    r.fulfill({ status: 500, body: "" }),
  );
  await commit(page, "Сдвиг X", "125");
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(
    page.getByRole("button", { name: "План с размерами · SVG" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Отменить сдвиг" }).click();
  await expect(
    page.getByRole("button", { name: "План с размерами · SVG" }),
  ).toBeEnabled();
});
for (const width of [375, 1440])
  test(
    "layout coordinates unchanged with viewport " + width,
    async ({ page }) => {
      await openProject(page);
      await toRules(page);
      await calculate(page);
      const canvas = page.getByLabel("Редактор плана помещений");
      const before = await canvas.getAttribute("data-layout");
      await page.setViewportSize({ width, height: 900 });
      const box = await canvas.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 250);
      expect(await canvas.getAttribute("data-layout")).toBe(before);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -250);
      expect(await canvas.getAttribute("data-layout")).toBe(before);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    },
  );
test("editing inputs invalidates variants while navigation retains them", async ({
  page,
}) => {
  await openProject(page);
  await toRules(page);
  await calculate(page);
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await goStage(page, "variants");
  await expect(page.locator(".variant-list button").first()).toBeVisible();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await goStage(page, "variants");
  await commit(page, "Угол укладки", "45");
  await expect(page.getByRole("button", { name: "План с размерами · SVG", exact: true })).toBeDisabled();
  await settle(page);
  expect((await stored(page)).rooms[0].rules.angle).toBe(45);
});

test("late layout response cannot replace a cancelled shift", async ({
  page,
}) => {
  await openProject(page);
  await toRules(page);
  await calculate(page);
  const canvas = page.getByLabel("Редактор плана помещений"),
    before = await canvas.getAttribute("data-layout");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    hit = new Promise<void>((r) => (entered = r));
  await page.route("**/api/v5/layout", async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await commit(page, "Сдвиг X", "125");
  await hit;
  await page.getByRole("button", { name: "Отменить сдвиг" }).click();
  release();
  await expect(
    page.getByRole("button", { name: "План с размерами · SVG" }),
  ).toBeEnabled();
  expect(await canvas.getAttribute("data-layout")).toBe(before);
});
import { openGraph, graphMeasured, confirmRoom } from "./fixtures/projects";
test("release fixed and undo cannot revive old results", async ({ page }) => {
  await openGraph(page, graphMeasured());
  await toRules(page);
  await calculate(page);
  await goStage(page, "object");
  await canvasPick(page, "constraint", "length4000");
  await page
    .getByRole("button", { name: "Снять фиксацию", exact: true })
    .click();
  await settle(page);
  await confirmRoom(page);
  await setSidebarOpen(page, true);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await toRules(page);
  await expect(page.getByRole("button", { name: "Таблица деталей · CSV", exact: true })).toBeDisabled();
  await calculate(page);
  await expect(
    page.getByRole("button", { name: "Таблица деталей · CSV", exact: true }),
  ).toBeEnabled();
});


test("deletion condition without coordinate change invalidates results through Undo and new confirmation", async ({
  page,
}) => {
  const g = graphMeasured();
  await openGraph(page, g);
  await toRules(page);
  await calculate(page);
  const before = (await stored(page)).plan.draft.vertices;
  await goStage(page, "object");
  await canvasPick(page, "constraint", "length4000");
  await page
    .getByRole("button", { name: "Удалить условие", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toEqual(before);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await confirmRoom(page);
  await toRules(page);
  await expect(page.getByRole("button", { name: "Таблица деталей · CSV", exact: true })).toBeDisabled();
  await calculate(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Таблица деталей · CSV", exact: true })
    .click();
  expect(await (await download).failure()).toBeNull();
});

test("context alternative clears failed manual shift and exports accepted variant", async ({
  page,
}) => {
  await openGraph(page, graphMeasured());
  await toRules(page);
  await calculate(page);
  await page.route("**/api/v5/layout", (r) =>
    r.fulfill({ status: 500, body: "" }),
  );
  await commit(page, "Сдвиг X", "25");
  await expect(page.getByRole("alert")).toBeVisible();
  const alternatives = page.locator(".variant-list button");
  await expect(alternatives.nth(1)).toBeVisible();
  await alternatives.nth(1).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "План с размерами · SVG", exact: true })
    .click();
  expect(await (await download).failure()).toBeNull();
});

test("deletion shared room makes neighbour unready and Undo requires a new calculation", async ({
  page,
}) => {
  const { graphNeighbours } = await import("./fixtures/projects");
  await openGraph(page, graphNeighbours());
  await canvasPick(page, "room", 1);
  await toRules(page);
  await calculate(page);
  await goStage(page, "object");
  await setSidebarOpen(page, true);
  await page
    .getByRole("button", { name: "Выбрать помещение", exact: true })
    .click();
  await canvasPick(page, "room", 1);
  await page
    .getByRole("button", { name: "Удалить помещение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить со стенами", exact: true })
    .click();
  await settle(page);
  const after = await stored(page);
  expect(after.rooms).toHaveLength(1);
  expect(after.rooms[0].binding).toBe("detached");
  await goStage(page, "variants");
  await expect(page.getByText("Выберите замкнутое помещение для подбора.", { exact: false })).toBeVisible();
  await goStage(page, "object");
  await setSidebarOpen(page, true);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await confirmRoom(page);
  await toRules(page);
  await expect(page.getByRole("button", { name: "План с размерами · SVG", exact: true })).toBeDisabled();
  await calculate(page);
  await expect(
    page.getByRole("button", { name: "План с размерами · SVG", exact: true }),
  ).toBeEnabled();
});

test("context metadata edits retain accepted result and export", async ({
  page,
}) => {
  await openProject(page);
  await toRules(page);
  await calculate(page);
  await setSidebarOpen(page, true);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByLabel("Название проекта", { exact: true })
    .fill("Обновлённый проект");
  await page.getByLabel("Адрес объекта", { exact: true }).fill("Новый адрес");
  await page
    .getByRole("button", { name: "Закрыть меню проекта", exact: true })
    .click();
  await page.getByRole("button", { name: "Параметры", exact: true }).click();
  await settle(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Таблица деталей · CSV", exact: true })
    .click();
  expect(await (await download).failure()).toBeNull();
});
