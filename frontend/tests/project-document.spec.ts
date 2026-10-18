import { canvasPick, graphConflict, graphRectangle, openGraph, touchSession, v4FilledCatalog, v4WallGraph, preV5CatalogKeys, oldCatalogsWithLayouts, v5EmptyCatalog, v5FilledCatalog } from "./fixtures/projects";
import { cleanV4Graph } from "../src/domain/plan/schema";
import { test, expect } from "@playwright/test";
import {
  openProject,
  commit,
  stored,
  settle,
  importFile,
  parseImportFixture,
  confirmRoom,
} from "./fixtures/projects";
const envelope = async (page: any) => ({
  format: "plitka-project",
  version: 5,
  project: await stored(page),
});

test("old project catalog is removed when the v5 editor opens", async ({ page }) => {
  await page.addInitScript(catalog => {
    if (sessionStorage.getItem("seed-old-project")) return;
    sessionStorage.setItem("seed-old-project", "yes");
    localStorage.setItem("plitka-projects-v4", JSON.stringify(catalog));
  }, v4FilledCatalog());
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("plitka-projects-v4"))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v5")!))).toEqual(v5EmptyCatalog);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v5")!))).toEqual(v5EmptyCatalog);
});

test("two windows initialize the same v5 catalog under the write lock", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:5173" });
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/");
  await first.evaluate(() => {
    localStorage.removeItem("plitka-projects-v5");
    localStorage.setItem("plitka-projects-v4", "old");
  });
  await Promise.all([first.reload(), second.goto("/")]);
  await expect.poll(() => first.evaluate(() => localStorage.getItem("plitka-projects-v5"))).not.toBeNull();
  await expect.poll(() => second.evaluate(() => localStorage.getItem("plitka-projects-v4"))).toBeNull();
  expect(await first.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v5")!))).toEqual(v5EmptyCatalog);
  await context.close();
});

test("touch viewport persists without changing the graph or grid", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:5173", viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openGraph(page, graphRectangle());
  const before = await stored(page);
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 31, x: 160, y: 420 }, { id: 32, x: 220, y: 420 }]);
  await touch.dispatch("touchMove", [{ id: 31, x: 135, y: 445 }, { id: 32, x: 250, y: 445 }]);
  await touch.dispatch("touchEnd", []);
  await expect.poll(async () => (await stored(page)).viewport.zoom).not.toBe(before.viewport.zoom);
  const after = await stored(page);
  expect(after.plan.draft).toEqual(before.plan.draft);
  expect(after.viewport.gridStepMm).toBe(before.viewport.gridStepMm);
  await page.reload();
  await settle(page);
  expect((await stored(page)).viewport).toEqual(after.viewport);
  await touch.close();
  await context.close();
});

test("single pan commits its viewport only on release", async ({ page }) => {
  await openGraph(page, graphRectangle());
  await page.getByRole("button", { name: "Переместить полотно", exact: true }).click();
  const before = await stored(page);
  const canvas = page.locator("svg[data-geometry]");
  const initial = await canvas.getAttribute("viewBox");
  await page.mouse.move(210, 420);
  await page.mouse.down();
  await page.mouse.move(265, 450);
  await expect.poll(() => canvas.getAttribute("viewBox")).not.toBe(initial);
  expect((await stored(page)).viewport).toEqual(before.viewport);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).viewport.centerX).not.toBe(before.viewport.centerX);
  const after = await stored(page);
  expect(after.viewport.gridStepMm).toBe(before.viewport.gridStepMm);
  expect(after.plan.draft).toEqual(before.plan.draft);
  await page.reload();
  await settle(page);
  expect((await stored(page)).viewport).toEqual(after.viewport);
});


