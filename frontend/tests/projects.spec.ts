import { canvasPick, graphRectangle, openGraph, screenPoint, setSidebarOpen, stored } from "./fixtures/projects";
import { test, expect } from "@playwright/test";
import { initial } from "../src/types";
import { commit, settle } from "./fixtures/projects";

test("editor has no file or grid controls and a collapsed save error opens the sidebar", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:5173", viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openGraph(page, graphRectangle(), {}, false);
  await expect(page.locator(".canvas-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Скачать проект", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Открыть файл", exact: true })).toHaveCount(0);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await setSidebarOpen(page, true);
  await expect(page.getByText("Шаг сетки", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === "plitka-projects-v5") throw new Error("Нет места для сохранения");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Название проекта").fill("Изменённый проект");
  await expect(page.getByText("Не сохранено", { exact: true })).toBeVisible();
  await setSidebarOpen(page, false);
  await expect(page.getByRole("button", { name: /Не сохранено.*открыть меню/ })).toBeVisible();
  await page.getByRole("button", { name: /Не сохранено.*открыть меню/ }).click();
  await expect(page.getByRole("button", { name: "Повторить сохранение", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).restoreStorage());
  await page.getByRole("button", { name: "Повторить сохранение", exact: true }).click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await context.close();
});
test("create projects, edit address and retain independent rooms", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["Квартира", "Дом"]) {
    await page
      .getByRole("button", { name: "Новый проект", exact: true })
      .click();
    await page.getByLabel("Название проекта").fill(name);
    await page.getByLabel("Адрес объекта").fill(name + " адрес");
    await page.getByRole("button", { name: "Создать проект" }).click();
    await settle(page);
    if (name === "Квартира") {
      await page.getByRole("button", { name: "Стена", exact: true }).click();
      const start = await screenPoint(page, 0, 0);
      const end = await screenPoint(page, 3200, 0);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y);
      await page.mouse.up();
      await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(1);
      await page.getByRole("button", { name: "Выбрать", exact: true }).click();
      await canvasPick(page, "segment", 1);
      await commit(page, "Общая длина стены", "3175");
      await settle(page);
    }
    await page.getByRole("button", { name: "← Проекты" }).click();
  }
  await expect(page.locator(".project-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Изменить проект Квартира" }).click();
  await page.getByLabel("Адрес объекта").fill("Ленина 10");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByText("Ленина 10", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ленина 10")).toBeVisible();
  await page.getByRole("link", { name: "Открыть проект Квартира" }).click();
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", 1);
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("3175");
});
test("single legacy key is removed when v4 opens", async ({ page }) => {
  await page.addInitScript(
    (p) => localStorage.setItem("plitka-project-v1", JSON.stringify(p)),
    initial,
  );
  await page.goto("/");
  await expect(page.locator(".project-row")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".project-row")).toHaveCount(0);
  expect(
    await page.evaluate(() => !!localStorage.getItem("plitka-project-v1")),
  ).toBeFalsy();
});

import { deletionProjects, projectCatalog, openDelete } from './fixtures/projects';
for (const width of [375, 1440]) test(`delete project list confirmation and focus ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await deletionProjects(page);
  const before = await projectCatalog(page);
  let dialog = await openDelete(page);
  await expect(dialog.getByText('Адрес 0', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Удалить проект', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await projectCatalog(page)).toEqual(before);
  dialog = await openDelete(page);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(1);
  expect((await projectCatalog(page)).projects).toEqual([before.projects[1]]);
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.project-row')).toHaveCount(1);
});
test('delete project last retains backups and old URL stays missing', async ({ page }) => {
  await deletionProjects(page, 1);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(0);
  expect((await projectCatalog(page)).projects).toEqual([]);
  await page.reload();
  await expect(page.getByText('Здесь будут ваши проекты')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('plitka-projects-v1'))).toBeNull();
  await page.goto('/#project/delete-0');
  await expect(page.getByText('Проект не найден.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'К списку проектов' })).toBeVisible();
});

test('delete project serialized copy imports with a new ID', async ({ page }) => {
  await deletionProjects(page, 1);
  await page.getByRole('link', { name: 'Открыть проект Одинаковое имя' }).click();
  await settle(page);
  const original = (await projectCatalog(page)).projects[0];
  await page.getByRole('button', { name: '← Проекты', exact: true }).click();
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({
    name: 'project.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'plitka-project', version: 5, project: original })),
  });
  await page.getByRole('button', { name: 'Создать из файла', exact: true }).click();
  await settle(page);
  const imported = (await projectCatalog(page)).projects[0];
  expect(imported.id).not.toBe(original.id);
  expect(imported.plan.draft).toEqual(original.plan.draft);
  expect(imported.name).toBe(original.name);
});

test('delete project preserves an independent concurrent edit', async ({ page, context }) => {
  await deletionProjects(page); const dialog = await openDelete(page);
  const other = await context.newPage(); await other.goto('/');
  await other.getByRole('button', { name: 'Изменить проект Одинаковое имя' }).nth(1).click();
  await other.getByLabel('Адрес объекта').fill('Независимое изменение');
  await other.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(other.getByText('Независимое изменение', { exact: true })).toBeVisible();
  const control = (await projectCatalog(page)).projects[1];
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(1);
  expect((await projectCatalog(page)).projects).toEqual([control]);
});

for (const width of [375, 1440])
test(`delete project long metadata stays inside viewport ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await deletionProjects(page);
  await page.getByRole('button', { name: 'Изменить проект Одинаковое имя' }).first().click();
  await page.getByLabel('Название проекта').fill('Н'.repeat(120));
  await page.getByLabel('Адрес объекта').fill('А'.repeat(300));
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('.project-row').first().getByRole('heading')).toHaveText('Н'.repeat(120));
  const before = await projectCatalog(page);
  const dialog = await openDelete(page);
  expect(await dialog.evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await projectCatalog(page)).toEqual(before);
});

import { openGraph as flowOpen, graphTwoRooms as flowGraph, deleteFromEditor as flowDelete, projectCatalog as flowCatalog } from './fixtures/projects';
test('room flow deletion from variants keeps destructive confirmation',async({page})=>{
  await flowOpen(page,flowGraph());await page.getByRole('button',{name:'2. Варианты',exact:true}).click();
  await page.getByRole('button',{name:'Проект',exact:true}).click();await page.getByRole('button',{name:'Удалить проект',exact:true}).click();
  await page.getByRole('dialog',{name:'Удалить проект',exact:true}).getByRole('button',{name:'Отмена',exact:true}).click();
  expect((await flowCatalog(page)).projects).toHaveLength(1);
  await flowDelete(page);expect((await flowCatalog(page)).projects).toHaveLength(0);
  await page.reload();expect((await flowCatalog(page)).projects).toHaveLength(0);
});
