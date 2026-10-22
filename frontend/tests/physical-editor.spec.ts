import { expect, test } from "@playwright/test";
import { touchSession, v6DiagonalWallGraph, v6PhysicalDocument, v6SavedWallGraph } from "./fixtures/projects";
import type { Point, ProjectDocumentV6 } from "../src/domain/plan/types";
import { physicalBasisKey } from "../src/domain/plan/physical-basis";
import { parseV6Import } from "../src/domain/plan/migration";
import { splitWallDimensions } from "../src/domain/plan/physical-dimensions";
import { alignCubeAttachmentToGuides, centeredWallGeometry, immediateJointAngles,
  nearestCubeAttachment } from "../src/domain/plan/physical-draw";
import { newRoom } from "../src/domain/plan/rooms";
import { readFile } from "node:fs/promises";

test("physical v6 measures both exposed spans of a wall touched by a branch", () => {
  const graph = { walls: [{ id: "host", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
    side: "right" as const, thicknessMm: 100,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }]
  }], junctions: [] };
  const area = [{ outline: [[0, 0], [100, 0], [100, 450], [500, 450],
    [500, 550], [100, 550], [100, 1000], [0, 1000]], holes: [] }];
  const dimensions = splitWallDimensions(graph, area, 20);
  expect(dimensions.map(item => item.lengthMm)).toEqual([450, 450]);
  expect(dimensions.every(item => item.wallId === "host" && item.anchor.x > 100)).toBe(true);
});

test("wall cube attaches by its rotated side to a diagonal end cap", () => {
  const graph = v6DiagonalWallGraph();
  const capCenter = { x: 2964.65, y: 1035.35 };
  const pointer = { x: capCenter.x + 35.35, y: capCenter.y + 35.35 };
  const face = nearestCubeAttachment(graph, pointer, 2, 100);
  expect(face).not.toBeNull();
  expect(face!.center.x).toBeCloseTo(3000, 0);
  expect(face!.center.y).toBeCloseTo(1070.7, 0);
  expect(face!.normal.x).toBeCloseTo(Math.SQRT1_2, 2);
  expect(face!.normal.y).toBeCloseTo(Math.SQRT1_2, 2);
  const end = { x: pointer.x + 350, y: pointer.y + 350 };
  const geometry = centeredWallGeometry(graph, face!.center, end, 100);
  expect(geometry?.attachments[0]).not.toBeNull();
  expect(geometry?.corners[0].x + geometry!.corners[0].y).toBeCloseTo(4000, 0);
  expect(geometry?.corners[3].x + geometry!.corners[3].y).toBeCloseTo(4000, 0);
});

test("wall cube cannot remain inside a host wall and chooses its nearest face", () => {
  const graph = { walls: [{ id: "host", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
    side: "right" as const, thicknessMm: 400,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 400, y: 1000 }, { x: 400, y: 0 }],
  }], junctions: [] };
  expect(nearestCubeAttachment(graph, { x: 300, y: 500 }, 10, 100)?.center)
    .toEqual({ x: 450, y: 500 });
  expect(nearestCubeAttachment(graph, { x: 200, y: 950 }, 10, 100)?.center)
    .toEqual({ x: 200, y: 1050 });
});

test("a wall snapped near a host end aligns its outer corner and closes the cube-centre gap", () => {
  const graph = { walls: [{ id: "host", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
    side: "right" as const, thicknessMm: 100,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }],
  }], junctions: [] };
  const attachment = nearestCubeAttachment(graph, { x: 150, y: 10 }, 2, 100)!;
  expect(attachment.center).toEqual({ x: 150, y: 50 });
  const geometry = centeredWallGeometry(graph, attachment.center, { x: 1000, y: 50 }, 100,
    [attachment, null])!;
  expect(geometry.edge[0].x).toBe(100);
  expect(geometry.corners[0]).toEqual({ x: 100, y: 0 });
  expect(geometry.corners[3]).toEqual({ x: 100, y: 100 });
});

test("a wall face attachment preserves an exact 90 degree guide", () => {
  const graph = { walls: [{ id: "host", drawnEdge: [{ x: 900, y: 0 }, { x: 900, y: 1000 }],
    side: "right" as const, thicknessMm: 100,
    corners: [{ x: 900, y: 0 }, { x: 900, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }],
  }], junctions: [] };
  const start = { x: 150, y: 500 };
  const pointer = { x: 850, y: 501.5 };
  const face = nearestCubeAttachment(graph, pointer, 60, 100)!;
  const aligned = alignCubeAttachmentToGuides(start, pointer, face,
    [{ x: 1, y: 0 }, { x: 0, y: 1 }], 100, 12);
  expect(aligned.center).toEqual({ x: 850, y: 500 });
  const geometry = centeredWallGeometry(graph, start, aligned.center, 100,
    [null, aligned])!;
  expect(geometry.edge[0].y).toBe(geometry.edge[1].y);
});

test("a free wall begins at the cursor boundary opposite its draw direction", () => {
  const geometry = centeredWallGeometry({ walls: [], junctions: [] },
    { x: 0, y: 0 }, { x: 0, y: -1000 }, 100)!;
  const start = { x: (geometry.corners[0].x + geometry.corners[3].x) / 2,
    y: (geometry.corners[0].y + geometry.corners[3].y) / 2 };
  expect(start).toEqual({ x: 0, y: 50 });
  expect(Math.hypot(geometry.edge[1].x - geometry.edge[0].x,
    geometry.edge[1].y - geometry.edge[0].y)).toBe(1050);
});