async function wall(page: any) {
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", 1);
}
test("new v5 project keeps its graph and has no legacy catalog", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  const before = await stored(page);
  expect(before.schemaVersion).toBe(5);
  expect(before.plan.draft.vertices.map((v: any) => [v.x, v.y])).toEqual([
    [0, 0],
    [4200, 0],
    [4200, 3600],
    [0, 3600],
  ]);
  await page.reload();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  expect(
    await page.evaluate(() => !!localStorage.getItem("plitka-projects-v1")),
  ).toBeFalsy();
});
test("v5 snapshots share IDs and import uses local revision", async ({
  page,
}) => {
  await openProject(page);
  await confirmRoom(page);
  await settle(page);
  const value = await envelope(page),
    rev = value.project.documentRevision;
  value.project.documentRevision = 999;
  await importFile(page, value);
  expect((await stored(page)).documentRevision).toBe(rev + 1);
  await expect(
    page.getByRole("button", { name: "2. Варианты", exact: true }),
  ).toBeEnabled();
});
test("damaged and future files never mutate current project", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  const before = await stored(page);
  for (const version of [6, 3]) {
    const value = await envelope(page);
    value.version = version;
    if (version === 3)
      value.project.plan.draft.vertices[1].id =
        value.project.plan.draft.vertices[0].id;
    await expect(parseImportFixture(page, value)).rejects.toThrow();
    expect(await stored(page)).toEqual(before);
  }
});
test("invalid dimension text survives reload and blocks selected room", async ({
  page,
}) => {
  await openProject(page);
  await confirmRoom(page);
  await wall(page);
  await commit(page, "Общая длина стены", "нет");
  await settle(page);
  const before = (await stored(page)).plan.draft;
  await page.reload();
  await settle(page);
  await wall(page);
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("нет");
  expect((await stored(page)).plan.draft).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled();
});
test("storage failure retains draft and explicit retry saves it", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  await wall(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreStorage = () =>
      (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (k, v) {
      if (k === "plitka-projects-v5")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await commit(page, "Общая длина стены", "3175");
  await expect(page.getByText("Не сохранено", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("3175");
  await page.evaluate(() => (window as any).restoreStorage());
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await settle(page);
  await page.reload();
  await settle(page);
  await wall(page);
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("3175");
});
test("concurrent editor cannot overwrite newer revision", async ({
  page,
  context,
}) => {
  await openProject(page);
  await settle(page);
  const other = await context.newPage();
  await other.goto("/#project/test");
  await settle(other);
  await wall(page);
  await wall(other);
  await commit(page, "Общая длина стены", "3175");
  await settle(page);
  await expect(other.getByRole("alert")).toContainText("Конфликт");
  await commit(other, "Общая длина стены", "3000");
  expect((await stored(page)).plan.draft.constraints[0].value).toBe(3175);
});
test("offline pending exports and resumes after import", async ({ page }) => {
  await openProject(page);
  await confirmRoom(page);
  await settle(page);
  await wall(page);
  const confirmed = (await stored(page)).rooms[0].confirmed;
  await page.route("**/api/plan/command", (r) => r.abort());
  await commit(page, "Общая длина стены", "3175,5");
  await expect(page.getByRole("alert")).toContainText("Нет связи");
  await settle(page);
  const before = await stored(page);
  expect(before.plan.pendingEdit.command.value).toBe(3175.5);
  expect(before.rooms[0].confirmed).toEqual(confirmed);
  const file = await envelope(page);
  expect(file.project.plan).toEqual(before.plan);
  expect(file.project.results).toBeUndefined();
  await page.unroute("**/api/plan/command");
  await importFile(page, file);
  await page.reload();
  await settle(page);
  await page
    .getByRole("button", { name: "Повторить действие", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page)).plan.pendingEdit)
    .toBeNull();
  await wall(page);
  await expect(
    page.getByLabel("Общая длина стены", { exact: true }),
  ).toHaveValue("3175,5");
});
test("saved pending can be cancelled after reload retaining confirmed", async ({
  page,
}) => {
  await openProject(page);
  await confirmRoom(page);
  await settle(page);
  const before = await stored(page);
  await wall(page);
  await page.route("**/api/plan/command", (r) => r.abort());
  await commit(page, "Общая длина стены", "3175");
  await expect(page.getByRole("alert")).toBeVisible();
  await settle(page);
  await page.reload();
  await settle(page);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  const after = await stored(page);
  expect(after.plan.pendingEdit).toBeNull();
  expect(after.plan.draft).toEqual(before.plan.draft);
  expect(after.rooms[0].confirmed).toEqual(before.rooms[0].confirmed);
});
test("corrupt old catalog is discarded when v5 initializes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("plitka-projects-v4", "broken"));
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("plitka-projects-v4"))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v5")!))).toEqual(v5EmptyCatalog);
});
test("old v2 tab change leaves the v5 editor untouched", async ({ page }) => {
  await openProject(page);
  await settle(page);
  const before = await stored(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "plitka-projects-v2",
        newValue: "{}",
      }),
    ),
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
});
test("conflicting values repair jointly and survive reload", async ({
  page,
}) => {
  await openGraph(page, graphConflict());
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as0");
  await commit(page, "Общая длина стены", "4300");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as2");
  await commit(page, "Общая длина стены", "4300");
  await expect
    .poll(async () => (await stored(page)).plan.pendingEdit)
    .toBeNull();
  await settle(page);
  await page.reload();
  await settle(page);
  const g = (await stored(page)).plan.draft;
  expect(
    g.constraints
      .filter((c: any) => ["bottom", "top"].includes(c.id))
      .every((c: any) => c.value === 4300),
  ).toBeTruthy();
});
test("cancel second pending after reload restores first conflict", async ({
  page,
}) => {
  await openGraph(page, graphConflict());
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as0");
  await commit(page, "Общая длина стены", "4300");
  await expect(page.getByRole("alert")).toBeVisible();
  await settle(page);
  const basis = (await stored(page)).plan.draft;
  await page.route("**/api/plan/command", (r) => r.abort());
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as2");
  await commit(page, "Общая длина стены", "4300");
  await expect(page.getByRole("alert")).toContainText("Нет связи");
  await settle(page);
  await page.reload();
  await settle(page);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(basis);
});
import { legacyV2Fixture, openV2 } from "./fixtures/projects";
test.skip("v2 valid acknowledgment preserves available tile stage", async ({
  page,
}) => {
  const old = legacyV2Fixture();
  await openV2(page, old);
  await expect(
    page.getByRole("heading", { name: "Плитка", exact: true }),
  ).toBeVisible();
  const d = await stored(page);
  expect(d.rooms[0].confirmed.acknowledgment).toBeTruthy();
  expect(d.plan.draft.vertices).toEqual(old.room.draft.outer.vertices);
  expect(d.plan.draft.constraints[0].fixed).toBe(true);
  expect(
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("plitka-projects-v2")))!,
    ).projects[0],
  ).toEqual(old);
});
test.skip("v2 pending retains all snapshots and explicit retry works", async ({
  page,
}) => {
  const old = legacyV2Fixture(true);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/geometry/solve")) calls++;
  });
  await openV2(page, old);
  expect(calls).toBe(0);
  const d = await stored(page);
  expect(d.plan.pendingEdit.legacyBasisGeometry).toEqual(
    old.room.pendingEdit!.basisGeometry,
  );
  expect(d.plan.pendingEdit.legacyDraftGeometry).toEqual(old.room.draft);
  await page
    .getByRole("button", { name: "Повторить действие", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page)).plan.pendingEdit)
    .toBeNull();
  expect(calls).toBe(1);
});
test.skip("v2 pending cancel restores basis without changing confirmed snapshot", async ({
  page,
}) => {
  const old = legacyV2Fixture(true);
  await openV2(page, old);
  const confirmed = (await stored(page)).rooms[0].confirmed;
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  const d = await stored(page);
  expect(d.plan.pendingEdit).toBeNull();
  expect(d.plan.draft.constraints[0].value).toBe(
    old.room.pendingEdit!.basisGeometry.constraints[0].value,
  );
  expect(d.rooms[0].confirmed.graph).toEqual(confirmed.graph);
});
test("late graph command cannot replace cancelled basis", async ({ page }) => {
  await openProject(page);
  await settle(page);
  const before = (await stored(page)).plan.draft;
  let release!: () => void, hit!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (hit = r));
  await page.route("**/api/plan/command", async (route) => {
    const response = await route.fetch();
    hit();
    await gate;
    await route.fulfill({ response });
  });
  await wall(page);
  await commit(page, "Общая длина стены", "3175");
  await entered;
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  release();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before);
});
test.skip("open v2 draft stays open and keeps separate confirmed snapshot", async ({
  page,
}) => {
  const old = legacyV2Fixture();
  old.room.draft = structuredClone(old.room.draft);
  old.room.draft.outer.closed = false;
  old.room.draft.outer.walls.pop();
  old.workflow.requestedStage = "object";
  await openV2(page, old);
  const d = await stored(page);
  expect(d.plan.draft.segments).toHaveLength(3);
  expect(d.rooms[0].confirmed.graph.segments).toHaveLength(4);
  expect(d.selectedRoomId).toBeNull();
  await expect(
    page.getByRole("button", { name: "2. Варианты", exact: true }),
  ).toBeEnabled();
});



