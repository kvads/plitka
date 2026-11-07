import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import textureUrl from "../../assets/tile-texture.svg";
import type { Layout, Point } from "../../types";
import type { PhysicalGraphV5, PhysicalPolygonV5 } from "../../domain/plan/types";

export type RoomPreview3DRoom = {
  id: string;
  name: string;
  polygon: PhysicalPolygonV5;
  layout: Layout | null;
};

type Props = {
  rooms: RoomPreview3DRoom[];
  title: string;
  tileSize: number;
  through: boolean;
  multiRoom: boolean;
  graph: PhysicalGraphV5;
  isolateShower?: boolean;
  onShowerDrainMove?: (x: number, y: number) => void;
};

const pointInRing = (point: Point, ring: Point[]) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

const signedArea = (ring: Point[]) => ring.reduce((sum, [x, y], index) => {
  const [nextX, nextY] = ring[(index + 1) % ring.length];
  return sum + x * nextY - nextX * y;
}, 0) / 2;

const pointInRegions = (point: Point, regions: Point[][][]) => regions.some((rings) =>
  Boolean(rings[0]?.length) && pointInRing(point, rings[0]) &&
  !rings.slice(1).some(hole => pointInRing(point, hole)));

const ringShape = (rings: Point[][], cx: number, cy: number) => {
  const path = (ring: Point[]) => {
    const result = new THREE.Path();
    ring.forEach(([x, y], index) => {
      const px = (x - cx) / 1000;
      const py = (y - cy) / 1000;
      if (index === 0) result.moveTo(px, py);
      else result.lineTo(px, py);
    });
    result.closePath();
    return result;
  };
  const shape = new THREE.Shape();
  const outer = rings[0] ?? [];
  outer.forEach(([x, y], index) => {
    const px = (x - cx) / 1000;
    const py = (y - cy) / 1000;
    if (index === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  shape.closePath();
  shape.holes = rings.slice(1).map(path);
  return shape;
};

const normalizeUvs = (geometry: THREE.BufferGeometry) => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!box || !uv) return;
  const width = Math.max(box.max.x - box.min.x, 0.001);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  for (let index = 0; index < position.count; index++) {
    uv.setXY(
      index,
      (position.getX(index) - box.min.x) / width,
      (position.getY(index) - box.min.y) / height,
    );
  }
  uv.needsUpdate = true;
};

const showerHeight = (layout: Layout | null, zoneId: string | null | undefined,
  x: number, y: number) => {
  const shower = layout?.shower;
  const zone = shower?.zones.find(candidate => candidate.id === zoneId);
  if (!shower || !zone) return 0;
  const rotation = (shower.object?.rotationDeg ?? 0) * Math.PI / 180;
  if (rotation) {
    const dx = x - shower.drain.x, dy = y - shower.drain.y;
    x = shower.drain.x + dx * Math.cos(rotation) + dy * Math.sin(rotation);
    y = shower.drain.y - dx * Math.sin(rotation) + dy * Math.cos(rotation);
  }
  const slope = zone.slopePercent / 100;
  return zone.axis === "east" || zone.axis === "west"
    ? Math.abs(x - shower.drain.x) * slope
    : Math.abs(y - shower.drain.y) * slope;
};

const elevate = (geometry: THREE.BufferGeometry, layout: Layout | null,
  zoneId: string | null | undefined, cx: number, cy: number, liftMm = 0) => {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index) * 1000 + cx;
    const y = position.getY(index) * 1000 + cy;
    position.setZ(index, (showerHeight(layout, zoneId, x, y) + liftMm) / 1000);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
};

const roomCountText = (count: number) => {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14 ? "помещений"
    : mod10 === 1 ? "помещение" : mod10 >= 2 && mod10 <= 4 ? "помещения" : "помещений";
  return `${count} ${noun}`;
};