test("an oblique snapped wall keeps a straight full-width end cap", () => {
  const end = { x: 100, y: -700 };
  const attachment = {
    point: { x: 100, y: -550 }, center: end,
    normal: { x: 0, y: -1 }, from: { x: -400, y: -800 }, to: { x: 400, y: -400 },
    distance: 0, tangentialShift: 0,
  };
  const geometry = centeredWallGeometry({ walls: [], junctions: [] },
    { x: 0, y: 0 }, end, 100, [null, attachment])!;
  const cap = { x: geometry.corners[2].x - geometry.corners[1].x,
    y: geometry.corners[2].y - geometry.corners[1].y };
  expect(Math.hypot(cap.x, cap.y)).toBeCloseTo(100, 1);
  expect(cap.x * geometry.direction.x + cap.y * geometry.direction.y).toBeCloseTo(0, 1);
});

test("an oblique wall snapped between two host faces is accepted as two junctions", async ({ request }) => {
  let graph: ProjectDocumentV6["plan"]["draft"] = { walls: [], junctions: [] };
  let revision = 0;
  for (const [edge, side] of [
    [[[-600, 0], [600, 0]], "right"],
    [[[-500, -1000], [300, -600]], "left"],
  ] as const) {
    const response = await request.post("/api/v5/plan/command", { data: {
      schemaVersion: 5, commandId: `oblique-host-${revision}`, draftRevision: revision,
      basisKey: await physicalBasisKey(graph), graph,
      command: { type: "drawWall", drawnEdge: edge.map(([x, y]) => ({ x, y })),
        side, thicknessMm: 100 },
    } });
    const result = await response.json();
    expect(result.status).toBe("applied");
    graph = result.graph;
    revision++;
  }
  const top = graph.walls[0];
  const lower = graph.walls[1];
  const startPointer = { x: (top.corners[1].x + top.corners[2].x) / 2,
    y: (top.corners[1].y + top.corners[2].y) / 2 };
  const endPointer = { x: (lower.corners[1].x + lower.corners[2].x) / 2,
    y: (lower.corners[1].y + lower.corners[2].y) / 2 };
  const startAttachment = nearestCubeAttachment(graph, startPointer, 2, 100)!;
  const endAttachment = nearestCubeAttachment(graph, endPointer, 2, 100)!;
  const geometry = centeredWallGeometry(graph, startAttachment.center, endAttachment.center, 100,
    [startAttachment, endAttachment])!;
  expect(Math.hypot(geometry.corners[2].x - geometry.corners[1].x,
    geometry.corners[2].y - geometry.corners[1].y)).toBeCloseTo(100, 1);
  const response = await request.post("/api/v5/plan/command", { data: {
    schemaVersion: 5, commandId: "oblique-bridge", draftRevision: revision,
    basisKey: await physicalBasisKey(graph), graph,
    command: { type: "drawWall", drawnEdge: geometry.edge, side: "left", thicknessMm: 100 },
  } });
  const result = await response.json();
  expect(result.status, JSON.stringify({ edge: geometry.edge, corners: geometry.corners,
    issues: result.issues })).toBe("applied");
  expect(result.graph.walls).toHaveLength(3);
  expect(result.graph.junctions).toHaveLength(2);
  const changedTop = result.graph.walls.find((wall: { id: string }) => wall.id === top.id);
  const changedLower = result.graph.walls.find((wall: { id: string }) => wall.id === lower.id);
  expect([changedTop.corners[1], changedTop.corners[2]])
    .not.toEqual([top.corners[1], top.corners[2]]);
  expect([changedLower.corners[1], changedLower.corners[2]])
    .not.toEqual([lower.corners[1], lower.corners[2]]);
});

test("a diagonal brace closes the inside of an existing L corner", async ({ request }) => {
  let graph: ProjectDocumentV6["plan"]["draft"] = { walls: [], junctions: [] };
  let revision = 0;
  for (const [edge, side] of [
    [[[0, 0], [1200, 0]], "right"],
    [[[0, 0], [0, -1200]], "left"],
  ] as const) {
    const response = await request.post("/api/v5/plan/command", { data: {
      schemaVersion: 5, commandId: `brace-host-${revision}`, draftRevision: revision,
      basisKey: await physicalBasisKey(graph), graph,
      command: { type: "drawWall", drawnEdge: edge.map(([x, y]) => ({ x, y })),
        side, thicknessMm: 100 },
    } });
    const result = await response.json();
    expect(result.status, JSON.stringify(result.issues)).toBe("applied");
    graph = result.graph;
    revision++;
  }
  expect(graph.junctions).toHaveLength(1);
  const startAttachment = nearestCubeAttachment(graph, { x: 100, y: -1100 }, 2, 100)!;
  const endAttachment = nearestCubeAttachment(graph, { x: 1100, y: -100 }, 2, 100)!;
  const geometry = centeredWallGeometry(graph, startAttachment.center, endAttachment.center, 100,
    [startAttachment, endAttachment])!;
  const response = await request.post("/api/v5/plan/command", { data: {
    schemaVersion: 5, commandId: "diagonal-brace", draftRevision: revision,
    basisKey: await physicalBasisKey(graph), graph,
    command: { type: "drawWall", drawnEdge: geometry.edge, side: "left", thicknessMm: 100 },
  } });
  const result = await response.json();
  expect(result.status, JSON.stringify({ edge: geometry.edge, issues: result.issues }))
    .toBe("applied");
  expect(result.graph.walls).toHaveLength(3);
  expect(result.graph.junctions).toHaveLength(3);
});