import {
  graphCoincident,
  graphSafetySolve,
  graphValidate,
  screenPoint,
} from "./fixtures/projects";
test.skip("safety old coincident snapshots survive reload and file import", async ({
  page,
}) => {
  const graph = graphCoincident();
  await openGraph(page, graph);
  const doc = await stored(page);
  doc.plan.restorePoint = {
    graph: structuredClone(graph),
    bindings: [],
    selectedRoomId: null,
  };
  await importFile(page, {
    format: "plitka-project",
    version: 4,
    project: doc,
  });
  await page.reload();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(graph);
  expect((await stored(page)).plan.restorePoint.graph).toEqual(graph);
  const file = await envelope(page);
  expect(file.project.plan.draft).toEqual(graph);
  expect(file.project.plan.restorePoint.graph).toEqual(graph);
  const result = await graphValidate(page, graph);
  expect(
    result.issues.some((i: any) => i.code === "coincident_vertices"),
  ).toBeTruthy();
});


import {
  legacySafetyPending,
  legacySafetyCoincident,
} from "./fixtures/projects";
test.skip("safety v2 migration preserves distinct invalid draft basis and confirmed snapshots", async ({
  page,
}) => {
  const old = legacySafetyCoincident();
  await openV2(page, old);
  const d = await stored(page);
  expect(d.plan.draft.vertices).toEqual(old.room.draft.outer.vertices);
  expect(d.plan.pendingEdit.legacyBasisGeometry).toEqual(
    old.room.pendingEdit.basisGeometry,
  );
  expect(d.plan.pendingEdit.legacyDraftGeometry).toEqual(old.room.draft);
  expect(d.rooms[0].confirmed.graph.vertices).toEqual(
    old.room.confirmed.geometry.outer.vertices,
  );
  expect(d.rooms[0].confirmed.graph.fieldInputs).toEqual(
    old.room.confirmed.geometry.fieldInputs,
  );
  const snapshots = {
    basis: d.plan.pendingEdit,
    confirmed: d.rooms[0].confirmed,
    restore: d.plan.restorePoint,
  };
  await page.reload();
  await settle(page);
  await importFile(page, {
    format: "plitka-project",
    version: 4,
    project: await stored(page),
  });
  const loaded = await stored(page);
  expect(loaded.plan.draft).toEqual(d.plan.draft);
  expect({
    basis: loaded.plan.pendingEdit,
    confirmed: loaded.rooms[0].confirmed,
    restore: loaded.plan.restorePoint,
  }).toEqual(snapshots);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toEqual(
    old.room.pendingEdit.basisGeometry.outer.vertices,
  );
  await expect(page.locator(".geometry-issues")).toContainText(
    "Координаты концов стены совпадают",
  );
});

test.skip("safety legacy retry refuses a newly coincident real solver result and keeps intent", async ({
  page,
}) => {
  const old = legacySafetyPending();
  await openV2(page, old);
  const before = await stored(page);
  const response = page.waitForResponse("**/api/geometry/solve");
  await page
    .getByRole("button", { name: "Повторить действие", exact: true })
    .click();
  const result = await (await response).json();
  expect(result.geometry.outer.vertices[1]).toMatchObject({ x: 2000, y: 0 });
  await expect(page.getByRole("alert")).toContainText("совпадение вершин");
  await settle(page);
  expect((await stored(page)).plan).toEqual(before.plan);
  await page.reload();
  await settle(page);
  expect((await stored(page)).plan.pendingEdit).toEqual(
    before.plan.pendingEdit,
  );
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toEqual([
    ...old.room.pendingEdit.basisGeometry.outer.vertices,
    ...old.room.pendingEdit.basisGeometry.holes[0].vertices,
  ]);
});



test("clear project keeps metadata, persists empty graph and Undo restores the document", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  const before = await stored(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Очистить проект", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Очистить проект" })
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  await page
    .getByRole("button", { name: "Очистить проект", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Очистить", exact: true })
    .click();
  await settle(page);
  const cleared = await stored(page);
  expect(cleared.name).toBe(before.name);
  expect(cleared.address).toBe(before.address);
  expect(cleared.plan.draft.vertices).toEqual([]);
  expect(cleared.rooms).toEqual([]);
  expect(cleared.plan.restorePoint).toBeNull();
  expect(cleared.plan.pendingEdit).toBeNull();
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Очистить проект", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Очистить", exact: true })
    .click();
  await settle(page);
  await page.reload();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toEqual([]);
});

import {
  fullGraphDocument,
  openDocument,
  clearProject,
} from "./fixtures/projects";
for (const pending of ["graphV4"] as const)
  test(`clear project Undo preserves ${pending} intent without replay`, async ({
    page,
  }) => {
    await openDocument(page, await fullGraphDocument(pending));
    const before = await stored(page);
    let commands = 0;
    page.on("request", (r) => {
      if (/\/api\/(plan\/command|geometry\/solve)$/.test(r.url())) commands++;
    });
    await clearProject(page);
    await settle(page);
    await page
      .getByRole("button", { name: "Отменить правку", exact: true })
      .click();
    await settle(page);
    const after = await stored(page);
    expect(after.plan.draft).toEqual(before.plan.draft);
    expect(after.rooms).toEqual(before.rooms);
    expect(after.plan.restorePoint).toEqual(before.plan.restorePoint);
    expect(after.plan.pendingEdit).toMatchObject({
      kind: before.plan.pendingEdit.kind,
      command: before.plan.pendingEdit.command,
      basisGraph: before.plan.pendingEdit.basisGraph,
    });
    expect(after.plan.pendingEdit.targetDraftRevision).toBe(after.plan.draftRevision);
    expect(commands).toBe(0);
  });
test("clear project skips old snapshots waiting inside Web Lock", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  await page.evaluate(() => {
    (window as any).lockReady = false;
    void navigator.locks.request("plitka-projects-write", async () => {
      (window as any).lockReady = true;
      await new Promise<void>(
        (resolve) => ((window as any).releaseLock = resolve),
      );
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).lockReady))
    .toBe(true);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Название проекта").fill("Изменённый проект");
  await page.getByRole("button", { name: "Закрыть меню проекта" }).click();
  await clearProject(page);
  await page.evaluate(() => (window as any).releaseLock());
  await settle(page);
  const after = await stored(page);
  expect(after.plan.draft.vertices).toEqual([]);
  expect(after.viewport.zoom).toBe(1);
  await page.reload();
  await settle(page);
  expect((await stored(page)).rooms).toEqual([]);
});
test("clear project remains exportable and undoable after quota failure", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreStorage = () =>
      (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (k, v) {
      if (k === "plitka-projects-v5")
        throw new DOMException("Нет места", "QuotaExceededError");
      original.call(this, k, v);
    };
  });
  await clearProject(page);
  await expect(page.getByText("Не сохранено", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Скачать проект", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).restoreStorage());
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).not.toEqual([]);
});

