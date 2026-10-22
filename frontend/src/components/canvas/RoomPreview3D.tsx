import { RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import textureUrl from "../../assets/tile-texture.svg";
import type { Layout, Point } from "../../types";
import type { PhysicalPolygonV5 } from "../../domain/plan/types";

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
};

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

const roomCountText = (count: number) => {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14 ? "помещений"
    : mod10 === 1 ? "помещение" : mod10 >= 2 && mod10 <= 4 ? "помещения" : "помещений";
  return `${count} ${noun}`;
};

export default function RoomPreview3D({ rooms, title, tileSize, through }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = host.current;
    const visibleRooms = rooms.filter(room => room.polygon.outline.length >= 3);
    if (!container || !visibleRooms.length) return;

    const points = visibleRooms.flatMap(room => room.polygon.outline);
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
    const span = Math.max(width, depth, 2);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeff1ee);
    const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 100);
    const initialCamera = new THREE.Vector3(span * 0.72, span * 0.82, span * 0.92);
    camera.position.copy(initialCamera);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      through
        ? `Интерактивная 3D-модель сквозной раскладки. В сцене ${roomCountText(visibleRooms.length)} с общей сеткой плитки.`
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
    controls.target.set(0, 0.35, 0);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const groutMaterial = new THREE.MeshStandardMaterial({
      color: 0xd7d8d4,
      roughness: 0.92,
    });
    materials.push(groutMaterial);
    visibleRooms.forEach(room => {
      const roomShape = ringShape(
        [room.polygon.outline as Point[], ...(room.polygon.holes as Point[][])],
        cx,
        cy,
      );
      const floorGeometry = new THREE.ShapeGeometry(roomShape);
      geometries.push(floorGeometry);
      const floor = new THREE.Mesh(floorGeometry, groutMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
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
    const texture = new THREE.TextureLoader().load(textureUrl, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tileMaterial.map = loaded;
      tileMaterial.color.set(0xb3b6b2);
      tileMaterial.needsUpdate = true;
    });

    visibleRooms.forEach(room => {
      room.layout?.parts.forEach((part) => {
        if (!part.rings[0]?.length) return;
        const geometry = new THREE.ShapeGeometry(ringShape(part.rings, cx, cy));
        normalizeUvs(geometry);
        geometries.push(geometry);
        const tile = new THREE.Mesh(geometry, tileMaterial);
        tile.rotation.x = -Math.PI / 2;
        tile.position.y = 0.018;
        tile.receiveShadow = true;
        scene.add(tile);
        part.rings.forEach((ring) => {
          const outlineGeometry = new THREE.BufferGeometry().setFromPoints(
            ring.map(([x, y]) => new THREE.Vector3(
              (x - cx) / 1000,
              0.024,
              -(y - cy) / 1000,
            )),
          );
          geometries.push(outlineGeometry);
          scene.add(new THREE.LineLoop(outlineGeometry, groutLineMaterial));
        });
      });
    });

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9e8e2,
      roughness: 0.95,
    });
    materials.push(wallMaterial);
    const wallHeight = Math.min(1.2, Math.max(0.65, span * 0.24));
    const wallSegments = new Map<string, { point: number[]; next: number[] }>();
    const pointKey = (point: number[]) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
    visibleRooms.forEach(room => {
      [room.polygon.outline, ...room.polygon.holes].forEach(ring => {
        ring.forEach((point, index) => {
          const next = ring[(index + 1) % ring.length];
          const keys = [pointKey(point), pointKey(next)].sort();
          wallSegments.set(keys.join("|"), { point, next });
        });
      });
    });
    const edgeTolerance = Math.max(5, span * 5);
    wallSegments.forEach(({ point, next }) => {
      const onNearRightEdge = point[0] >= maxX - edgeTolerance && next[0] >= maxX - edgeTolerance;
      const onNearFrontEdge = point[1] <= minY + edgeTolerance && next[1] <= minY + edgeTolerance;
      if (onNearRightEdge || onNearFrontEdge) return;
      const dx = (next[0] - point[0]) / 1000;
      const dz = -(next[1] - point[1]) / 1000;
      const midX = ((point[0] + next[0]) / 2 - cx) / 1000;
      const midZ = -((point[1] + next[1]) / 2 - cy) / 1000;
      const length = Math.hypot(dx, dz);
      if (length < 0.001) return;
      const geometry = new THREE.BoxGeometry(length, wallHeight, 0.09);
      geometries.push(geometry);
      const wall = new THREE.Mesh(geometry, wallMaterial);
      wall.position.set(
        midX,
        wallHeight / 2,
        midZ,
      );
      wall.rotation.y = Math.atan2(-dz, dx);
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
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

    resetView.current = () => {
      camera.position.copy(initialCamera);
      controls.target.set(0, 0.35, 0);
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
      controls.dispose();
      texture.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [rooms, through]);

  const readyLayouts = rooms.filter(room => room.layout).length;
  const details = readyLayouts === rooms.length && rooms.length
    ? `${through ? `${roomCountText(rooms.length)} · ` : ""}Плитка ${tileSize} × ${tileSize} мм`
    : readyLayouts
      ? `Загружаем раскладку: ${readyLayouts} из ${rooms.length}`
      : "Сначала рассчитайте раскладку";

  return (
    <figure className="room-preview-card">
      <div className="room-preview-canvas" ref={host} />
      <figcaption className="room-preview-caption">
        <div>
          <strong>{title}</strong>
          <span>{details}</span>
        </div>
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
      </figcaption>
      <p className="room-preview-help">Потяните, чтобы осмотреть · прокрутите для масштаба</p>
    </figure>
  );
}