export default function RoomPreview3D({ rooms, title, tileSize, through, multiRoom, graph,
  isolateShower = false, onShowerDrainMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => undefined);
  const drainMove = useRef(onShowerDrainMove);
  const [showWalls, setShowWalls] = useState(() => !multiRoom && !isolateShower);

  useEffect(() => setShowWalls(!multiRoom && !isolateShower), [multiRoom, isolateShower]);
  useEffect(() => { drainMove.current = onShowerDrainMove; }, [onShowerDrainMove]);

  useEffect(() => {
    const container = host.current;
    const visibleRooms = rooms.filter(room => room.polygon.outline.length >= 3);
    if (!container || !visibleRooms.length) return;

    const showerPoints = visibleRooms.flatMap(room =>
      room.layout?.shower?.object?.footprint.flatMap(ring => ring) ??
      room.layout?.shower?.zones.flatMap(zone => zone.rings.flatMap(ring => ring)) ?? []);
    const points = isolateShower && showerPoints.length
      ? showerPoints : visibleRooms.flatMap(room => room.polygon.outline);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = (maxX - minX) / 1000;
    const depth = (maxY - minY) / 1000;
    const span = Math.max(width, depth, isolateShower ? .6 : 2);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeff1ee);
    const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 100);
    const initialCamera = isolateShower
      ? new THREE.Vector3(span * 0.95, span * 1.05, span * 1.35)
      : new THREE.Vector3(span * 0.72, span * 0.82, span * 0.92);
    camera.position.copy(initialCamera);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.domElement.setAttribute("role", "img");
    const hasShower = visibleRooms.some(room => room.layout?.shower);
    renderer.domElement.setAttribute(
      "aria-label",
      isolateShower
        ? "Интерактивная 3D-модель с душевым поддоном как отдельным объектом, уклонными плоскостями, бортами и сливом."
        : through
        ? `Интерактивная 3D-модель сквозной раскладки. В сцене ${roomCountText(visibleRooms.length)} с общей сеткой плитки.`
        : hasShower
          ? `Интерактивная 3D-модель помещения с душевым поддоном, уклонными плоскостями и сливом.`
        : multiRoom
          ? `Интерактивная 3D-модель всех помещений. В сцене ${roomCountText(visibleRooms.length)}.`
          : `Интерактивная 3D-модель помещения «${visibleRooms[0].name}» с серой плиткой на полу.`,
    );
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = span * 0.8;
    controls.maxDistance = span * 3.2;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.target.set(0, isolateShower ? 0.08 : 0.35, 0);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const labelTextures: THREE.Texture[] = [];
    let draggableDrain: { mesh: THREE.Mesh; regions: Point[][][]; height: number;
      frameOffsets: Point[] } | null = null;
    let wallIndicatorMaterial: THREE.MeshStandardMaterial | null = null;
    const groutMaterial = new THREE.MeshStandardMaterial({
      color: 0xd7d8d4,
      roughness: 0.92,
    });
    materials.push(groutMaterial);
    visibleRooms.forEach(room => {
      if (!isolateShower) {
        const roomFloorGeometry = new THREE.ShapeGeometry(ringShape([room.polygon.outline as Point[],
          ...(room.polygon.holes as Point[][])], cx, cy));
        geometries.push(roomFloorGeometry);
        const roomFloor = new THREE.Mesh(roomFloorGeometry, groutMaterial);
        roomFloor.rotation.x = -Math.PI / 2;
        roomFloor.receiveShadow = true;
        scene.add(roomFloor);
      }
      const surfaces = room.layout?.shower?.zones.map(zone => ({ id: zone.id, rings: zone.rings })) ?? [];
      surfaces.forEach(surface => {
        const floorGeometry = new THREE.ShapeGeometry(ringShape(surface.rings, cx, cy));
        elevate(floorGeometry, room.layout, surface.id, cx, cy,
          (room.layout?.shower?.object?.baseHeightMm ?? 0) -
          (room.layout?.shower?.object?.recessDepthMm ?? 0));
        geometries.push(floorGeometry);
        const floor = new THREE.Mesh(floorGeometry, groutMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);
      });
    });

    const tileMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f938f,
      roughness: 0.7,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    materials.push(tileMaterial);
    const groutLineMaterial = new THREE.LineBasicMaterial({
      color: 0x3f443f,
      transparent: true,
      opacity: 0.9,
    });
    materials.push(groutLineMaterial);
    const drainMaterial = new THREE.MeshStandardMaterial({ color: 0x46534c, roughness: 0.45,
      metalness: 0.35 });
    materials.push(drainMaterial);
    const texture = new THREE.TextureLoader().load(textureUrl, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tileMaterial.map = loaded;
      tileMaterial.color.set(0xb3b6b2);
      tileMaterial.needsUpdate = true;
    });

    visibleRooms.forEach(room => {
      room.layout?.parts.filter(part => !isolateShower || part.surfaceId === "shower-top")
        .forEach((part) => {
        if (!part.rings[0]?.length) return;
        const geometry = new THREE.ShapeGeometry(ringShape(part.rings, cx, cy));
        const objectLift = part.surfaceId === "shower-top"
          ? (room.layout?.shower?.object?.baseHeightMm ?? 0) -
            (room.layout?.shower?.object?.recessDepthMm ?? 0) : 0;
        elevate(geometry, room.layout, part.zoneId, cx, cy, objectLift + 2);
        normalizeUvs(geometry);
        geometries.push(geometry);
        const tile = new THREE.Mesh(geometry, tileMaterial);
        tile.rotation.x = -Math.PI / 2;
        tile.receiveShadow = true;
        scene.add(tile);
        part.rings.forEach((ring) => {
          const outlineGeometry = new THREE.BufferGeometry().setFromPoints(
            ring.map(([x, y]) => new THREE.Vector3(
              (x - cx) / 1000,
              (showerHeight(room.layout, part.zoneId, x, y) + objectLift + 3) / 1000,
              -(y - cy) / 1000,
            )),
          );
          geometries.push(outlineGeometry);
          scene.add(new THREE.LineLoop(outlineGeometry, groutLineMaterial));
        });
      });
      const drain = room.layout?.shower?.drain;
      if (drain) {
        const objectLift = (room.layout?.shower?.object?.baseHeightMm ?? 0) -
          (room.layout?.shower?.object?.recessDepthMm ?? 0);
        const drainWidth = drain.orientation === "horizontal" ? drain.length : drain.width;
        const drainDepth = drain.orientation === "horizontal" ? drain.width : drain.length;
        const drainGeometry = new THREE.BoxGeometry(drainWidth / 1000, .016, drainDepth / 1000);
        geometries.push(drainGeometry);
        const drainMesh = new THREE.Mesh(drainGeometry, drainMaterial);
        drainMesh.name = `shower-drain-${room.id}`;
        drainMesh.userData.showerDrain = true;
        drainMesh.rotation.y = (drain.rotationDeg ?? 0) * Math.PI / 180;
        drainMesh.position.set((drain.x - cx) / 1000, (objectLift + 8) / 1000,
          -(drain.y - cy) / 1000);
        drainMesh.receiveShadow = true;
        scene.add(drainMesh);
        const floorRegions = room.layout?.shower?.object?.floorRegions;
        if (isolateShower && floorRegions?.length) {
          const radians = (drain.rotationDeg ?? 0) * Math.PI / 180;
          const cosine = Math.cos(radians), sine = Math.sin(radians);
          const halfX = drainWidth / 2, halfY = drainDepth / 2;
          const frameOffsets = ([-1, 1] as const).flatMap(xDirection =>
            ([-1, 1] as const).map(yDirection => {
              const x = xDirection * halfX, y = yDirection * halfY;
              return [x * cosine - y * sine, x * sine + y * cosine] as Point;
            }));
          draggableDrain = { mesh: drainMesh, regions: floorRegions,
            height: drainMesh.position.y, frameOffsets };
        }
      }
      room.layout?.shower?.zones.forEach(zone => zone.rings.forEach(ring => {
        const objectLift = (room.layout?.shower?.object?.baseHeightMm ?? 0) -
          (room.layout?.shower?.object?.recessDepthMm ?? 0);
        const breakGeometry = new THREE.BufferGeometry().setFromPoints(ring.map(([x, y]) =>
          new THREE.Vector3((x - cx) / 1000,
            (showerHeight(room.layout, zone.id, x, y) + objectLift + 4) / 1000,
            -(y - cy) / 1000)));
        geometries.push(breakGeometry);
        const line = new THREE.LineLoop(breakGeometry, groutLineMaterial);
        line.userData.showerBreak = zone.id;
        scene.add(line);
      }));
      room.layout?.shower?.object?.surfaces.forEach(surface => {
        const dx = surface.end[0] - surface.start[0];
        const dy = surface.end[1] - surface.start[1];
        const length = Math.hypot(dx, dy);
        if (length < .1 || surface.heightMm <= 0) return;
        const isCurb = surface.kind === "curb";
        const surfaceHeight = isCurb ? surface.outsideHeightMm ?? surface.heightMm : surface.heightMm;
        const height = surfaceHeight / 1000;
        const depth = Math.max(isCurb ? surface.widthMm / 1000 : .012, .012);
        const geometry = new THREE.BoxGeometry(length / 1000, height, depth);
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, tileMaterial);
        mesh.name = `shower-${surface.kind}-${surface.edgeId}`;
        mesh.userData.showerSurface = surface.kind;
        mesh.rotation.y = Math.atan2(dy, dx);
        let middleX = (surface.start[0] + surface.end[0]) / 2;
        let middleY = (surface.start[1] + surface.end[1]) / 2;
        if (isCurb) {
          const floorRing = room.layout?.shower?.object?.floorRegions[0]?.[0] ?? [];
          const direction = signedArea(floorRing) >= 0 ? 1 : -1;
          middleX += dy / length * surface.widthMm / 2 * direction;
          middleY += -dx / length * surface.widthMm / 2 * direction;
        }
        mesh.position.set((middleX - cx) / 1000,
          height / 2,
          -(middleY - cy) / 1000);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      });
      const showerObject = room.layout?.shower?.object;
      if (isolateShower && showerObject?.footprint[0]?.length) {
        const ring = showerObject.floorRegions[0]?.[0] ?? showerObject.footprint[0];
        const objectLift = showerObject.baseHeightMm - showerObject.recessDepthMm;
        const highestSurface = showerObject.surfaces.reduce((highest, surface) => {
          const top = surface.kind === "curb"
            ? surface.outsideHeightMm ?? surface.heightMm
            : surface.heightMm;
          return Math.max(highest, top);
        }, objectLift + (room.layout?.shower?.maxHeightMm ?? 0));
        showerObject.edges.forEach((edge, index) => {
          const start = ring[index], end = ring[(index + 1) % showerObject.edges.length];
          if (!start || !end) return;
          const labelCanvas = document.createElement("canvas");
          labelCanvas.width = 96; labelCanvas.height = 96;
          const context = labelCanvas.getContext("2d");
          if (!context) return;
          context.beginPath(); context.arc(48, 48, 34, 0, Math.PI * 2);
          context.fillStyle = edge.kind === "wall" ? "#eef0ee" : "#ffffff"; context.fill();
          context.lineWidth = 6; context.strokeStyle = edge.kind === "wall" ? "#626b66" : "#285f43";
          context.stroke();
          context.fillStyle = "#173c2e"; context.font = "700 42px sans-serif";
          context.textAlign = "center"; context.textBaseline = "middle";
          context.fillText(String(index + 1), 48, 50);
          const labelTexture = new THREE.CanvasTexture(labelCanvas);
          labelTexture.colorSpace = THREE.SRGBColorSpace;
          labelTextures.push(labelTexture);
          const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture,
            transparent: true, depthTest: false, depthWrite: false });
          materials.push(labelMaterial);
          const marker = new THREE.Sprite(labelMaterial);
          marker.name = `shower-side-label-${index + 1}`;
          marker.userData.showerEdgeId = edge.id;
          marker.renderOrder = 100;
          marker.position.set(((start[0] + end[0]) / 2 - cx) / 1000,
            (highestSurface + 55) / 1000,
            -((start[1] + end[1]) / 2 - cy) / 1000);
          const markerSize = Math.min(.12, Math.max(.075, span * .11));
          marker.scale.set(markerSize, markerSize, 1);
          scene.add(marker);
        });
        renderer.domElement.dataset.showerSideLabels = String(showerObject.edges.length);
        const signedArea = ring.slice(0, showerObject.edges.length).reduce((sum, point, index) => {
          const next = ring[(index + 1) % showerObject.edges.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0);
        let wallIndicators = 0;
        showerObject.edges.forEach((edge, index) => {
          if (edge.kind !== "wall") return;
          const start = ring[index], end = ring[(index + 1) % showerObject.edges.length];
          if (!start || !end) return;
          const dx = end[0] - start[0], dy = end[1] - start[1];
          const length = Math.hypot(dx, dy);
          if (length < .1) return;
          if (!wallIndicatorMaterial) {
            wallIndicatorMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ceca,
              transparent: true, opacity: .62, roughness: .95, side: THREE.DoubleSide });
            materials.push(wallIndicatorMaterial);
          }
          const wallHeight = Math.max(.24, span * .3);
          const wallGeometry = new THREE.BoxGeometry(length / 1000, wallHeight, .016);
          geometries.push(wallGeometry);
          const wall = new THREE.Mesh(wallGeometry, wallIndicatorMaterial);
          const outward = signedArea >= 0
            ? { x: dy / length, y: -dx / length }
            : { x: -dy / length, y: dx / length };
          wall.position.set(((start[0] + end[0]) / 2 + outward.x * 12 - cx) / 1000,
            wallHeight / 2,
            -((start[1] + end[1]) / 2 + outward.y * 12 - cy) / 1000);
          wall.rotation.y = Math.atan2(dy, dx);
          wall.name = `shower-wall-indicator-${index + 1}`;
          wall.userData.showerEdgeId = edge.id;
          scene.add(wall);
          wallIndicators += 1;
        });
        renderer.domElement.dataset.showerWallIndicators = String(wallIndicators);
      }
    });

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9e8e2,
      roughness: 0.95,
    });
    materials.push(wallMaterial);
    const wallHeight = Math.min(1.2, Math.max(0.65, span * 0.24));
    const edgeTolerance = Math.max(5, span * 5);
    if (showWalls && !isolateShower) graph.walls.forEach(sourceWall => {
      const [start, end] = sourceWall.drawnEdge;
      const dx = end.x - start.x, dy = end.y - start.y;
      const sourceLength = Math.hypot(dx, dy);
      if (sourceLength < 0.1) return;
      const ux = dx / sourceLength, uy = dy / sourceLength;
      const sign = sourceWall.side === "left" ? 1 : -1;
      const nx = -uy * sign, ny = ux * sign;
      const wallCenterX = (start.x + end.x) / 2 + nx * sourceWall.thicknessMm / 2;
      const wallCenterY = (start.y + end.y) / 2 + ny * sourceWall.thicknessMm / 2;
      if (wallCenterX >= maxX - edgeTolerance || wallCenterY <= minY + edgeTolerance) return;

      const openings = (graph.openings ?? [])
        .filter(opening => opening.wallId === sourceWall.id)
        .map(opening => ({ start: opening.offsetMm - opening.widthMm / 2,
          end: opening.offsetMm + opening.widthMm / 2 }))
        .sort((a, b) => a.start - b.start);
      const segments: { start: number; end: number }[] = [];
      let cursor = 0;
      openings.forEach(opening => {
        if (opening.start > cursor) segments.push({ start: cursor, end: opening.start });
        cursor = Math.max(cursor, opening.end);
      });
      if (cursor < sourceLength) segments.push({ start: cursor, end: sourceLength });

      segments.forEach(segment => {
        const segmentLength = segment.end - segment.start;
        if (segmentLength < 0.1) return;
        const along = (segment.start + segment.end) / 2;
        const geometry = new THREE.BoxGeometry(
          segmentLength / 1000,
          wallHeight,
          sourceWall.thicknessMm / 1000,
        );
        geometries.push(geometry);
        const wall = new THREE.Mesh(geometry, wallMaterial);
        wall.position.set(
          (start.x + ux * along + nx * sourceWall.thicknessMm / 2 - cx) / 1000,
          wallHeight / 2,
          -(start.y + uy * along + ny * sourceWall.thicknessMm / 2 - cy) / 1000,
        );
        wall.rotation.y = Math.atan2(uy, ux);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
      });
    });

    scene.add(new THREE.HemisphereLight(0xffffff, 0xa1aaa4, 1.5));
    const keyLight = new THREE.DirectionalLight(0xfff8ed, 3.1);
    keyLight.position.set(-span, span * 1.8, span * 1.3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -span;
    keyLight.shadow.camera.right = span;
    keyLight.shadow.camera.top = span;
    keyLight.shadow.camera.bottom = -span;
    scene.add(keyLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
    let draggingDrain = false;
    const setPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const pointerDown = (event: PointerEvent) => {
      if (!draggableDrain) return;
      setPointer(event);
      if (!raycaster.intersectObject(draggableDrain.mesh, false).length) return;
      draggingDrain = true;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault(); event.stopPropagation();
    };
    const pointerMove = (event: PointerEvent) => {
      if (!draggableDrain) return;
      const activeDrain = draggableDrain;
      setPointer(event);
      if (!draggingDrain) {
        renderer.domElement.style.cursor = raycaster.intersectObject(activeDrain.mesh, false).length
          ? "grab" : "default";
        return;
      }
      dragPlane.constant = -activeDrain.height;
      const intersection = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, intersection)) return;
      const world: Point = [intersection.x * 1000 + cx, -intersection.z * 1000 + cy];
      if (![world, ...activeDrain.frameOffsets.map(([x, y]) =>
        [world[0] + x, world[1] + y] as Point)]
        .every(point => pointInRegions(point, activeDrain.regions))) return;
      activeDrain.mesh.position.x = intersection.x;
      activeDrain.mesh.position.z = intersection.z;
      event.preventDefault(); event.stopPropagation();
    };
    const pointerUp = (event: PointerEvent) => {
      if (!draggingDrain || !draggableDrain) return;
      draggingDrain = false;
      controls.enabled = true;
      renderer.domElement.style.cursor = "grab";
      if (renderer.domElement.hasPointerCapture(event.pointerId))
        renderer.domElement.releasePointerCapture(event.pointerId);
      drainMove.current?.(draggableDrain.mesh.position.x * 1000 + cx,
        -draggableDrain.mesh.position.z * 1000 + cy);
      event.preventDefault(); event.stopPropagation();
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown, true);
    renderer.domElement.addEventListener("pointermove", pointerMove, true);
    renderer.domElement.addEventListener("pointerup", pointerUp, true);
    renderer.domElement.addEventListener("pointercancel", pointerUp, true);

    resetView.current = () => {
      camera.position.copy(initialCamera);
      controls.target.set(0, isolateShower ? 0.08 : 0.35, 0);
      controls.update();
    };

    const resize = () => {
      const canvasWidth = container.clientWidth;
      const canvasHeight = container.clientHeight;
      if (!canvasWidth || !canvasHeight) return;
      camera.aspect = canvasWidth / canvasHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvasWidth, canvasHeight, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown, true);
      renderer.domElement.removeEventListener("pointermove", pointerMove, true);
      renderer.domElement.removeEventListener("pointerup", pointerUp, true);
      renderer.domElement.removeEventListener("pointercancel", pointerUp, true);
      controls.dispose();
      texture.dispose();
      labelTextures.forEach((labelTexture) => labelTexture.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [rooms, through, multiRoom, graph, showWalls, isolateShower]);

  const readyLayouts = rooms.filter(room => room.layout).length;
  const details = readyLayouts === rooms.length && rooms.length
      ? isolateShower
        ? "Отдельный объект поддона"
        : through
      ? `${roomCountText(rooms.length)} · Плитка ${tileSize} × ${tileSize} мм`
      : multiRoom
        ? `${roomCountText(rooms.length)} · раскладки рассчитаны`
        : `Плитка ${tileSize} × ${tileSize} мм`
    : readyLayouts
      ? `Рассчитано раскладок: ${readyLayouts} из ${rooms.length}`
      : multiRoom ? "Рассчитайте раскладку хотя бы одного помещения" : "Сначала рассчитайте раскладку";

  return (
    <figure className="room-preview-card">
      <div className="room-preview-canvas" ref={host} />
      <figcaption className="room-preview-caption">
        <div>
          <strong>{title}</strong>
          <span>{details}</span>
        </div>
        <div className="room-preview-actions">
          {!isolateShower && <button type="button" className="room-preview-walls" aria-pressed={showWalls}
            onClick={() => setShowWalls(value => !value)}>
            {showWalls ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            {showWalls ? "Скрыть стены" : "Показать стены"}
          </button>}
          <button
            type="button"
            className="room-preview-reset"
            onClick={() => resetView.current()}
            aria-label="Вернуть исходный вид 3D-сцены"
            title="Вернуть исходный вид"
          >
            <RotateCcw size={17} aria-hidden="true" />
            Исходный вид
          </button>
        </div>
      </figcaption>
      <p className="room-preview-help">{isolateShower
        ? "Перетащите слив для перемещения · потяните фон, чтобы осмотреть"
        : "Потяните, чтобы осмотреть · прокрутите для масштаба"}</p>
    </figure>
  );
}