import {
  graphNeighbours,
  graphWithVoid,
  graphDamagedVoid,
  graphCommand,
} from "./fixtures/projects";
async function deletionPreview(page: any, graph: any, target: any) {
  return page.evaluate(
    async ({ graph, target }: any) => {
      const r = await fetch("/api/plan/deletion-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 4,
          requestId: "preview",
          draftRevision: 0,
          basisKey: "basis",
          graph,
          target,
        }),
      });
      return { http: r.status, ...(await r.json()) };
    },
    { graph, target },
  );
}
test("deletion preview removes entire shared boundary and preserves external walls", async ({
  page,
}) => {
  const g = graphNeighbours();
  await openGraph(page, g);
  const validation = await graphValidate(page, g);
  expect(validation.faces).toHaveLength(2);
  const target = {
    kind: "room",
    topologyKey: validation.faces.find((f: any) =>
      f.outer.some((r: any) => r.segmentId === "as3"),
    ).topologyKey,
  };
  const preview = await deletionPreview(page, g, target);
  expect(preview.http).toBe(200);
  expect(preview.status).toBe("ready");
  expect(preview.impact.segmentIds).toEqual(["as0", "as1", "as2", "as3"]);
  expect(preview.impact.disappearedRoomKeys).toHaveLength(2);
  const result = await graphCommand(page, g, {
    type: "deleteRoom",
    topologyKey: target.topologyKey,
    impactKey: preview.impact.impactKey,
  });
  expect(result.status).toBe("applied");
  expect(result.graph.segments.map((s: any) => s.id)).toContain("external");
  expect(result.graph.vertices.map((v: any) => v.id)).toContain("av2");
  expect(result.graph.vertices.map((v: any) => v.id)).not.toContain("av0");
  const changed = structuredClone(g);
  changed.fieldInputs = { unrelated: "1,0" };
  const stale = await graphCommand(page, changed, {
    type: "deleteRoom",
    topologyKey: target.topologyKey,
    impactKey: preview.impact.impactKey,
  });
  expect(stale.status).toBe("invalid");
  expect(
    stale.issues.some((i: any) => i.code === "deletion_preview_stale"),
  ).toBe(true);
  expect(stale.graph).toEqual(changed);
});
test("deletion void removes walls whereas unmark preserves them; damaged void cannot guess boundary", async ({
  page,
}) => {
  const g = graphWithVoid();
  await openGraph(page, g);
  const preview = await deletionPreview(page, g, {
    kind: "void",
    voidId: "void",
  });
  expect(preview.status).toBe("ready");
  const deleted = await graphCommand(page, g, {
    type: "deleteVoid",
    voidId: "void",
    impactKey: preview.impact.impactKey,
  });
  expect(deleted.status).toBe("applied");
  expect(deleted.graph.segments).toHaveLength(4);
  expect(deleted.graph.voids).toEqual([]);
  const unmarked = await graphCommand(page, g, {
    type: "unmarkVoid",
    voidId: "void",
  });
  expect(unmarked.graph.segments).toHaveLength(8);
  const damaged = await deletionPreview(page, graphDamagedVoid(), {
    kind: "void",
    voidId: "void",
  });
  expect(damaged.status).toBe("invalid");
  const wall = await graphCommand(page, g, {
    type: "deleteElements",
    vertexIds: [],
    segmentIds: ["holes0"],
    acknowledgedConstraintIds: [],
  });
  expect(wall.status).toBe("applied");
  expect(wall.graph.voids).toEqual([]);
});

test("deletion room confirmation, neighbouring settings, Undo and reload", async ({
  page,
}) => {
  await openGraph(page, graphNeighbours());
  const before = await stored(page);
  await page
    .getByRole("button", { name: "Выбрать помещение", exact: true })
    .click();
  const point = await screenPoint(page, 1000, 1000);
  await page.mouse.click(point.x, point.y);
  const selected = (await stored(page)).selectedRoomId;
  await page
    .getByRole("button", { name: "Удалить помещение", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Удалить помещение" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  await page
    .getByRole("button", { name: "Удалить помещение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить со стенами", exact: true })
    .click();
  await settle(page);
  const deleted = await stored(page);
  expect(deleted.rooms.some((r: any) => r.id === selected)).toBe(false);
  expect(deleted.rooms).toHaveLength(1);
  expect(deleted.rooms[0].binding).toBe("detached");
  await expect(
    page.getByRole("button", { name: "Удалить помещение", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
  expect((await stored(page)).rooms).toHaveLength(2);
  await page.reload();
  await settle(page);
  expect((await stored(page)).rooms).toHaveLength(2);
});
for (const undo of [false, true])
  for (const failure of [false, true])
    test(`deletion late preview ${failure ? "error" : "success"} ignored after clear${undo ? " and Undo" : ""}`, async ({
      page,
    }) => {
      await openGraph(page, graphNeighbours());
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        begin = new Promise<void>((r) => (started = r));
      await page.route("**/api/plan/deletion-preview", async (route) => {
        const response = await route.fetch();
        started();
        await gate;
        if (failure)
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "Старый preview" } }),
          });
        else await route.fulfill({ response });
      });
      await page
        .getByRole("button", { name: "Выбрать помещение", exact: true })
        .click();
      const point = await screenPoint(page, 1000, 1000);
      await page.mouse.click(point.x, point.y);
      await page
        .getByRole("button", { name: "Удалить помещение", exact: true })
        .click();
      await begin;
      await clearProject(page);
      if (undo)
        await page
          .getByRole("button", { name: "Отменить правку", exact: true })
          .click();
      await settle(page);
      release();
      await expect(
        page.getByRole("dialog", { name: "Удалить помещение" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Старый preview", { exact: true }),
      ).toHaveCount(0);
    });
test("deletion range preserves error categories and removes retired chain conditions", async ({
  page,
}) => {
  const { graphRange } = await import("./fixtures/projects");
  const g = graphRange(true);
  await openGraph(page, g);
  const invalid = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "bad",
    target: {
      kind: "chain",
      id: "chain",
      range: { startVertexId: "v2", endVertexId: "v0" },
    },
    value: 50,
  });
  expect(invalid.http).toBe(200);
  expect(invalid.status).toBe("invalid");
  expect(invalid.graph).toEqual(g);
  const malformed = structuredClone(g);
  malformed.constraints[0].target.range = {
    startVertexId: "v2",
    endVertexId: "v0",
  };
  const bad = await graphValidate(page, malformed);
  expect(bad.http).toBe(422);
  const conflict = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "full",
    target: { kind: "chain", id: "chain" },
    value: -10,
  });
  expect(conflict.http).toBe(200);
  expect(conflict.status).toBe("unresolved");
  const deleted = await graphCommand(page, g, {
    type: "deleteElements",
    vertexIds: [],
    segmentIds: ["s1"],
    acknowledgedConstraintIds: ["range", "full"],
  });
  expect(deleted.status).toBe("applied");
  expect(deleted.graph.chains).toHaveLength(2);
  expect(deleted.graph.constraints).toEqual([]);
  expect(deleted.graph.vertices).toHaveLength(4);
});