test("a bridge can join two walls inside a compound angled layout", async ({ request }) => {
  let graph: ProjectDocumentV6["plan"]["draft"] = { walls: [], junctions: [] };
  let revision = 0;
  const apply = async (edge: [Point, Point], id: string) => {
    const response = await request.post("/api/v5/plan/command", { data: {
      schemaVersion: 5, commandId: id, draftRevision: revision,
      basisKey: await physicalBasisKey(graph), graph,
      command: { type: "drawWall", drawnEdge: edge, side: "left", thicknessMm: 100 },
    } });
    const result = await response.json();
    expect(result.status, JSON.stringify({ id, edge, issues: result.issues })).toBe("applied");
    graph = result.graph;
    revision++;
  };
  const attach = (wallIndex: number, edge: "drawn" | "opposite", ratio: number) => {
    const wall = graph.walls[wallIndex];
    const [from, to] = edge === "drawn"
      ? [wall.corners[0], wall.corners[1]] : [wall.corners[3], wall.corners[2]];
    const point = { x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio };
    return nearestCubeAttachment(graph, point, 2, 100)!;
  };
  const applySnapped = async (start: ReturnType<typeof attach>,
                              end: ReturnType<typeof attach> | Point, id: string) => {
    const endAttachment = "center" in end ? end : null;
    const endPoint = endAttachment?.center ?? end;
    const geometry = centeredWallGeometry(graph, start.center, endPoint, 100,
      [start, endAttachment])!;
    await apply(geometry.edge, id);
  };

  await apply([{ x: 0, y: 0 }, { x: 1200, y: 0 }], "compound-top");
  await apply([{ x: 0, y: -100 }, { x: 0, y: -1200 }], "compound-left");
  await applySnapped(attach(1, "opposite", .92), attach(0, "opposite", .88), "compound-first-diagonal");
  await applySnapped(attach(2, "drawn", .45), { x: 1500, y: -1150 }, "compound-branch");
  await applySnapped(attach(3, "opposite", .55), { x: 1500, y: -100 }, "compound-second-diagonal");
  const beforeBridge = graph.junctions.length;
  await applySnapped(attach(2, "drawn", .82), attach(4, "drawn", .82), "compound-bridge");
  expect(graph.walls).toHaveLength(6);
  expect(graph.junctions.length).toBeGreaterThanOrEqual(beforeBridge + 2);
});

test("physical v6 continues one tile grid through three separate rooms after reload", async ({ page, request }) => {
  let graph: ProjectDocumentV6["plan"]["draft"] = { walls: [], junctions: [] };
  let faces: { topologyKey: string; polygon: { outline: number[][] } }[] = [];
  let revision = 0;
  const walls: [number[][], "left" | "right"][] = [
    [[[0, 0], [3000, 0]], "right"],
    [[[3000, 0], [3000, 2000]], "left"],
    [[[3000, 2000], [0, 2000]], "right"],
    [[[0, 2000], [0, 0]], "left"],
    [[[1000, 0], [1000, 2000]], "left"],
    [[[2000, 0], [2000, 2000]], "left"],
  ];
  for (const [edge, side] of walls) {
    const response = await request.post("/api/v5/plan/command", { data: {
      schemaVersion: 5, commandId: `shared-grid-${revision}`, draftRevision: revision,
      basisKey: await physicalBasisKey(graph), graph,
      command: { type: "drawWall", drawnEdge: edge.map(([x, y]) => ({ x, y })),
        side, thicknessMm: 100 },
    } });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("applied");
    graph = body.graph;
    faces = body.faces;
    revision++;
  }
  expect(faces).toHaveLength(3);
  const ordered = [...faces].sort((a, b) =>
    Math.min(...a.polygon.outline.map(point => point[0])) -
    Math.min(...b.polygon.outline.map(point => point[0])));
  const names = ["Коридор", "Туалет", "Ванная"];
  const rooms = ordered.map((face, index) => ({ ...newRoom(face.topologyKey, names[index]),
    id: `shared-room-${index}` }));
  rooms[1].material.tile = 300;
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan = { draft: graph, draftRevision: revision, pendingEdit: null, restorePoint: null };
  document.rooms = rooms;
  document.selectedRoomId = rooms[0].id;
  document.viewport = { centerX: 2200, centerY: 500, zoom: 2, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await page.getByRole("button", { name: "Раскладка", exact: true }).click();
  await page.getByRole("button", { name: "Сквозная раскладка" }).click();
  await expect(page.getByText(/швы продолжаются через стены/)).toBeVisible();
  await page.getByRole("button", { name: "Рассчитать 3 помещения от «Коридор»" }).click();
  for (const room of rooms)
    await expect(page.locator(`[data-layout-room-id="${room.id}"]`).first()).toBeVisible();
  await expect(page.locator('[data-layout-room-id="shared-room-0"]').first()).toBeVisible();
  await expect(page.getByText("3 помещения одной сеткой. Начало — «Коридор»." )).toBeVisible();
  await page.locator(`[data-room-key="${ordered[1].topologyKey}"]`).click();
  await expect(page.getByText("Вы выбрали новое начало. Сейчас раскладка построена от «Коридор»." )).toBeVisible();
  await page.getByRole("button", { name: "Пересчитать 3 помещения от «Туалет»" }).click();
  await expect(page.getByText("3 помещения одной сеткой. Начало — «Туалет»." )).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0]);
  expect(saved.sharedGrid.referenceRoomId).toBe(rooms[1].id);
  expect(saved.sharedGrid.linkedRoomIds).toEqual([rooms[0].id, rooms[2].id]);
  const recalculations: { tile: number; grout: number; angle: number;
    offset_x: number; offset_y: number }[] = [];
  page.on("request", event => {
    if (event.url().endsWith("/api/v5/layout")) recalculations.push(event.postDataJSON());
  });
  await page.reload();
  for (const room of rooms)
    await expect(page.locator(`[data-layout-room-id="${room.id}"]`).first()).toBeVisible();
  expect(recalculations).toHaveLength(3);
  for (const request of recalculations)
    expect([request.tile, request.grout, request.angle, request.offset_x, request.offset_y])
      .toEqual([saved.sharedGrid.tile, saved.sharedGrid.grout, saved.sharedGrid.angle,
        saved.sharedGrid.offsetX, saved.sharedGrid.offsetY]);
});