test("clear project keeps previous history and two Undo actions restore clear then edit", async ({
  page,
}) => {
  await openGraph(page, graphNeighbours());
  const before = await stored(page);
  await clearProject(page);
  await settle(page);
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const start = await screenPoint(page, 2500, 1800);
  const end = await screenPoint(page, 3000, 1800);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).plan.draft.chains.length).toBe(1);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.chains).toEqual([]);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft).toEqual(before.plan.draft);
});
test("clear project never overwrites a conflicting external revision", async ({
  page,
}) => {
  await openGraph(page, graphNeighbours());
  await page.evaluate(() => {
    const key = "plitka-projects-v5",
      rows = JSON.parse(localStorage.getItem(key)!);
    rows.projects[0].documentRevision += 10;
    rows.projects[0].address = "Другая вкладка";
    localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: JSON.stringify(rows) }),
    );
  });
  await clearProject(page);
  await expect(page.getByText("Сохранено", { exact: true })).toHaveCount(0);
  expect((await stored(page)).address).toBe("Другая вкладка");
  expect((await stored(page)).plan.draft.vertices.length).toBeGreaterThan(0);
});
test("clear project new import works and exported document excludes runtime state", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  const before = await envelope(page);
  await clearProject(page);
  await settle(page);
  await importFile(page, before);
  expect((await stored(page)).plan.draft).toEqual(before.project.plan.draft);
  const exported = await envelope(page);
  expect(exported.version).toBe(5);
  expect(Object.keys(exported.project)).toEqual(Object.keys(before.project));
  expect(JSON.stringify(exported)).not.toMatch(
    /beforeClear|lifecycleEpoch|ImportPreview|"history"|rangeFirst|rangeSecond/,
  );
});

test("deletion preview rejects invalid and oversized requests with JSON and missing target stays unchanged", async ({
  page,
}) => {
  await openGraph(page, graphNeighbours());
  const g = (await stored(page)).plan.draft;
  const missing = await deletionPreview(page, g, {
    kind: "room",
    topologyKey: "missing",
  });
  expect(missing.status).toBe("invalid");
  expect(missing.impact).toBeNull();
  expect(missing.issues[0].code).toBe("deletion_target_missing");
  const statuses = await page.evaluate(async () => {
    const results = [];
    for (const body of ["{}", " ".repeat(2 * 1024 * 1024 + 1)]) {
      const r = await fetch("/api/plan/deletion-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      results.push({ status: r.status, body: await r.json() });
    }
    return results;
  });
  expect(statuses.map((r) => r.status)).toEqual([422, 413]);
  expect(statuses.every((r) => r.body.error.message)).toBe(true);
  expect((await stored(page)).plan.draft).toEqual(g);
});

for (const type of ["deleteRoom", "deleteVoid", "deleteConstraint"] as const)
  test(`deletion ${type} pending file round trip keeps intent and legacy condition`, async ({
    page,
  }) => {
    const g: any = graphWithVoid();
    g.constraints.push({
      id: "legacy-unbound",
      kind: "legacyUnbound",
      target: {
        originalConstraint: { kind: "old" },
        reason: "Не удалось привязать",
      },
      value: 25,
      fixed: true,
    });
    g.fieldInputs["constraint:legacy-unbound:value"] = "25,0";
    await openGraph(page, g);
    const d = await stored(page),
      r = await graphValidate(page, g),
      basis = structuredClone(d.plan.draft);
    d.plan.draftRevision++;
    const command =
      type === "deleteRoom"
        ? {
            type,
            topologyKey: r.faces[0].topologyKey,
            impactKey: "a".repeat(64),
          }
        : type === "deleteVoid"
          ? { type, voidId: "void", impactKey: "a".repeat(64) }
          : { type, constraintId: "legacy-unbound" };
    d.plan.pendingEdit = {
      kind: "graphV4",
      commandId: "pending-deletion",
      command,
      basisGraph: basis,
      targetDraftRevision: d.plan.draftRevision,
    };
    await importFile(page, {
      format: "plitka-project",
      version: 5,
      project: d,
    });
    await page.reload();
    await settle(page);
    const after = await stored(page);
    expect(after.plan.pendingEdit.command).toEqual(command);
    expect(after.plan.pendingEdit.basisGraph).toEqual(basis);
    expect(after.plan.draft.constraints).toEqual(g.constraints);
  });
test("deletion removing legacy unbound condition closes its context and preserves geometry", async ({
  page,
}) => {
  const g: any = graphNeighbours();
  g.constraints.push({
    id: "legacy",
    kind: "legacyUnbound",
    target: { originalConstraint: { kind: "old" }, reason: "Нет связи" },
    value: 25,
    fixed: true,
  });
  g.fieldInputs["constraint:legacy:value"] = "25,0";
  await openGraph(page, g);
  await canvasPick(page, "constraint", "legacy");
  await page
    .getByRole("button", { name: "Удалить условие", exact: true })
    .click();
  await settle(page);
  await expect(
    page.getByRole("button", { name: "Удалить условие", exact: true }),
  ).toHaveCount(0);
  expect((await stored(page)).plan.draft.vertices).toEqual(cleanV4Graph(g).vertices);
  expect((await stored(page)).plan.draft.fieldInputs).toEqual({});
});

test("context positive range conflict preserves desired measurement and original coordinates", async ({
  page,
}) => {
  const { graphRange } = await import("./fixtures/projects");
  const g = graphRange(true);
  for (const id of ["s0", "s1"])
    g.constraints.push({
      id: "fixed-" + id,
      kind: "segmentLength",
      target: { segmentId: id },
      value: 1000,
      fixed: true,
    });
  await openGraph(page, g);
  const response = await graphCommand(page, g, {
    type: "setLength",
    constraintId: "range",
    target: {
      kind: "chain",
      id: "chain",
      range: { startVertexId: "v0", endVertexId: "v2" },
    },
    value: 2300,
  });
  expect(response.http).toBe(200);
  expect(response.status).toBe("unresolved");
  expect(response.graph.vertices).toEqual(g.vertices);
  expect(
    response.graph.constraints.find((c: any) => c.id === "range").value,
  ).toBe(2300);
});
test("deletion room includes hole rings and deleting a void has distinct UI action from removing role", async ({
  page,
}) => {
  const g = graphWithVoid();
  await openGraph(page, g);
  const r = await graphValidate(page, g);
  const preview = await deletionPreview(page, g, {
    kind: "room",
    topologyKey: r.faces[0].topologyKey,
  });
  expect(preview.impact.segmentIds).toEqual(g.segments.map((s) => s.id).sort());
  expect(preview.impact.voidIds).toEqual(["void"]);
  await canvasPick(page, "void", "void");
  await page
    .getByRole("button", { name: "Удалить отверстие со стенами", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить со стенами", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.segments).toHaveLength(4);
  await page
    .getByRole("button", { name: "Отменить правку", exact: true })
    .click();
  await settle(page);
  await canvasPick(page, "void", "void");
  await page
    .getByRole("button", { name: "Снять роль отверстия", exact: true })
    .click();
  await settle(page);
  expect((await stored(page)).plan.draft.segments).toHaveLength(8);
  expect((await stored(page)).plan.draft.voids).toEqual([]);
});

test("clear project final queued save survives unmount and leaves another project intact", async ({
  page,
}) => {
  await openProject(page);
  await settle(page);
  const other = await stored(page);
  other.id = "other";
  other.name = "Другой проект";
  await page.evaluate((other) => {
    const data = JSON.parse(localStorage.getItem("plitka-projects-v5")!);
    data.projects.push(other);
    localStorage.setItem("plitka-projects-v5", JSON.stringify(data));
  }, other);
  await page.evaluate(() => {
    (window as any).locked = false;
    void navigator.locks.request("plitka-projects-write", async () => {
      (window as any).locked = true;
      await new Promise<void>((r) => ((window as any).unlock = r));
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).locked))
    .toBe(true);
  await clearProject(page);
  await page.getByRole("button", { name: "← Проекты", exact: true }).click();
  await page.evaluate(() => (window as any).unlock());
  await expect
    .poll(async () => (await stored(page)).plan.draft.vertices.length)
    .toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("plitka-projects-v5")!).projects.find(
        (d: any) => d.id === "other",
      ),
    ),
  ).toEqual(other);
  await page.goto("/#project/test");
  await settle(page);
  expect((await stored(page)).plan.draft.vertices).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Отменить правку", exact: true }),
  ).toBeDisabled();
});

test("deletion late preview cannot reopen after selecting a different object", async ({
  page,
}) => {
  await openGraph(page, graphNeighbours());
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    begin = new Promise<void>((r) => (started = r)),
    done = new Promise<void>((r) => (finished = r));
  await page.route("**/api/plan/deletion-preview", async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
    finished();
  });
  await canvasPick(page, "room", 1);
  await page
    .getByRole("button", { name: "Удалить помещение", exact: true })
    .click();
  await begin;
  await page.getByRole("button", { name: "Выбрать", exact: true }).click();
  await canvasPick(page, "segment", "as0");
  release();
  await done;
  await expect(
    page.getByRole("dialog", { name: "Удалить помещение" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Длина участка", { exact: true })).toBeVisible();
});

import { deletionProjects, projectCatalog, openDelete } from './fixtures/projects';
test('delete project write failure preserves catalog and retry succeeds', async ({ page }) => {
  await deletionProjects(page);
  const before = await projectCatalog(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreDeleteStorage = () => Storage.prototype.setItem = original;
    Storage.prototype.setItem = function(k, v) { if(k === 'plitka-projects-v5') throw new Error('Запись недоступна'); original.call(this, k, v); };
  });
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Запись недоступна');
  expect(await projectCatalog(page)).toEqual(before);
  await page.evaluate(() => (window as any).restoreDeleteStorage());
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(1);
});
test('delete project changed revision requires a new confirmation', async ({ page, context }) => {
  await deletionProjects(page);
  const dialog = await openDelete(page);
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('plitka-projects-v5')!);
    rows.projects[0].name = 'Новая версия'; rows.projects[0].documentRevision++;
    localStorage.setItem('plitka-projects-v5', JSON.stringify(rows));
  });
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('изменён');
  expect((await projectCatalog(page)).projects).toHaveLength(2);
  await expect(dialog.getByText('Новая версия', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.locator('.project-row')).toHaveCount(1);
});

import { holdProjectWrites, deleteFromEditor } from './fixtures/projects';
for (const pending of ['graphV4'] as const)
 test(`delete project pending ${pending} failure preserves document then deletes`, async ({ page }) => {
  await openDocument(page, await fullGraphDocument(pending));
  const before = await stored(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreDelete = () => Storage.prototype.setItem = original;
    Storage.prototype.setItem = function(k,v) { if(k === 'plitka-projects-v5') throw new Error('Нет места'); original.call(this,k,v); };
  });
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Удалить проект', exact: true });
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Нет места');
  expect(await stored(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.evaluate(() => (window as any).restoreDelete());
  await deleteFromEditor(page);
  expect((await projectCatalog(page)).projects).toEqual([]);
 });
test('delete project invalidates queued editor save under real lock', async ({ page }) => {
  await openProject(page); await settle(page);
  await holdProjectWrites(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Название проекта").fill("Изменённый проект");
  await page.getByRole("button", { name: "Закрыть меню проекта" }).click();
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Удалить проект', exact: true });
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Удаляем…' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).releaseDeleteLock());
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  expect((await projectCatalog(page)).projects).toEqual([]);
});
for (const mode of ['locks', 'corrupt', 'missing'] as const)
 test(`delete project handles ${mode} without false success`, async ({ page }) => {
  await deletionProjects(page);
  const dialog = await openDelete(page);
  await page.evaluate(mode => {
    if(mode === 'locks') Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    else if(mode === 'corrupt') localStorage.setItem('plitka-projects-v5', '{broken');
    else { const c = JSON.parse(localStorage.getItem('plitka-projects-v5')!); c.projects.shift(); localStorage.setItem('plitka-projects-v5', JSON.stringify(c)); }
  }, mode);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  if(mode === 'missing') { await expect(page.getByText('Проект уже удалён', { exact: true })).toBeVisible(); await expect(page.locator('.project-row')).toHaveCount(1); }
  else { await expect(dialog.getByRole('alert')).toBeVisible(); await expect(page.locator('.project-row')).toHaveCount(2); }
 });

  for (const failure of [false, true])
    test(`delete project late object preview ${failure ? "error" : "success"} ignored after project removal`, async ({
      page,
    }) => {
      await openGraph(page, graphNeighbours());
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        begin = new Promise<void>((r) => (started = r));
      await page.route("**/api/plan/deletion-preview", async (route) => {
        const response = await route.fetch();
        started();
        await gate;
        if (failure)
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "Старый preview" } }),
          });
        else await route.fulfill({ response });
      });
      await page
        .getByRole("button", { name: "Выбрать помещение", exact: true })
        .click();
      const point = await screenPoint(page, 1000, 1000);
      await page.mouse.click(point.x, point.y);
      await page
        .getByRole("button", { name: "Удалить помещение", exact: true })
        .click();
      await begin;
      await deleteFromEditor(page);
      release();
      await expect(
        page.getByRole("dialog", { name: "Удалить помещение" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Старый preview", { exact: true }),
      ).toHaveCount(0);
      expect((await projectCatalog(page)).projects).toEqual([]);
    });