test("physical v6 draws at free coordinates and previews wall and branch lengths", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = { walls: [{ id: "host", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
    side: "right", thicknessMm: 100,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }]
  }], junctions: [] };
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.viewport = { centerX: 200, centerY: 500, zoom: 4, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await expect(page.locator("[data-wall-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const svg = node as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = coordinates.x; point.y = -coordinates.y;
    const screen = point.matrixTransform(svg.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  const start = await clientPoint(100, 453.7);
  const end = await clientPoint(510.3, 453.7);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y);
  await expect(canvas.locator("[data-wall-preview-length]")).toContainText("410,3 мм");
  await expect(canvas.locator('[data-wall-segment-length="host"]')).toHaveCount(2);
  await page.mouse.click(end.x, end.y);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls.length)).toBe(2);
  const edge = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[1].drawnEdge);
  expect(edge[0].y).toBe(403.7);
  expect(edge[1].y).toBe(403.7);
  await expect(canvas.locator('[data-wall-segment-length="host"]')).toHaveCount(2);
  const lengths = await canvas.locator('[data-wall-segment-length="host"]').allTextContents();
  expect(lengths).toContain("403,7 мм");
  expect(lengths).toContain("496,3 мм");
});

test("physical v6 replays a saved pending wall command", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.pendingEdit = {
    kind: "graphV5", commandId: "resume-wall",
    basisGraph: document.plan.draft,
    targetDraftRevision: document.plan.draftRevision,
    command: { type: "drawWall", drawnEdge: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
      side: "left", thicknessMm: 100 },
  };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await expect.poll(() => page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan;
    return [plan.draft.walls.length, plan.pendingEdit];
  })).toEqual([1, null]);
  await page.reload();
  await expect(page.locator("[data-wall-id]")).toHaveCount(1);
});

test("physical v6 repairs a saved wall cap when the project opens", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.plan.draft = { walls: [{ id: "host", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
    side: "right", thicknessMm: 100,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }] },
  { id: "old-branch", drawnEdge: [{ x: 100, y: 500 }, { x: 600, y: 800 }],
    side: "left", thicknessMm: 100,
    corners: [{ x: 100, y: 500 }, { x: 600, y: 800 },
      { x: 548.6, y: 885.7 }, { x: 48.6, y: 585.7 }] }],
  junctions: [{ id: "old-joint", participants: [
    { wallId: "host", edge: "opposite", point: { x: 100, y: 500 }, attachment: "interior" },
    { wallId: "old-branch", edge: "startCap", point: { x: 100, y: 500 }, attachment: "end" },
  ] }] };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  const validated = page.waitForResponse(response => response.url().endsWith("/api/v5/plan/validate"));
  await page.goto("/#project/physical-v6-fixture");
  expect((await (await validated).json()).normalizedGraph).toBeTruthy();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[1].corners[3].x))
    .toBe(100);
  await page.reload();
  await expect(page.locator("[data-wall-id]")).toHaveCount(2);
});

test("physical v6 keeps a failed network command for retry after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Повтор команды");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await page.route("**/api/v5/plan/command", route => route.abort());
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2 - 100, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 100, y: box.height / 2 } });
  await expect.poll(() => page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan;
    return [plan.draft.walls.length, plan.pendingEdit?.kind];
  })).toEqual([0, "graphV5"]);
  await page.unroute("**/api/v5/plan/command");
  await page.reload();
  await expect.poll(() => page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan;
    return [plan.draft.walls.length, plan.pendingEdit];
  })).toEqual([1, null]);
});

test("physical v6 keeps a rejected wall message visible until it is dismissed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Ошибка стены");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.route("**/api/v5/plan/command", async route => {
    const request = route.request().postDataJSON();
    const response = await route.fetch();
    const body = await response.json();
    body.status = "invalid";
    body.graph = request.graph;
    body.issues = [{ code: "invalid_geometry", message: "Не удалось построить этот стык.",
      entityIds: [], affectedRoomKeys: [], scope: "global" }];
    await route.fulfill({ response, json: body });
  });
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2 - 100, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 100, y: box.height / 2 } });
  const error = page.getByRole("alert").filter({ hasText: "Не удалось построить этот стык." });
  await expect(error).toBeVisible();
  await page.waitForTimeout(500);
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Закрыть" }).click();
  await expect(error).toHaveCount(0);
});

test("physical v6 mobile panel selects a wall point at low zoom", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 },
    hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
    document.plan.draft = v6SavedWallGraph();
    document.plan.pendingEdit = null;
    document.plan.restorePoint = null;
    document.viewport = { centerX: 500, centerY: 0, zoom: 1, gridStepMm: 100 };
    await page.goto("/");
    await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
      JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
    await page.goto("/#project/physical-v6-fixture");
    await page.locator("[data-wall-id]").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Конец", exact: true }).click();
    await page.getByRole("group", { name: "Сдвиг точки стены" })
      .getByRole("button", { name: "Сдвинуть точку стены → на 1 мм" }).click();
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0].drawnEdge[1].x))
      .toBe(1001);
  } finally { await context.close(); }
});