for (const order of ['save-first', 'delete-first'] as const)
test(`delete project lock order ${order} cannot resurrect`, async ({ page, context }) => {
  await deletionProjects(page);
  const before = await projectCatalog(page);
  const dialog = await openDelete(page);
  const other = await context.newPage(); await other.goto('/');
  await holdProjectWrites(other);
  async function queueSave() {
    await other.evaluate(async doc => {
      const { saveV5 } = await import('/src/domain/plan/storage.ts');
      (window as any).saveFinished = false;
      void saveV5({ ...doc, address: 'Новый адрес' }, doc.documentRevision)
        .then(() => { (window as any).saveResult = 'saved'; }, () => { (window as any).saveResult = 'conflict'; })
        .finally(() => { (window as any).saveFinished = true; });
    }, before.projects[0]);
  }
  if (order === 'save-first') await queueSave();
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  if (order === 'delete-first') await queueSave();
  await other.evaluate(() => (window as any).releaseDeleteLock());
  await expect.poll(() => other.evaluate(() => (window as any).saveFinished)).toBe(true);
  if(order === 'save-first') {
    await expect(dialog.getByRole('alert')).toContainText('изменён');
    expect((await projectCatalog(page)).projects[0].address).toBe('Новый адрес');
  } else {
    await expect(page.locator('.project-row')).toHaveCount(1);
    expect(await other.evaluate(() => (window as any).saveResult)).toBe('conflict');
  }
  expect((await projectCatalog(page)).projects.find((p:any) => p.id === 'delete-1')).toEqual(before.projects[1]);
});
test('delete project own save after opening requires explicit reconfirmation', async ({ page }) => {
  await openProject(page); await settle(page);
  await holdProjectWrites(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Название проекта").fill("Изменённый проект");
  await page.getByRole("button", { name: "Закрыть меню проекта" }).click();
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  const before = await stored(page);
  await page.evaluate(() => (window as any).releaseDeleteLock());
  await expect.poll(async () => (await stored(page)).documentRevision).toBeGreaterThan(before.documentRevision);
  const dialog = page.getByRole('dialog', { name: 'Удалить проект', exact: true });
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('изменён');
  expect((await projectCatalog(page)).projects).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
});

test('delete project late completion cannot redirect a different editor', async ({ page }) => {
  await deletionProjects(page);
  await page.locator('.project-link').first().click(); await settle(page);
  await holdProjectWrites(page);
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить проект', exact: true }).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await page.evaluate(() => { location.hash = 'project/delete-1'; });
  await expect(page).toHaveURL(/project\/delete-1/);
  await page.evaluate(() => (window as any).releaseDeleteLock());
  await expect.poll(async () => (await projectCatalog(page)).projects.some((p:any) => p.id === 'delete-0')).toBe(false);
  await settle(page);
  await expect(page.locator('[data-project-canvas]')).toBeVisible();
  await expect(page).toHaveURL(/project\/delete-1/);
});

import { openGraph as flowOpenGraph, graphTwoRooms as flowTwoRooms, clearProject as flowClear } from './fixtures/projects';
for(const stage of ['object','tile','rules','variants']) test(`room flow legacy stage ${stage} and empty name normalize`,async({page})=>{
  await flowOpenGraph(page,flowTwoRooms());const d=await stored(page);
  d.workflow.requestedStage=stage;d.rooms[0].name='';delete d.rooms[0].boundaryMemory;
  await importFile(page,{format:'plitka-project',version:5,project:d});
  await expect(page.getByRole('button',{name:stage==='object'?'1. План':'2. Варианты',exact:true})).toHaveAttribute('aria-current','step');
  const after=await stored(page);expect(after.rooms.every((r:any)=>r.name.trim())).toBe(true);
  expect(after.plan.draft).toEqual(d.plan.draft);
});
test('room flow file round trip preserves memory and rejects malformed memory',async({page})=>{
  await flowOpenGraph(page,flowTwoRooms());const d=await stored(page);
  expect(d.rooms[0].boundaryMemory.geometryKey).toMatch(/^[a-f0-9]{64}$/);
  await importFile(page,{format:'plitka-project',version:5,project:d});
  expect((await stored(page)).rooms).toEqual(d.rooms);
  const bad=structuredClone(d);bad.rooms[0].boundaryMemory.geometryKey='broken';
  await expect(parseImportFixture(page,{format:'plitka-project',version:5,project:bad})).rejects.toThrow();
  expect((await stored(page)).rooms).toEqual(d.rooms);
});
test('room flow ambiguous detached memory never steals settings',async({page})=>{
  await flowOpenGraph(page,flowTwoRooms());const d=await stored(page),r=d.rooms[0];
  r.binding='detached';r.topologyKey='old';r.name='Исходная';r.material.tile=777;
  d.rooms.push({...structuredClone(r),id:'duplicate',name:'Дубликат'});
  await importFile(page,{format:'plitka-project',version:5,project:d});
  const after=await stored(page);expect(after.rooms.find((x:any)=>x.id===r.id).binding).toBe('detached');
  expect(after.rooms.find((x:any)=>x.id==='duplicate').binding).toBe('detached');
  expect(after.rooms.filter((x:any)=>x.binding==='attached')).toHaveLength(2);
  expect(after.rooms.filter((x:any)=>x.binding==='attached').every((x:any)=>x.material.tile===600)).toBe(true);
});
test('room flow clear undo preserves names and memory',async({page})=>{
  await flowOpenGraph(page,flowTwoRooms());const d=await stored(page);
  await flowClear(page);await settle(page);expect((await stored(page)).rooms).toEqual([]);
  await page.getByRole('button',{name:'Отменить правку',exact:true}).click();await settle(page);
  expect((await stored(page)).rooms).toEqual(d.rooms);
});

test('room flow changing holes retains outer room identity',async({page})=>{
  const {graphWithVoid}=await import('./fixtures/projects');
  await flowOpenGraph(page,graphWithVoid());const d=await stored(page),room=d.rooms[0];room.name='Кухня';room.material.tile=777;
  // A moved inner ring changes its geometry but leaves the outer boundary unchanged.
  const holeIds=new Set(d.plan.draft.voids[0].boundary.flatMap((ref:any)=>{const seg=d.plan.draft.segments.find((s:any)=>s.id===ref.segmentId);return [seg.startVertexId,seg.endVertexId];}));
  for(const v of d.plan.draft.vertices)if(holeIds.has(v.id))v.x+=50;
  await importFile(page,{format:'plitka-project',version:5,project:d});
  const after=(await stored(page)).rooms.find((r:any)=>r.id===room.id);
  expect(after.binding).toBe('attached');expect(after.name).toBe('Кухня');expect(after.material.tile).toBe(777);
});

test('v5 initialization removes every legacy catalog and preserves the new catalog on reload', async ({ page }) => {
  await page.addInitScript(({ oldCatalogs, catalog }) => {
    if (sessionStorage.getItem('seed-v5')) return;
    sessionStorage.setItem('seed-v5', 'yes');
    for (const [key, old] of Object.entries(oldCatalogs)) localStorage.setItem(key, JSON.stringify(old));
    localStorage.setItem('plitka-projects-v5', JSON.stringify(catalog));
  }, { oldCatalogs: oldCatalogsWithLayouts(), catalog: v5FilledCatalog() });
  await page.goto('/');
  await expect.poll(() => page.evaluate(keys => keys.every(key => !localStorage.getItem(key)), preV5CatalogKeys)).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!).projects.length)).toBe(1);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!))).toEqual(v5FilledCatalog());
});

test('v5 parser rejects precision beyond one decimal in nested snapshots', async ({ page }) => {
  await openProject(page);
  await confirmRoom(page);
  await settle(page);
  const document: any = await stored(page);
  document.plan.restorePoint = { graph: structuredClone(document.plan.draft), bindings: [], selectedRoomId: null };
  document.rooms[0].confirmed = {
    graph: structuredClone(document.plan.draft),
    boundary: { outer: document.plan.draft.segments.map((s: any) => ({ segmentId: s.id, forward: true })), holes: [] },
    topologyKey: document.rooms[0].topologyKey,
    dependencyKey: 'test-dependency', geometryKey: 'test-geometry', measurementKey: 'test-measurement',
    acknowledgment: null, sourceDraftRevision: document.plan.draftRevision,
  };
  const result = await page.evaluate(async (good) => {
    const { parseV5 } = await import('/src/domain/plan/schema.ts');
    const changes = [
      (d: any) => d.plan.draft.vertices[0].x = 0.01,
      (d: any) => d.plan.restorePoint.graph.chains[0].thicknessMm = 100.01,
      (d: any) => d.rooms[0].material.tile = 600.01,
      (d: any) => d.rooms[0].rules.angle = 0.01,
      (d: any) => d.rooms[0].confirmed.graph.vertices[0].x = 0.01,
    ];
    const rejects = changes.map(change => {
      const bad = structuredClone(good);
      change(bad);
      try { parseV5(bad); return false; } catch { return true; }
    });
    const view = structuredClone(good);
    view.viewport.centerX = 123.4567;
    return { good: parseV5(good).schemaVersion, rejects, viewport: parseV5(view).viewport.centerX };
  }, document);
  expect(result).toEqual({ good: 5, rejects: [true, true, true, true, true], viewport: 123.4567 });
  expect(v5EmptyCatalog.projects).toEqual([]);
});

test('new project persists in v5 after two reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByLabel('Название проекта').fill('Проверка v5');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!).projects.length)).toBe(1);
  await page.reload();
  await page.reload();
  const catalog = await page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!));
  expect(catalog.projects[0].schemaVersion).toBe(5);
  expect(catalog.projects[0].name).toBe('Проверка v5');
});

test('v5 catalog write failure leaves old catalogs intact and retry completes deletion', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seed-write-failure')) return;
    sessionStorage.setItem('seed-write-failure', 'yes');
    localStorage.setItem('plitka-projects-v4', JSON.stringify({ schemaVersion: 4, projects: [] }));
    const original = Storage.prototype.setItem;
    (window as any).restoreCatalogWrite = () => Storage.prototype.setItem = original;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'plitka-projects-v5') throw new DOMException('Нет места', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('plitka-projects-v5'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('plitka-projects-v4'))).not.toBeNull();
  await page.evaluate(() => (window as any).restoreCatalogWrite());
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plitka-projects-v5'))).not.toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plitka-projects-v4'))).toBeNull();
});

test('interrupted v5 cleanup resumes without replacing the new catalog', async ({ page }) => {
  const catalog = v5FilledCatalog();
  await page.addInitScript(catalog => {
    if (sessionStorage.getItem('seed-interrupted-cleanup')) return;
    sessionStorage.setItem('seed-interrupted-cleanup', 'yes');
    localStorage.setItem('plitka-projects-v5', JSON.stringify(catalog));
    localStorage.setItem('plitka-projects-v4', JSON.stringify({ schemaVersion: 4, projects: [] }));
    const original = Storage.prototype.removeItem;
    (window as any).restoreCatalogDelete = () => Storage.prototype.removeItem = original;
    Storage.prototype.removeItem = function(key) {
      if (key === 'plitka-projects-v4') throw new Error('Прерванная очистка');
      return original.call(this, key);
    };
  }, catalog);
  await page.goto('/');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!))).toEqual(catalog);
  expect(await page.evaluate(() => localStorage.getItem('plitka-projects-v4'))).not.toBeNull();
  await page.evaluate(() => (window as any).restoreCatalogDelete());
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plitka-projects-v4'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!))).toEqual(catalog);
});

test('an already open v4 editor cannot restore its deleted project through a stale save', async ({ page }) => {
  await page.addInitScript(catalog => {
    if (sessionStorage.getItem('seed-old-tab')) return;
    sessionStorage.setItem('seed-old-tab', 'yes');
    localStorage.setItem('plitka-projects-v4', JSON.stringify(catalog));
  }, v4FilledCatalog());
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plitka-projects-v4'))).toBeNull();
  const result = await page.evaluate(async project => {
    const { saveV4 } = await import('/src/domain/plan/storage.ts');
    try { await saveV4(project, project.documentRevision); return 'saved'; }
    catch (error) { return (error as Error).message; }
  }, v4FilledCatalog().projects[0]);
  expect(result).toMatch(/Конфликт/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plitka-projects-v5')!).projects)).toEqual([]);
});