test("physical v6 project creates a wall and reopens it twice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Физический план");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.locator("[data-physical-canvas]")).toBeVisible();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width / 2 - 120, y: box!.height / 2 } });
  await canvas.click({ position: { x: box!.width / 2 + 120, y: box!.height / 2 } });
  await expect.poll(() => page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("plitka-projects-v6") ?? "{}");
    return rows.projects?.[0]?.plan?.draft?.walls?.length;
  })).toBe(1);
  const document = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0]);
  expect(document.schemaVersion).toBe(6);
  expect(document.plan.draft.walls[0].corners).toHaveLength(4);
  expect(await page.evaluate(() => localStorage.getItem("plitka-projects-v5"))).toBeNull();
  await page.getByRole("button", { name: "Раскрыть меню" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await page.locator("[data-wall-id]").click();
  await expect(page.locator("[data-wall-handle]")).toHaveCount(3);
  await page.getByRole("button", { name: "Точка стены: середина" }).click();
  const beforeNudge = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0].drawnEdge);
  await page.getByRole("button", { name: "Сдвинуть стену → на 1 мм" }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0].drawnEdge[0].x)).toBe(beforeNudge[0].x + 1);
  await page.getByRole("button", { name: "Раскрыть меню" }).click();
  await page.getByRole("button", { name: "Отменить правку" }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0].drawnEdge[0].x)).toBe(beforeNudge[0].x);
  for (let index = 0; index < 2; index++) {
    await page.reload();
    await expect(page.locator("[data-physical-canvas]")).toBeVisible();
    await expect(page.locator("[data-wall-id]")).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать проект" }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe("Физический план.json");
  const imported = parseV6Import(JSON.parse(await readFile(await exported.path(), "utf8")));
  expect(imported.plan.draft.walls).toHaveLength(1);
  await page.getByRole("button", { name: "Удалить проект" }).first().click();
  await page.getByRole("dialog", { name: "Удалить проект" }).getByRole("button", { name: "Удалить проект" }).click();
  await expect(page.getByRole("heading", { name: "Проекты", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects)).toHaveLength(0);
});

test("physical v6 pan between wall taps keeps the first world point", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Жесты");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2 - 60, y: box.height / 2 } });
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0]);
  expect(first.plan.draft.walls).toHaveLength(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.centerX)).not.toBe(0);
  const afterPan = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0]);
  expect(afterPan.plan.draft.walls).toHaveLength(0);
  await expect(page.getByRole("group", { name: "Сторона от проведённого края" })).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Толщина, мм" }).fill("150");
  await canvas.click({ position: { x: box.width / 2 + 65, y: box.height / 2 } });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls.length)).toBe(1);
  const wall = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0]);
  expect(wall.drawnEdge[0].x).toBeLessThan(0);
  expect(wall.side).toBe("left");
  expect(wall.thicknessMm).toBe(150);
  const choices = page.getByRole("group", { name: "Режим проекта" });
  await expect(choices).toBeVisible();
  const bounds = (await choices.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await choices.getByRole("button", { name: "Раскладка" }).click();
  await expect(page.getByRole("heading", { name: "Раскладка" })).toBeVisible();
});

test("physical v6 cancels an unfinished wall by button or Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Отмена стены");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  const first = { x: box.width / 2 - 100, y: box.height / 2 };
  await canvas.click({ position: first });
  await page.getByRole("button", { name: "Отменить начало стены" }).click();
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  await canvas.click({ position: first });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Завершить инструмент «Стена»" })).toBeVisible();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls)).toEqual([]);
});

test("physical v6 resets the wall tool by a visible action or Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Сброс инструмента");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const reset = page.getByRole("button", { name: "Завершить инструмент «Стена»" });
  await expect(reset).toBeVisible();
  let bounds = (await reset.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await reset.click();
  await expect(reset).toHaveCount(0);

  await page.getByRole("button", { name: "Раскрыть меню" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await expect(reset).toBeVisible();
  await page.setViewportSize({ width: 740, height: 375 });
  bounds = (await reset.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(375);
  await page.keyboard.press("Escape");
  await expect(reset).toHaveCount(0);
});

test("physical v6 desktop wall cursor matches wall thickness", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Курсор стены");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const cursor = canvas.locator("[data-wall-cursor]");
  await expect(cursor.locator("[data-wall-cursor-corner]")).toHaveCount(0);
  const footprint = () => cursor.locator("path").evaluate(node => {
    const bounds = (node as SVGGraphicsElement).getBBox();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  await expect.poll(async () => (await footprint()).width).toBe(100);
  const center = await cursor.locator("[data-wall-cursor-center]").evaluate(node => ({
    x: Number(node.getAttribute("cx")), y: Number(node.getAttribute("cy")),
  }));
  const initialFootprint = await footprint();
  expect(center.x).toBe(initialFootprint.x + initialFootprint.width / 2);
  expect(center.y).toBe(initialFootprint.y + initialFootprint.height / 2);
  const first = (await footprint()).x;
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2);
  const next = (await footprint()).x;
  expect(next - first).toBeGreaterThan(50);
  expect(next - first).toBeLessThan(150);
  await page.getByRole("spinbutton", { name: "Толщина, мм" }).fill("200");
  await expect.poll(async () => (await footprint()).width).toBe(200);
  await expect.poll(async () => (await footprint()).height).toBe(200);
  await page.getByRole("spinbutton", { name: "Толщина, мм" }).fill("55");
  await expect(page.getByRole("alert")).toContainText("шагом 10 мм");
});

test("physical v6 moves an intersecting wall cursor onto the nearest host face", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = { walls: [{ id: "thick-host",
    drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }], side: "right", thicknessMm: 400,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 400, y: 1000 }, { x: 400, y: 0 }],
  }], junctions: [] };
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.viewport = { centerX: 200, centerY: 500, zoom: 5, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await expect(page.locator("[data-wall-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const point = new DOMPoint(coordinates.x, -coordinates.y)
      .matrixTransform((node as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, { x, y });
  const footprint = () => canvas.locator("[data-wall-cursor] path").evaluate(node => {
    const bounds = (node as SVGGraphicsElement).getBBox();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  const side = await clientPoint(300, 500);
  await page.mouse.move(side.x, side.y);
  await expect.poll(async () => (await footprint()).x).toBe(400);
  const cap = await clientPoint(200, 900);
  await page.mouse.move(cap.x, cap.y);
  await expect.poll(async () => (await footprint()).y).toBe(-1100);
});

test("physical v6 commits a snapped wall near a host end as a junction", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = { walls: [{ id: "host",
    drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }], side: "right", thicknessMm: 100,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }],
  }], junctions: [] };
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.viewport = { centerX: 500, centerY: 500, zoom: 5, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const point = new DOMPoint(coordinates.x, -coordinates.y)
      .matrixTransform((node as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, { x, y });
  const start = await clientPoint(150, 10);
  const end = await clientPoint(1000, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(() => page.evaluate(() => {
    const graph = JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft;
    return { walls: graph.walls.length, junctions: graph.junctions.length,
      start: graph.walls[1]?.drawnEdge[0],
      startCap: graph.walls[1] ? [graph.walls[1].corners[0], graph.walls[1].corners[3]] : null };
  })).toEqual({ walls: 2, junctions: 1, start: { x: 100, y: 0 },
    startCap: [{ x: 100, y: 0 }, { x: 100, y: 100 }] });
});

test("physical v6 keeps a face-to-face wall exactly perpendicular", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = { walls: [
    { id: "left", drawnEdge: [{ x: 0, y: 0 }, { x: 0, y: 1000 }],
      side: "right", thicknessMm: 100,
      corners: [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 100, y: 1000 }, { x: 100, y: 0 }] },
    { id: "right", drawnEdge: [{ x: 1000, y: 0 }, { x: 1000, y: 1000 }],
      side: "left", thicknessMm: 100,
      corners: [{ x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 900, y: 1000 }, { x: 900, y: 0 }] },
  ], junctions: [] };
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.viewport = { centerX: 500, centerY: 500, zoom: 5, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const point = new DOMPoint(coordinates.x, -coordinates.y)
      .matrixTransform((node as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, { x, y });
  const start = await clientPoint(150, 500);
  const end = await clientPoint(850, 501.5);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(() => page.evaluate(() => {
    const wall = JSON.parse(localStorage.getItem("plitka-projects-v6")!)
      .projects[0].plan.draft.walls[2];
    return wall ? [wall.drawnEdge[0].y, wall.drawnEdge[1].y] : null;
  })).toEqual([450, 450]);
});

test("physical v6 snaps a diagonal wall to a face and previews the joint angle", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = v6SavedWallGraph() as ProjectDocumentV6["plan"]["draft"];
  document.viewport = { centerX: 500, centerY: -200, zoom: 5, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await expect(page.getByRole("group", { name: "Сторона от проведённого края" })).toHaveCount(0);
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const svg = node as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = coordinates.x; point.y = -coordinates.y;
    const screen = point.matrixTransform(svg.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  const start = await clientPoint(100, -500);
  const end = await clientPoint(600, -50);
  const nearFace = await clientPoint(600, -40);
  await page.mouse.move(nearFace.x, nearFace.y);
  const cursor = canvas.locator("[data-wall-cursor]");
  await expect(cursor.locator("[data-wall-cursor-corner]")).toHaveCount(4);
  await expect.poll(() => cursor.locator("path").evaluate(node =>
    (node as SVGGraphicsElement).getBBox().y)).toBe(0);
  await expect.poll(() => cursor.locator("path").evaluate(node =>
    (node as SVGGraphicsElement).getBBox().height)).toBe(100);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y + 5);
  await expect(canvas.locator("[data-wall-preview-angle]")).toHaveCount(2);
  await expect(canvas.locator("[data-wall-angle-arc]")).toHaveCount(2);
  const angles = await canvas.locator("[data-wall-preview-angle]").allTextContents();
  expect(angles[0]).not.toBe(angles[1]);
  await page.mouse.click(end.x, end.y + 5);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls.length)).toBe(2);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft);
  expect(stored.walls[1].drawnEdge[1].y).toBeGreaterThan(-100);
  expect(stored.junctions).toHaveLength(1);
});

test("physical v6 shows a joined wall and angles before the server preview", async ({ page }) => {
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.viewport = { centerX: 500, centerY: -200, zoom: 5, gridStepMm: 100 };
  await page.route("**/api/v5/plan/preview", async route => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const clientPoint = (x: number, y: number) => canvas.evaluate((node, coordinates) => {
    const svg = node as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = coordinates.x; point.y = -coordinates.y;
    const screen = point.matrixTransform(svg.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  const start = await clientPoint(500, -50);
  const end = await clientPoint(500, -500);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y);
  await expect(canvas.locator("[data-immediate-wall-preview]")).toBeVisible();
  await expect(canvas.locator("[data-wall-preview-angle]")).toHaveCount(2);
  await expect(canvas.locator("[data-wall-angle-arc]")).toHaveCount(2);
});

test("physical v6 selects a room from its usable floor", async ({ page, request }) => {
  let graph: unknown = { walls: [], junctions: [] };
  const walls: [number[][], "left" | "right"][] = [
    [[[0, 0], [1000, 0]], "right"],
    [[[1000, 0], [1000, 1000]], "left"],
    [[[1000, 1000], [0, 1000]], "right"],
    [[[0, 1000], [0, 0]], "left"],
  ];
  for (const [index, [edge, side]] of walls.entries()) {
    const response = await request.post("/api/v5/plan/command", { data: {
      schemaVersion: 5, commandId: `browser-room-${index}`, draftRevision: index,
      basisKey: await physicalBasisKey(graph as ProjectDocumentV6["plan"]["draft"]), graph,
      command: { type: "drawWall", drawnEdge: edge.map(([x, y]) => ({ x, y })),
        side, thicknessMm: 100 },
    } });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("applied");
    graph = body.graph;
  }
  const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
  document.plan.draft = graph as ProjectDocumentV6["plan"]["draft"];
  document.plan.pendingEdit = null;
  document.plan.restorePoint = null;
  document.rooms = [];
  document.selectedRoomId = null;
  document.viewport = { centerX: 500, centerY: 500, zoom: 4, gridStepMm: 100 };
  await page.goto("/");
  await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
    JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
  await page.goto("/#project/physical-v6-fixture");
  await expect(page.locator("[data-room-key]")).toHaveCount(1);
  await expect(page.locator("[data-room-key]")).toHaveAttribute("fill", "#fff");
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].rooms.length)).toBe(1);
  await page.getByRole("button", { name: "Раскладка", exact: true }).click();
  await expect(page.locator("[data-room-key]")).toHaveAttribute("fill", "#fff4bb");
  await page.locator("[data-room-key]").click();
  await expect(page.getByRole("textbox", { name: "Название помещения" })).toHaveValue("Помещение 1");
  await expect(page.getByText("800 000,0 мм²")).toBeVisible();
  await expect(page.locator("[data-physical-canvas]").getByText("90,0°").first()).toBeVisible();
  await expect(page.locator("[data-physical-canvas]").getByText("800,0 мм").first()).toBeVisible();
  await page.getByRole("button", { name: "Подобрать раскладку" }).click();
  await expect(page.getByText(/Плиток:/)).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Таблица деталей · CSV" }).click();
  const csv = await csvDownload;
  expect((await readFile(await csv.path(), "utf8"))).toContain("Площадь мм²");
  await expect(page.locator("[data-room-key]")).toHaveAttribute("fill", "#fff");
  await expect(page.locator("[data-room-key]")).toHaveCount(1);
  const roomId = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].rooms[0].id);
  await page.getByRole("button", { name: "Раскрыть меню" }).click();
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByRole("button", { name: "Очистить проект" }).first().click();
  await page.getByRole("dialog", { name: "Очистить проект" }).getByRole("button", { name: "Очистить проект" }).click();
  await expect(page.locator("[data-room-key]")).toHaveCount(0);
  await page.getByRole("button", { name: "Вернуть план к сохранённому снимку" }).click();
  await expect(page.locator("[data-room-key]")).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].rooms[0].id)).toBe(roomId);
});

test("physical v6 starts freely and offers separated 90-degree touch targets", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 },
    hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Новый проект" }).click();
    await page.getByRole("textbox", { name: "Название проекта" }).fill("Касания");
    await page.getByRole("button", { name: "Создать проект" }).click();
    await page.getByRole("button", { name: "Раскрыть меню" }).click();
    await page.getByRole("button", { name: "Стена", exact: true }).click();
    await expect(page.locator("[data-mobile-target]")).toHaveCount(0);
    await page.touchscreen.tap(185, 350);
    const targets = await page.locator("[data-mobile-target]").evaluateAll(nodes => nodes.map(node => {
      const dot = node.querySelector("circle")!;
      const x = Number(dot.getAttribute("cx")), y = Number(dot.getAttribute("cy"));
      const matrix = (node as SVGGElement).getScreenCTM()!;
      return { x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
        worldX: x, worldY: -y };
    }));
    expect(targets.length).toBeGreaterThan(0);
    for (let index = 0; index < targets.length; index++)
      for (const other of targets.slice(index + 1))
        expect(Math.hypot(targets[index].x - other.x, targets[index].y - other.y)).toBeGreaterThanOrEqual(43.9);
    const second = targets.find(point => Math.abs(point.y - 350) < 2 && point.x > 230 && point.x < 350)!;
    expect(second).toBeTruthy();
    const guides = await page.locator("[data-guide-target]").evaluateAll(nodes => nodes.map(node => {
      const circle = node.querySelector("circle")!;
      return { x: Number(circle.getAttribute("cx")), y: -Number(circle.getAttribute("cy")) };
    }));
    expect(guides.length).toBeGreaterThan(0);
    for (const guide of guides) {
      expect(Number.isInteger(guide.x * 10)).toBeTruthy();
      expect(Number.isInteger(guide.y * 10)).toBeTruthy();
    }
    await page.touchscreen.tap(second.x, second.y);
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls.length)).toBe(1);
    const edge = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls[0].drawnEdge);
    expect(edge[0].y).toBe(edge[1].y);
    expect(edge[0].x % 100).not.toBe(0);
  } finally { await context.close(); }
});

test("physical v6 previews and deletes a selected wall", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Удаление стены");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2 - 120, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 120, y: box.height / 2 } });
  await expect(canvas.locator("[data-wall-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Раскрыть меню" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  await canvas.locator("[data-wall-id]").click();
  await page.getByRole("button", { name: "Удалить стену" }).first().click();
  await expect(page.getByRole("dialog", { name: "Удалить стену" })).toBeVisible();
  await page.getByRole("dialog", { name: "Удалить стену" }).getByRole("button", { name: "Удалить стену" }).click();
  await expect(canvas.locator("[data-wall-id]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls.length)).toBe(0);
});

test("physical v6 pinch moves the view without creating a wall", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Масштаб");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await page.getByRole("button", { name: "Стена", exact: true }).click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.zoom);
  const touch = await touchSession(page);
  await touch.dispatch("touchStart", [{ id: 11, x: 145, y: 330 }, { id: 12, x: 225, y: 330 }]);
  await touch.dispatch("touchMove", [{ id: 11, x: 115, y: 345 }, { id: 12, x: 255, y: 345 }]);
  await touch.dispatch("touchEnd", []);
  await touch.close();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.zoom)).toBeGreaterThan(before);
  const cancelled = await touchSession(page);
  await cancelled.dispatch("touchStart", [{ id: 13, x: 170, y: 310 }]);
  await cancelled.dispatch("touchCancel", []);
  await cancelled.close();
  await expect(page.getByRole("button", { name: "Отменить начало стены" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls)).toHaveLength(0);
});

test("physical v6 wheel zoom stays anchored under the cursor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByRole("textbox", { name: "Название проекта" }).fill("Колесо");
  await page.getByRole("button", { name: "Создать проект" }).click();
  const canvas = page.locator("[data-physical-canvas]");
  const box = (await canvas.boundingBox())!;
  const client = { x: box.x + box.width * .7, y: box.y + box.height * .4 };
  const world = await canvas.evaluate((svg, client) => {
    const point = new DOMPoint(client.x, client.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!.inverse());
    return { x: point.x, y: point.y };
  }, client);
  await page.mouse.move(client.x, client.y);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.zoom)).toBeGreaterThan(1);
  const after = await canvas.evaluate((svg, world) => {
    const point = new DOMPoint(world.x, world.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, world);
  expect(after.x).toBeCloseTo(client.x, 0);
  expect(after.y).toBeCloseTo(client.y, 0);
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.zoom)).toBe(8);
  await page.mouse.wheel(0, 100000);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].viewport.zoom)).toBe(0.2);
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("plitka-projects-v6")!).projects[0].plan.draft.walls)).toEqual([]);
});

test("physical v6 diagonal wall ruler offers a precise perpendicular target", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 },
    hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const document = v6PhysicalDocument() as unknown as ProjectDocumentV6;
    document.plan.draft = v6DiagonalWallGraph();
    document.plan.pendingEdit = null;
    document.plan.restorePoint = null;
    document.rooms = [];
    document.selectedRoomId = null;
    document.viewport = { centerX: 2500, centerY: 500, zoom: 14, gridStepMm: 100 };
    await page.goto("/");
    await page.evaluate(doc => localStorage.setItem("plitka-projects-v6",
      JSON.stringify({ schemaVersion: 6, projects: [doc] })), document);
    await page.goto("/#project/physical-v6-fixture");
    await page.getByRole("button", { name: "Раскрыть меню" }).click();
    await page.getByRole("button", { name: "Стена", exact: true }).click();
    const canvas = page.locator("[data-physical-canvas]");
    const start = await canvas.evaluate(svg => {
      const point = new DOMPoint(2500, -500).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    await page.touchscreen.tap(start.x, start.y);
    const anchor = await page.locator("[data-wall-start]").evaluate(node => ({
      x: Number(node.getAttribute("cx")), y: -Number(node.getAttribute("cy")),
    }));
    const guides = await page.locator("[data-guide-target]").evaluateAll(nodes => nodes.map(node => {
      const circle = node.querySelector("circle")!;
      return { x: Number(circle.getAttribute("cx")), y: -Number(circle.getAttribute("cy")) };
    }));
    const perpendicular = guides.find(point => point.x > anchor.x && point.y < anchor.y);
    expect(perpendicular).toBeTruthy();
    const dx = perpendicular!.x - anchor.x, dy = perpendicular!.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    expect(distance).toBeGreaterThanOrEqual(99.9);
    expect(Math.min(distance % 100, 100 - distance % 100)).toBeLessThanOrEqual(.1);
    expect(Math.abs(dx + dy)).toBeLessThanOrEqual(.1);
    await expect(canvas.getByText("100,0 мм · 90,0°").first()).toBeVisible();
  } finally { await context.close(); }
});

for (const width of [320, 430]) test(`physical v6 controls fit a ${width}px phone`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 740 },
    hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Новый проект" }).click();
    await page.getByRole("textbox", { name: "Название проекта" }).fill("Телефон");
    await page.getByRole("button", { name: "Создать проект" }).click();
    const modes = page.getByRole("group", { name: "Режим проекта" });
    await expect(modes).toBeVisible();
    const bounds = (await modes.boundingBox())!;
    const sidebarToggleBounds = (await page.getByRole("button", { name: "Раскрыть меню" }).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.x).toBeGreaterThanOrEqual(sidebarToggleBounds.x + sidebarToggleBounds.width + 4);
    await expect(modes.getByRole("button", { name: "План" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "План" }).click();
    await page.getByRole("button", { name: "Раскрыть меню" }).click();
    const sidebar = page.getByRole("complementary", { name: "Управление планом" });
    await expect(sidebar.getByRole("button", { name: "План", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Раскладка", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Стена", exact: true }).click();
    await expect(page.getByRole("button", { name: "Раскрыть меню" })).toBeVisible();
    const thicknessField = page.getByRole("spinbutton", { name: "Толщина, мм" });
    await expect(thicknessField).toBeVisible();
    await thicknessField.focus();
    await expect(thicknessField).toBeFocused();
    await expect(page.getByRole("radio", { name: "Справа" })).toHaveCount(0);
    await page.getByRole("button", { name: "Раскрыть меню" }).click();
    const sidebarBounds = (await page.getByRole("complementary", { name: "Управление планом" }).boundingBox())!;
    const panelBounds = (await page.getByRole("heading", { name: "Новая стена" }).locator("xpath=..").boundingBox())!;
    expect(sidebarBounds.x + sidebarBounds.width).toBeLessThanOrEqual(panelBounds.x);
    await expect(page.getByRole("button", { name: "Далее" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await context.close(); }
});
