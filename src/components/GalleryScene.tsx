import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  AppMode,
  BuilderPlacementTarget,
  EditorSettings,
  EditorTransformTool,
  EditorViewMode,
  GalleryCustomWall,
  GalleryDoor,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
  GalleryRoomDimensions,
  GalleryWall,
  GalleryWallTarget,
} from "../types";

interface GallerySceneProps {
  images: GalleryImage[];
  layouts: GalleryLayouts;
  roomConfig: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
  mode: AppMode;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  editorSettings: EditorSettings;
  isGrabActive: boolean;
  pendingPlacementImageId: string | null;
  selectedImageId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  selectedRoomIndex: number;
  onSelectImage: (id: string) => void;
  onSelectWall: (id: string) => void;
  onSelectDoor: (id: string) => void;
  onSelectRoom: (roomIndex: number) => void;
  onUpdateRoom: (roomIndex: number, patch: Partial<GalleryRoomDimensions>) => void;
  onUpdateImageLayout: (id: string, patch: Partial<GalleryFrameLayout>) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onUpdateDoor: (id: string, patch: Partial<GalleryDoor>) => void;
  onToggleDoor: (id: string) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
  onAimTargetChange: (label: string | null) => void;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}

type EditableHitTarget =
  | { kind: "artwork"; id: string; label: string }
  | { kind: "customWall"; id: string; wall: GalleryWallTarget; label: string }
  | { kind: "door"; id: string; label: string }
  | { kind: "builtWall"; wall: GalleryWallTarget; roomIndex: number; label: string };

type EditableHit = {
  target: EditableHitTarget;
  object: THREE.Object3D;
  point: THREE.Vector3;
};

type WallOpening = {
  id: string;
  offset: number;
  width: number;
  height: number;
};

type DoorPassage = {
  door: GalleryDoor;
  sourceRoomIndex: number;
  targetRoomIndex: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  width: number;
};

const fallbackRoom: GalleryRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
  roomCount: 1,
  rooms: [{ width: 18, depth: 22, height: 5.2 }],
};

const roomGap = 0.18;
const eyeHeight = 1.75;
const wallInset = 0.18;
const customWallDepth = 0.18;
const wallSurfaceOffset = customWallDepth / 2 + 0.002;
const artworkFrameDepth = 0.018;
const wallOrder: GalleryWall[] = ["north", "west", "east", "south"];

function getRoomDimensions(room: GalleryRoomConfig, roomIndex: number) {
  return room.rooms?.[roomIndex] ?? {
    width: room.width,
    depth: room.depth,
    height: room.height,
  };
}

function linearRoomOffset(room: GalleryRoomConfig, roomIndex: number) {
  let offset = 0;

  for (let index = 0; index < roomIndex; index += 1) {
    const current = getRoomDimensions(room, index);
    const next = getRoomDimensions(room, index + 1);
    offset += current.width / 2 + next.width / 2 + roomGap;
  }

  return offset;
}

function getRoomCenter(room: GalleryRoomConfig, roomIndex: number) {
  const dimensions = getRoomDimensions(room, roomIndex);

  return {
    x: Number.isFinite(dimensions.x) ? dimensions.x ?? 0 : linearRoomOffset(room, roomIndex),
    z: Number.isFinite(dimensions.z) ? dimensions.z ?? 0 : 0,
  };
}

function roomOffset(room: GalleryRoomConfig, roomIndex: number) {
  return getRoomCenter(room, roomIndex).x;
}

function builtWallTarget(roomIndex: number, wall: GalleryWall): GalleryWallTarget {
  return roomIndex === 0 ? wall : `room-${roomIndex}:${wall}`;
}

function parseBuiltWallTarget(target: GalleryWallTarget) {
  if (target === "north" || target === "south" || target === "west" || target === "east") {
    return { roomIndex: 0, wall: target as GalleryWall };
  }

  const match = String(target).match(/^room-(\d+):(north|south|west|east)$/);
  if (!match) {
    return null;
  }

  return { roomIndex: Number(match[1]), wall: match[2] as GalleryWall };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0) {
  const dimensions = getRoomDimensions(room, roomIndex);
  return wall === "north" || wall === "south" ? dimensions.width : dimensions.depth;
}

function getWallMount(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0, inset = wallInset) {
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const mounts = {
    north: { position: [center.x, 0, center.z - dimensions.depth / 2 + inset], rotation: [0, 0, 0] },
    south: { position: [center.x, 0, center.z + dimensions.depth / 2 - inset], rotation: [0, Math.PI, 0] },
    west: { position: [center.x - dimensions.width / 2 + inset, 0, center.z], rotation: [0, Math.PI / 2, 0] },
    east: { position: [center.x + dimensions.width / 2 - inset, 0, center.z], rotation: [0, -Math.PI / 2, 0] },
  } satisfies Record<
    GalleryWall,
    {
      position: [number, number, number];
      rotation: [number, number, number];
    }
  >;

  return mounts[wall];
}

function getCustomWallMount(room: GalleryRoomConfig, wall: GalleryCustomWall) {
  const center = getRoomCenter(room, wall.roomIndex);

  return {
    position: [center.x + wall.x, 0, center.z + wall.z] as [number, number, number],
    rotation: [0, wall.rotation, 0] as [number, number, number],
  };
}

function customWallBackTarget(id: string) {
  return `${id}:back`;
}

function parseCustomWallTarget(target: GalleryWallTarget, customWalls: GalleryCustomWall[]) {
  const exact = customWalls.find((wall) => wall.id === target);

  if (exact) {
    return { wall: exact, side: 1 };
  }

  if (String(target).endsWith(":back")) {
    const id = String(target).slice(0, -5);
    const wall = customWalls.find((item) => item.id === id);

    if (wall) {
      return { wall, side: -1 };
    }
  }

  return null;
}

function getCustomWallFaceMount(room: GalleryRoomConfig, wall: GalleryCustomWall, side = 1) {
  const mount = getCustomWallMount(room, wall);
  const rotationY = wall.rotation + (side < 0 ? Math.PI : 0);
  const normal = new THREE.Vector3(0, 0, side).applyEuler(
    new THREE.Euler(0, wall.rotation, 0, "XYZ"),
  );
  const position = new THREE.Vector3(...mount.position).addScaledVector(normal, wallSurfaceOffset);

  return {
    position: [position.x, position.y, position.z] as [number, number, number],
    rotation: [0, rotationY, 0] as [number, number, number],
  };
}

function getWallBasis(
  room: GalleryRoomConfig,
  wall: GalleryWallTarget,
  customWalls: GalleryCustomWall[],
  inset = wallInset,
) {
  const built = parseBuiltWallTarget(wall);

  if (built) {
    const mount = getWallMount(room, built.wall, built.roomIndex, inset);
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(
      new THREE.Euler(...mount.rotation, "XYZ"),
    );
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));

    return {
      target: wall,
      position: new THREE.Vector3(...mount.position),
      normal,
      axis,
      height: getRoomDimensions(room, built.roomIndex).height,
      length: getWallLength(room, built.wall, built.roomIndex),
    };
  }

  const customTarget = parseCustomWallTarget(wall, customWalls);
  if (!customTarget) {
    return null;
  }

  const mount = getCustomWallFaceMount(room, customTarget.wall, customTarget.side);
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));
  const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));

  return {
    target: wall,
    position: new THREE.Vector3(...mount.position),
    normal,
    axis,
    height: customTarget.wall.height,
    length: customTarget.wall.length,
  };
}

function getAllWallTargets(room: GalleryRoomConfig, customWalls: GalleryCustomWall[]) {
  const builtTargets = Array.from({ length: room.roomCount }, (_, roomIndex) =>
    wallOrder.map((wall) => builtWallTarget(roomIndex, wall)),
  ).flat();

  return [
    ...builtTargets,
    ...customWalls.flatMap((wall) => [wall.id, customWallBackTarget(wall.id)]),
  ];
}

function getDoorWorldPosition(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  door: GalleryDoor,
) {
  const basis = getWallBasis(room, door.wall, customWalls, 0);

  if (!basis) {
    return null;
  }

  return basis.position
    .clone()
    .addScaledVector(basis.axis, door.offset)
    .addScaledVector(basis.normal, 0.06);
}

function getRoomBoundaryEntryPoint(
  room: GalleryRoomConfig,
  roomIndex: number,
  fromPoint: THREE.Vector3,
  inset = 1.3,
) {
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const direction = new THREE.Vector3(fromPoint.x - center.x, 0, fromPoint.z - center.z);

  if (direction.lengthSq() < 0.0001) {
    direction.set(0, 0, 1);
  }

  direction.normalize();

  const halfWidth = dimensions.width / 2;
  const halfDepth = dimensions.depth / 2;
  const tx = Math.abs(direction.x) > 0.0001 ? halfWidth / Math.abs(direction.x) : Number.POSITIVE_INFINITY;
  const tz = Math.abs(direction.z) > 0.0001 ? halfDepth / Math.abs(direction.z) : Number.POSITIVE_INFINITY;
  const distance = Math.min(tx, tz);
  const boundary = new THREE.Vector3(center.x, 0, center.z).addScaledVector(direction, distance);
  const inside = boundary.clone().addScaledVector(direction, -inset);

  inside.x = clamp(inside.x, center.x - halfWidth + 1.15, center.x + halfWidth - 1.15);
  inside.z = clamp(inside.z, center.z - halfDepth + 1.15, center.z + halfDepth - 1.15);

  return { boundary, inside };
}

function getRoomWalkBounds(room: GalleryRoomConfig, roomIndex: number, margin = 0.52) {
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);

  return {
    roomIndex,
    minX: center.x - dimensions.width / 2 + margin,
    maxX: center.x + dimensions.width / 2 - margin,
    minZ: center.z - dimensions.depth / 2 + margin,
    maxZ: center.z + dimensions.depth / 2 - margin,
  };
}

function pointInRoomWalkBounds(
  room: GalleryRoomConfig,
  roomIndex: number,
  point: THREE.Vector3,
  margin = 0.52,
) {
  const bounds = getRoomWalkBounds(room, roomIndex, margin);

  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function closestPointInRoomWalkBounds(
  room: GalleryRoomConfig,
  roomIndex: number,
  point: THREE.Vector3,
  margin = 0.52,
) {
  const bounds = getRoomWalkBounds(room, roomIndex, margin);

  return new THREE.Vector3(
    clamp(point.x, bounds.minX, bounds.maxX),
    point.y,
    clamp(point.z, bounds.minZ, bounds.maxZ),
  );
}

function getDoorInnerPoint(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  door: GalleryDoor,
  inset = 1.15,
) {
  const basis = getWallBasis(room, door.wall, customWalls, 0);

  if (!basis) {
    return null;
  }

  return basis.position
    .clone()
    .addScaledVector(basis.axis, door.offset)
    .addScaledVector(basis.normal, inset);
}

function getDoorPassage(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  door: GalleryDoor,
): DoorPassage | null {
  if (!door.isOpen || door.connectsToRoomIndex === null || door.connectsToRoomIndex === undefined) {
    return null;
  }

  const doorPoint = getDoorWorldPosition(room, customWalls, door);
  const sourceEntry = getDoorInnerPoint(room, customWalls, door, 0.72);

  if (!doorPoint || !sourceEntry) {
    return null;
  }

  const targetEntry = getRoomBoundaryEntryPoint(room, door.connectsToRoomIndex, doorPoint, 0.72);

  return {
    door,
    sourceRoomIndex: door.roomIndex,
    targetRoomIndex: door.connectsToRoomIndex,
    start: sourceEntry,
    end: targetEntry.inside,
    width: Math.max(1.35, door.width * 0.92),
  };
}

function closestPointInPassage(passage: DoorPassage, point: THREE.Vector3) {
  const segment = passage.end.clone().sub(passage.start);
  const lengthSq = segment.lengthSq();

  if (lengthSq < 0.0001) {
    return passage.start.clone();
  }

  const relative = point.clone().sub(passage.start);
  const t = clamp(relative.dot(segment) / lengthSq, 0, 1);
  const center = passage.start.clone().addScaledVector(segment, t);
  const axis = segment.normalize();
  const side = new THREE.Vector3(-axis.z, 0, axis.x);
  const lateral = clamp(relative.dot(side), -passage.width / 2, passage.width / 2);

  return center.addScaledVector(side, lateral);
}

function pointInPassage(passage: DoorPassage, point: THREE.Vector3) {
  const closest = closestPointInPassage(passage, point);

  return Math.hypot(point.x - closest.x, point.z - closest.z) < 0.08;
}

function pointInOpenCustomWallDoor(
  wall: GalleryCustomWall,
  doors: GalleryDoor[],
  localX: number,
) {
  const matchingTargets = new Set([wall.id, customWallBackTarget(wall.id)]);

  return doors.some(
    (door) =>
      door.isOpen &&
      matchingTargets.has(door.wall) &&
      Math.abs(localX - door.offset) <= door.width / 2 + 0.42 &&
      door.height >= 1.45,
  );
}

function resolveCustomWallCollision(
  position: THREE.Vector3,
  previousPosition: THREE.Vector3,
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  doors: GalleryDoor[],
) {
  const playerRadius = 0.46;
  const halfDepth = customWallDepth / 2 + playerRadius;

  customWalls.forEach((wall) => {
    const mount = getCustomWallMount(room, wall);
    const center = new THREE.Vector3(...mount.position);
    const euler = new THREE.Euler(0, wall.rotation, 0, "XYZ");
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(euler);
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(euler);
    const relative = position.clone().sub(center);
    const previousRelative = previousPosition.clone().sub(center);
    const localX = relative.dot(axis);
    const localZ = relative.dot(normal);
    const previousLocalZ = previousRelative.dot(normal);
    const crossedWall =
      previousLocalZ * localZ <= 0 && Math.abs(previousLocalZ - localZ) > 0.0001;

    if (
      Math.abs(localX) > wall.length / 2 + playerRadius ||
      (!crossedWall && Math.abs(localZ) > halfDepth) ||
      pointInOpenCustomWallDoor(wall, doors, localX)
    ) {
      return;
    }

    const side = Math.abs(previousLocalZ) > halfDepth ? Math.sign(previousLocalZ) : Math.sign(localZ || 1);
    const corrected = center
      .clone()
      .addScaledVector(axis, localX)
      .addScaledVector(normal, side * halfDepth);

    position.x = corrected.x;
    position.z = corrected.z;
  });
}

function getConnectedRoomWallTarget(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  door: GalleryDoor,
) {
  if (door.connectsToRoomIndex === null || door.connectsToRoomIndex === undefined) {
    return null;
  }

  const start = getDoorWorldPosition(room, customWalls, door);
  if (!start) {
    return null;
  }

  const roomIndex = door.connectsToRoomIndex;
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const targetEntry = getRoomBoundaryEntryPoint(room, roomIndex, start, 0.85);
  const boundary = targetEntry.boundary;
  const distances: Array<{ wall: GalleryWall; distance: number }> = [
    { wall: "north", distance: Math.abs(boundary.z - (center.z - dimensions.depth / 2)) },
    { wall: "south", distance: Math.abs(boundary.z - (center.z + dimensions.depth / 2)) },
    { wall: "west", distance: Math.abs(boundary.x - (center.x - dimensions.width / 2)) },
    { wall: "east", distance: Math.abs(boundary.x - (center.x + dimensions.width / 2)) },
  ];
  const wall = distances.sort((a, b) => a.distance - b.distance)[0].wall;
  const target = builtWallTarget(roomIndex, wall);
  const basis = getWallBasis(room, target, customWalls, 0);

  if (!basis) {
    return null;
  }

  return {
    wall: target,
    opening: {
      id: `${door.id}:target`,
      offset: boundary.clone().sub(basis.position).dot(basis.axis),
      width: door.width,
      height: door.height,
    } satisfies WallOpening,
  };
}

function getConnectedDoorPortal(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  door: GalleryDoor,
) {
  const target = getConnectedRoomWallTarget(room, customWalls, door);

  if (!target) {
    return null;
  }

  const built = parseBuiltWallTarget(target.wall);
  if (!built) {
    return null;
  }

  return {
    ...target,
    built,
  };
}

function getBuiltWallOpenings(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  doors: GalleryDoor[],
  roomIndex: number,
  wall: GalleryWall,
) {
  const target = builtWallTarget(roomIndex, wall);
  const openings: WallOpening[] = doors
    .filter((door) => door.wall === target)
    .map((door) => ({
      id: door.id,
      offset: door.offset,
      width: door.width,
      height: door.height,
    }));

  doors.forEach((door) => {
    if (door.roomIndex === roomIndex || door.connectsToRoomIndex !== roomIndex) {
      return;
    }

    const connectedTarget = getConnectedRoomWallTarget(room, customWalls, door);
    if (connectedTarget?.wall === target) {
      openings.push(connectedTarget.opening);
    }
  });

  return openings;
}

function getCustomWallOpenings(wall: GalleryCustomWall, doors: GalleryDoor[]) {
  const matchingTargets = new Set([wall.id, customWallBackTarget(wall.id)]);

  return doors
    .filter((door) => matchingTargets.has(door.wall))
    .map((door) => ({
      id: door.id,
      offset: door.offset,
      width: door.width,
      height: door.height,
    }));
}

function layoutOverlapsDoorOpening(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  doors: GalleryDoor[],
  layout: GalleryFrameLayout,
  frameWidth: number,
  frameHeight: number,
) {
  const built = parseBuiltWallTarget(layout.wall);
  const openings = built
    ? getBuiltWallOpenings(room, customWalls, doors, built.roomIndex, built.wall)
    : (() => {
        const customTarget = parseCustomWallTarget(layout.wall, customWalls);
        return customTarget
          ? getCustomWallOpenings(customTarget.wall, doors)
          : doors
              .filter((door) => door.wall === layout.wall)
              .map((door) => ({
                id: door.id,
                offset: door.offset,
                width: door.width,
                height: door.height,
              }));
      })();

  const frameLeft = layout.offset - frameWidth / 2;
  const frameRight = layout.offset + frameWidth / 2;
  const frameBottom = layout.height - frameHeight / 2;
  const frameTop = layout.height + frameHeight / 2;

  return openings.some((opening) => {
    const openingLeft = opening.offset - opening.width / 2 - 0.35;
    const openingRight = opening.offset + opening.width / 2 + 0.35;
    const openingBottom = 0;
    const openingTop = opening.height + 0.35;

    return (
      frameRight > openingLeft &&
      frameLeft < openingRight &&
      frameTop > openingBottom &&
      frameBottom < openingTop
    );
  });
}

function getRoomIndexAtWorldX(room: GalleryRoomConfig, worldX: number) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let roomIndex = 0; roomIndex < room.roomCount; roomIndex += 1) {
    const center = getRoomCenter(room, roomIndex);
    const distance = Math.abs(worldX - center.x);

    if (distance < bestDistance) {
      bestIndex = roomIndex;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

function getPlacementFromWorldPoint(
  room: GalleryRoomConfig,
  point: THREE.Vector3,
  wallHit?: Pick<BuilderPlacementTarget, "wall" | "wallOffset" | "wallHeight" | "label">,
): BuilderPlacementTarget {
  const roomIndex = getRoomIndexAtWorldX(room, point.x);
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);

  return {
    roomIndex,
    x: clamp(point.x - center.x, -dimensions.width / 2 + 1, dimensions.width / 2 - 1),
    z: clamp(point.z - center.z, -dimensions.depth / 2 + 1, dimensions.depth / 2 - 1),
    ...wallHit,
  };
}

function defaultWidthFor(image: GalleryImage) {
  const aspect = image.width / image.height || 1.42;
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
}

export function getDefaultLayout(
  image: GalleryImage,
  index: number,
  room: GalleryRoomConfig = fallbackRoom,
): GalleryFrameLayout {
  const roomIndex = Math.floor(index / 12) % room.roomCount;
  const wall = wallOrder[Math.floor(index / 3) % wallOrder.length];
  const slot = index % 3;
  const dimensions = getRoomDimensions(room, roomIndex);
  const wallLength = getWallLength(room, wall, roomIndex);
  const usableLength = Math.max(5, wallLength - 3.6);
  const spacing = Math.max(2.8, usableLength / 3);
  const limit = usableLength / 2;

  return {
    wall: builtWallTarget(roomIndex, wall),
    offset: clamp((slot - 1) * spacing, -limit, limit),
    height: clamp(dimensions.height * 0.48, 2.2, dimensions.height - 1.15),
    width: defaultWidthFor(image),
  };
}

function PlayerMovement({
  room,
  settings,
  doors,
  customWalls,
}: {
  room: GalleryRoomConfig;
  settings: EditorSettings;
  doors: GalleryDoor[];
  customWalls: GalleryCustomWall[];
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const verticalVelocity = useRef(0);
  const isGrounded = useRef(true);
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const currentRoomIndexRef = useRef(0);

  useEffect(() => {
    camera.position.set(0, eyeHeight, 7);

    const shouldIgnoreKeyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isPointerLocked = document.pointerLockElement === gl.domElement;

      return Boolean(target?.closest(".control-panel")) && !isPointerLocked;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboard(event)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
      }
      keys.current.add(event.code);

      if (event.code === "Space" && isGrounded.current) {
        verticalVelocity.current = settings.jumpPower;
        isGrounded.current = false;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
    };
    const clearMovement = () => {
      keys.current.clear();
      verticalVelocity.current = 0;
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearMovement();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearMovement);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearMovement);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [camera, gl, settings.jumpPower]);

  useFrame((_, delta) => {
    const previousPosition = camera.position.clone();

    direction.set(0, 0, 0);

    if (keys.current.has("KeyW") || keys.current.has("ArrowUp")) {
      direction.z -= 1;
    }
    if (keys.current.has("KeyS") || keys.current.has("ArrowDown")) {
      direction.z += 1;
    }
    if (keys.current.has("KeyA") || keys.current.has("ArrowLeft")) {
      direction.x -= 1;
    }
    if (keys.current.has("KeyD") || keys.current.has("ArrowRight")) {
      direction.x += 1;
    }

    if (direction.lengthSq() > 0) {
      const speed =
        keys.current.has("ShiftLeft") || keys.current.has("ShiftRight")
          ? settings.sprintSpeed
          : settings.walkSpeed;

      direction.normalize();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();

      velocity
        .set(0, 0, 0)
        .addScaledVector(forward, -direction.z)
        .addScaledVector(right, direction.x)
        .normalize()
        .multiplyScalar(speed * delta);

      camera.position.add(velocity);
    }

    verticalVelocity.current -= 13.5 * delta;
    camera.position.y += verticalVelocity.current * delta;

    if (camera.position.y <= eyeHeight) {
      camera.position.y = eyeHeight;
      verticalVelocity.current = 0;
      isGrounded.current = true;
    }

    currentRoomIndexRef.current = clamp(currentRoomIndexRef.current, 0, room.roomCount - 1);
    const currentRoomIndex = currentRoomIndexRef.current;
    const passages = doors
      .map((door) => getDoorPassage(room, customWalls, door))
      .filter((passage): passage is DoorPassage => Boolean(passage));
    const relatedPassages = passages.filter(
      (passage) =>
        passage.sourceRoomIndex === currentRoomIndex ||
        passage.targetRoomIndex === currentRoomIndex ||
        pointInPassage(passage, camera.position),
    );
    const allowedRoomIndexes = new Set([currentRoomIndex]);

    relatedPassages.forEach((passage) => {
      allowedRoomIndexes.add(passage.sourceRoomIndex);
      allowedRoomIndexes.add(passage.targetRoomIndex);
    });

    const isInAllowedRoom = Array.from(allowedRoomIndexes).some((roomIndex) =>
      pointInRoomWalkBounds(room, roomIndex, camera.position),
    );
    const isInAllowedPassage = relatedPassages.some((passage) => pointInPassage(passage, camera.position));

    if (!isInAllowedRoom && !isInAllowedPassage) {
      const candidates = [
        ...Array.from(allowedRoomIndexes).map((roomIndex) =>
          closestPointInRoomWalkBounds(room, roomIndex, camera.position),
        ),
        ...relatedPassages.map((passage) => closestPointInPassage(passage, camera.position)),
      ];
      const closest = candidates.reduce((best, candidate) => {
        const bestDistance = Math.hypot(camera.position.x - best.x, camera.position.z - best.z);
        const candidateDistance = Math.hypot(
          camera.position.x - candidate.x,
          camera.position.z - candidate.z,
        );

        return candidateDistance < bestDistance ? candidate : best;
      }, candidates[0]);

      if (closest) {
        camera.position.x = closest.x;
        camera.position.z = closest.z;
      }
    }

    resolveCustomWallCollision(camera.position, previousPosition, room, customWalls, doors);

    for (const passage of relatedPassages) {
      if (pointInRoomWalkBounds(room, passage.targetRoomIndex, camera.position, 0.7)) {
        currentRoomIndexRef.current = passage.targetRoomIndex;
        break;
      }

      if (pointInRoomWalkBounds(room, passage.sourceRoomIndex, camera.position, 0.7)) {
        currentRoomIndexRef.current = passage.sourceRoomIndex;
        break;
      }
    }
  });

  return null;
}

function FirstPersonLookControls({
  mode,
  mouseSensitivity,
}: {
  mode: AppMode;
  mouseSensitivity: number;
}) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);

  useEffect(() => {
    camera.rotation.order = "YXZ";
    yaw.current = camera.rotation.y;
    pitch.current = camera.rotation.x;
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const sensitivity = mouseSensitivity;

    const applyRotation = () => {
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw.current;
      camera.rotation.x = pitch.current;
      camera.rotation.z = 0;
    };

    const rotateBy = (movementX: number, movementY: number) => {
      yaw.current -= movementX * sensitivity;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - movementY * sensitivity,
        -Math.PI / 2 + 0.08,
        Math.PI / 2 - 0.08,
      );
      applyRotation();
    };

    if (Math.abs(camera.rotation.x) > Math.PI / 3) {
      yaw.current = 0;
      pitch.current = 0;
      applyRotation();
    } else {
      camera.rotation.order = "YXZ";
      yaw.current = camera.rotation.y;
      pitch.current = camera.rotation.x;
      camera.rotation.z = 0;
    }

    const requestPointerLock = () => {
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock();
      }
    };

    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isViewTrigger = Boolean(target?.closest(".enter-button, .view-mode-button"));

      if (isViewTrigger) {
        requestPointerLock();
        return;
      }

      if ((mode === "view" || mode === "edit") && event.target === canvas && event.button === 0) {
        requestPointerLock();
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        rotateBy(event.movementX, event.movementY);
      }
    };

    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [camera, gl, mode, mouseSensitivity]);

  return null;
}

function EditorCameraControls({ room }: { room: GalleryRoomConfig }) {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3());
  const zoomHeight = useRef(26);
  const isPanning = useRef(false);
  const pointerId = useRef<number | null>(null);
  const hasInitialized = useRef(false);

  const applyCamera = () => {
    const center = target.current;
    camera.position.set(center.x, zoomHeight.current, center.z + zoomHeight.current * 0.38);
    camera.lookAt(center.x, 0, center.z);
    camera.updateProjectionMatrix();
  };

  const clampTarget = () => {
    const firstRoom = getRoomDimensions(room, 0);
    const lastRoom = getRoomDimensions(room, room.roomCount - 1);
    const targetRoom = getRoomDimensions(room, getRoomIndexAtWorldX(room, target.current.x));
    const totalMinX = -firstRoom.width / 2 - 2;
    const totalMaxX = roomOffset(room, room.roomCount - 1) + lastRoom.width / 2 + 2;

    target.current.x = THREE.MathUtils.clamp(target.current.x, totalMinX, totalMaxX);
    target.current.z = THREE.MathUtils.clamp(
      target.current.z,
      -targetRoom.depth / 2 - 2,
      targetRoom.depth / 2 + 2,
    );
  };

  useEffect(() => {
    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }

    if (!hasInitialized.current) {
      const centerX = roomOffset(room, room.roomCount - 1) / 2;
      target.current.set(centerX, 0, 0);
      hasInitialized.current = true;
    }

    const selectedRoom = getRoomDimensions(room, getRoomIndexAtWorldX(room, target.current.x));
    zoomHeight.current = THREE.MathUtils.clamp(
      Math.max(selectedRoom.width, selectedRoom.depth) * 1.25,
      18,
      52,
    );
    camera.rotation.order = "YXZ";
    applyCamera();
  }, [camera, gl, room]);

  useEffect(() => {
    clampTarget();
    applyCamera();
  }, [room]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== canvas || event.button !== 0 || event.shiftKey) {
        return;
      }

      isPanning.current = true;
      pointerId.current = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isPanning.current || pointerId.current !== event.pointerId) {
        return;
      }

      const panScale = zoomHeight.current * 0.0018;
      target.current.x -= event.movementX * panScale;
      target.current.z -= event.movementY * panScale;
      clampTarget();
      applyCamera();
    };

    const stopPanning = (event: PointerEvent) => {
      if (pointerId.current === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      isPanning.current = false;
      pointerId.current = null;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.target !== canvas) {
        return;
      }

      event.preventDefault();
      zoomHeight.current = THREE.MathUtils.clamp(
        zoomHeight.current + event.deltaY * 0.026,
        10,
        58,
      );
      applyCamera();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopPanning);
    canvas.addEventListener("pointercancel", stopPanning);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopPanning);
      canvas.removeEventListener("pointercancel", stopPanning);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl, room]);

  useFrame(() => {
    applyCamera();
  });

  return null;
}

function TopdownBuilderPlacementTracker({
  isEditMode,
  editorViewMode,
  room,
  onBuilderPlacementChange,
}: {
  isEditMode: boolean;
  editorViewMode: EditorViewMode;
  room: GalleryRoomConfig;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const lastKey = useRef<string | null>(null);

  function emitPlacement(target: BuilderPlacementTarget | null) {
    const key = target
      ? `${target.roomIndex}:${target.x.toFixed(2)}:${target.z.toFixed(2)}`
      : null;

    if (lastKey.current === key) {
      return;
    }

    lastKey.current = key;
    onBuilderPlacementChange(target);
  }

  useEffect(() => {
    if (!isEditMode || editorViewMode !== "topdown") {
      emitPlacement(null);
      return;
    }

    const canvas = gl.domElement;

    function updateFromPointer(event: PointerEvent | MouseEvent) {
      if (event.target !== canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      if (raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
        emitPlacement(getPlacementFromWorldPoint(room, hitPoint));
      }
    }

    canvas.addEventListener("pointermove", updateFromPointer);
    canvas.addEventListener("pointerdown", updateFromPointer);
    canvas.addEventListener("mousemove", updateFromPointer);

    return () => {
      canvas.removeEventListener("pointermove", updateFromPointer);
      canvas.removeEventListener("pointerdown", updateFromPointer);
      canvas.removeEventListener("mousemove", updateFromPointer);
    };
  }, [
    camera,
    editorViewMode,
    floorPlane,
    gl,
    hitPoint,
    isEditMode,
    onBuilderPlacementChange,
    pointer,
    raycaster,
    room,
  ]);

  return null;
}

function FloorLines({ room }: { room: GalleryRoomDimensions }) {
  const lines = useMemo(() => {
    const pieces: Array<{
      key: string;
      position: [number, number, number];
      scale: [number, number, number];
    }> = [];
    const spacing = 3;

    for (let x = -room.width / 2 + spacing; x < room.width / 2; x += spacing) {
      pieces.push({
        key: `x-${x.toFixed(1)}`,
        position: [x, 0.025, 0],
        scale: [0.018, 0.018, room.depth],
      });
    }

    for (let z = -room.depth / 2 + spacing; z < room.depth / 2; z += spacing) {
      pieces.push({
        key: `z-${z.toFixed(1)}`,
        position: [0, 0.028, z],
        scale: [room.width, 0.018, 0.018],
      });
    }

    return pieces;
  }, [room]);

  return (
    <>
      {lines.map((line) => (
        <mesh key={line.key} position={line.position}>
          <boxGeometry args={line.scale} />
          <meshStandardMaterial color="#c6aa6c" roughness={0.48} metalness={0.18} />
        </mesh>
      ))}
    </>
  );
}

function CeilingLights({ room }: { room: GalleryRoomDimensions }) {
  const lightRows = Math.max(1, Math.round(room.depth / 12));

  return (
    <>
      {Array.from({ length: lightRows }, (_, index) => {
        const z = ((index + 1) / (lightRows + 1) - 0.5) * room.depth;

        return (
          <group key={z} position={[0, room.height - 0.05, z]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[Math.min(8, room.width * 0.46), 0.46]} />
              <meshBasicMaterial color="#fff2cf" />
            </mesh>
            <pointLight position={[0, -0.2, 0]} intensity={1.1} distance={room.height + 7} color="#fff0d0" />
          </group>
        );
      })}
    </>
  );
}

function Baseboards({ room }: { room: GalleryRoomDimensions }) {
  return (
    <group>
      <mesh position={[0, 0.18, -room.depth / 2 + 0.06]}>
        <boxGeometry args={[room.width, 0.24, 0.12]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.18, room.depth / 2 - 0.06]}>
        <boxGeometry args={[room.width, 0.24, 0.12]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[-room.width / 2 + 0.06, 0.18, 0]}>
        <boxGeometry args={[0.12, 0.24, room.depth]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[room.width / 2 - 0.06, 0.18, 0]}>
        <boxGeometry args={[0.12, 0.24, room.depth]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
    </group>
  );
}

function getGalleryBounds(room: GalleryRoomConfig) {
  const firstRoom = getRoomDimensions(room, 0);
  const lastRoom = getRoomDimensions(room, room.roomCount - 1);

  return {
    minX: -firstRoom.width / 2,
    maxX: roomOffset(room, room.roomCount - 1) + lastRoom.width / 2,
    maxDepth: Math.max(
      ...Array.from({ length: room.roomCount }, (_, index) => getRoomDimensions(room, index).depth),
    ),
  };
}

function Room({
  room,
  roomIndex,
  customWalls,
  isEditMode,
  isSelected,
  editorViewMode,
  transformTool,
  pendingPlacementImageId,
  doors,
  onSelectRoom,
  onUpdateRoom,
  onPlaceImageOnWall,
}: {
  room: GalleryRoomConfig;
  roomIndex: number;
  customWalls: GalleryCustomWall[];
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  pendingPlacementImageId: string | null;
  doors: GalleryDoor[];
  onSelectRoom: (roomIndex: number) => void;
  onUpdateRoom: (roomIndex: number, patch: Partial<GalleryRoomDimensions>) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, roomIndex);
  const center = getRoomCenter(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const dragOffset = useRef(new THREE.Vector3());
  const isDragging = useRef(false);
  const placeOnWall = (wall: GalleryWall, event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode || !pendingPlacementImageId || editorViewMode !== "topdown") {
      return;
    }

    event.stopPropagation();
    const target = builtWallTarget(roomIndex, wall);
    const basis = getWallBasis(room, target, []);
    if (!basis) {
      return;
    }

    const local = event.point.clone().sub(basis.position);
    onPlaceImageOnWall(
      target,
      local.dot(basis.axis),
      clamp(event.point.y, 1.1, dimensions.height - 1.1),
    );
  };
  const selectRoom = (event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode || editorViewMode !== "topdown") {
      return;
    }

    event.stopPropagation();
    onSelectRoom(roomIndex);
  };
  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (
      !isEditMode ||
      editorViewMode !== "topdown" ||
      transformTool !== "move" ||
      pendingPlacementImageId ||
      !event.shiftKey
    ) {
      return;
    }

    event.stopPropagation();
    onSelectRoom(roomIndex);
    isDragging.current = true;
    dragOffset.current.set(event.point.x - center.x, 0, event.point.z - center.z);
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
  };
  const drag = (event: ThreeEvent<PointerEvent>) => {
    if (!isDragging.current || !event.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    event.stopPropagation();
    onUpdateRoom(roomIndex, {
      x: dragPoint.x - dragOffset.current.x,
      z: dragPoint.z - dragOffset.current.z,
    });
  };
  const stopDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  };

  return (
    <group position={[xOffset, 0, center.z]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={selectRoom}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshStandardMaterial color={isSelected && isEditMode ? "#c5bdab" : "#b9b6aa"} roughness={0.58} metalness={0.04} />
      </mesh>
      {isSelected && isEditMode ? (
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[dimensions.width, 0.035, dimensions.depth]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.16} />
        </mesh>
      ) : null}
      <mesh position={[0, dimensions.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshStandardMaterial color="#efe9dc" roughness={0.82} />
      </mesh>
      <Wall
        length={dimensions.width}
        height={dimensions.height}
        position={[0, dimensions.height / 2, -dimensions.depth / 2]}
        onClick={(event) => placeOnWall("north", event)}
        openings={getBuiltWallOpenings(room, customWalls, doors, roomIndex, "north")}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "north"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 北墙`,
        }}
      />
      <Wall
        length={dimensions.width}
        height={dimensions.height}
        position={[0, dimensions.height / 2, dimensions.depth / 2]}
        rotation={[0, Math.PI, 0]}
        onClick={(event) => placeOnWall("south", event)}
        openings={getBuiltWallOpenings(room, customWalls, doors, roomIndex, "south")}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "south"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 南墙`,
        }}
      />
      <Wall
        length={dimensions.depth}
        height={dimensions.height}
        position={[-dimensions.width / 2, dimensions.height / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        onClick={(event) => placeOnWall("west", event)}
        openings={getBuiltWallOpenings(room, customWalls, doors, roomIndex, "west")}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "west"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 西墙`,
        }}
      />
      <Wall
        length={dimensions.depth}
        height={dimensions.height}
        position={[dimensions.width / 2, dimensions.height / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(event) => placeOnWall("east", event)}
        openings={getBuiltWallOpenings(room, customWalls, doors, roomIndex, "east")}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "east"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 东墙`,
        }}
      />
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.05, 0.04, dimensions.depth]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <mesh position={[0, 0.022, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.05, 0.04, dimensions.width]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <FloorLines room={dimensions} />
      <Baseboards room={dimensions} />
      <CeilingLights room={dimensions} />
    </group>
  );
}

function SelectedWallDragSurface({
  wall,
  room,
  onUpdateCustomWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
}) {
  const isDragging = useRef(false);
  const dragOffset = useRef(new THREE.Vector3());
  const bounds = getGalleryBounds(room);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const totalWidth = bounds.maxX - bounds.minX + 4;

  function moveWall(event: ThreeEvent<PointerEvent>) {
    const roomX = roomOffset(room, wall.roomIndex);

    onUpdateCustomWall(wall.id, {
      x: event.point.x - dragOffset.current.x - roomX,
      z: event.point.z - dragOffset.current.z,
    });
  }

  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (!event.shiftKey) {
      return;
    }

    event.stopPropagation();
    isDragging.current = true;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    dragOffset.current.set(
      event.point.x - (roomOffset(room, wall.roomIndex) + wall.x),
      0,
      event.point.z - wall.z,
    );
    moveWall(event);
  }

  function drag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    event.stopPropagation();
    moveWall(event);
  }

  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  }

  return (
    <mesh
      position={[centerX, 0.14, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <planeGeometry args={[totalWidth, bounds.maxDepth + 4]} />
      <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
    </mesh>
  );
}

function SelectedWallDomDrag({
  wall,
  room,
  onUpdateCustomWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);
  const wallRef = useRef(wall);
  const dragOffset = useRef(new THREE.Vector3());

  useEffect(() => {
    wallRef.current = wall;
  }, [wall]);

  useEffect(() => {
    const canvas = gl.domElement;

    function getHit(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      return raycaster.ray.intersectPlane(floorPlane, hitPoint);
    }

    function updateFromEvent(event: PointerEvent) {
      if (!getHit(event)) {
        return;
      }

      const currentWall = wallRef.current;
      const roomX = roomOffset(room, currentWall.roomIndex);

      onUpdateCustomWall(currentWall.id, {
        x: hitPoint.x - dragOffset.current.x - roomX,
        z: hitPoint.z - dragOffset.current.z,
      });
    }

    function startDrag(event: PointerEvent) {
      if (event.button !== 0 || event.target !== canvas || !event.shiftKey) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      isDragging.current = true;
      if (getHit(event)) {
        const currentWall = wallRef.current;
        dragOffset.current.set(
          hitPoint.x - (roomOffset(room, currentWall.roomIndex) + currentWall.x),
          0,
          hitPoint.z - currentWall.z,
        );
      }
      updateFromEvent(event);
    }

    function drag(event: PointerEvent) {
      if (!isDragging.current) {
        return;
      }

      event.preventDefault();
      updateFromEvent(event);
    }

    function stopDrag() {
      isDragging.current = false;
    }

    canvas.addEventListener("pointerdown", startDrag, true);
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);

    return () => {
      canvas.removeEventListener("pointerdown", startDrag, true);
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [camera, floorPlane, gl, hitPoint, onUpdateCustomWall, pointer, raycaster, room]);

  return null;
}

function FirstPersonAimFollower({
  room,
  customWalls,
  layouts,
  doors,
  selectedImageId,
  selectedWallId,
  selectedDoorId,
  transformTool,
  isGrabActive,
  onUpdateImageLayout,
  onUpdateCustomWall,
  onUpdateDoor,
}: {
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  layouts: GalleryLayouts;
  doors: GalleryDoor[];
  selectedImageId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  transformTool: EditorTransformTool;
  isGrabActive: boolean;
  onUpdateImageLayout: (id: string, patch: Partial<GalleryFrameLayout>) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onUpdateDoor: (id: string, patch: Partial<GalleryDoor>) => void;
}) {
  const { camera } = useThree();
  const ray = useMemo(() => new THREE.Ray(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const lastUpdate = useRef(0);

  useFrame((state) => {
    if (
      !isGrabActive ||
      transformTool !== "move" ||
      document.pointerLockElement !== state.gl.domElement
    ) {
      return;
    }

    if (state.clock.elapsedTime - lastUpdate.current < 0.025) {
      return;
    }

    lastUpdate.current = state.clock.elapsedTime;
    camera.getWorldDirection(direction);
    ray.set(camera.position, direction);

    if (selectedWallId) {
      if (!ray.intersectPlane(floorPlane, hitPoint)) {
        return;
      }

      const wall = customWalls.find((item) => item.id === selectedWallId);
      if (!wall) {
        return;
      }

      const nextX = THREE.MathUtils.lerp(
        wall.x,
        hitPoint.x - roomOffset(room, wall.roomIndex),
        0.18,
      );
      const nextZ = THREE.MathUtils.lerp(wall.z, hitPoint.z, 0.18);

      onUpdateCustomWall(selectedWallId, {
        x: nextX,
        z: nextZ,
      });
      return;
    }

    if (!selectedImageId && !selectedDoorId) {
      return;
    }

    let bestHit:
      | {
          distance: number;
          wall: GalleryWallTarget;
          offset: number;
          height: number;
        }
      | null = null;

    for (const target of getAllWallTargets(room, customWalls)) {
      const basis = getWallBasis(room, target, customWalls);
      if (!basis) {
        continue;
      }

      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.normal, basis.position);
      if (!ray.intersectPlane(plane, hitPoint)) {
        continue;
      }

      const local = hitPoint.clone().sub(basis.position);
      const offset = local.dot(basis.axis);
      const height = hitPoint.y;

      if (
        Math.abs(offset) > basis.length / 2 ||
        height < 0.25 ||
        height > basis.height + 0.2
      ) {
        continue;
      }

      const distance = hitPoint.distanceTo(camera.position);
      if (!bestHit || distance < bestHit.distance) {
        bestHit = {
          distance,
          wall: target,
          offset,
          height,
        };
      }
    }

    if (!bestHit) {
      return;
    }

    if (selectedImageId) {
      const current = layouts[selectedImageId];
      onUpdateImageLayout(selectedImageId, {
        wall: bestHit.wall,
        offset: current
          ? THREE.MathUtils.lerp(current.offset, bestHit.offset, 0.22)
          : bestHit.offset,
        height: current
          ? THREE.MathUtils.lerp(current.height, bestHit.height, 0.22)
          : bestHit.height,
      });
      return;
    }

    if (selectedDoorId) {
      const currentDoor = doors.find((door) => door.id === selectedDoorId);
      onUpdateDoor(selectedDoorId, {
        wall: bestHit.wall,
        offset: currentDoor
          ? THREE.MathUtils.lerp(currentDoor.offset, bestHit.offset, 0.22)
          : bestHit.offset,
      });
    }
  });

  return null;
}

function findEditableHit(
  intersections: THREE.Intersection[],
  options: { wallOnly?: boolean } = {},
): EditableHit | null {
  for (const hit of intersections) {
    let current: THREE.Object3D | null = hit.object;

    while (current) {
      const target = current.userData.editableTarget as EditableHitTarget | undefined;

      if (target) {
        const isWallTarget = target.kind === "builtWall" || target.kind === "customWall";

        if (options.wallOnly && !isWallTarget) {
          break;
        }

        return {
          target,
          object: hit.object,
          point: hit.point,
        };
      }

      current = current.parent;
    }
  }

  return null;
}

function FirstPersonEditorPicker({
  isEditMode,
  editorViewMode,
  pendingPlacementImageId,
  room,
  customWalls,
  onSelectImage,
  onSelectWall,
  onSelectDoor,
  onSelectRoom,
  onPlaceImageOnWall,
  onAimTargetChange,
  onBuilderPlacementChange,
}: {
  isEditMode: boolean;
  editorViewMode: EditorViewMode;
  pendingPlacementImageId: string | null;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  onSelectImage: (id: string) => void;
  onSelectWall: (id: string) => void;
  onSelectDoor: (id: string) => void;
  onSelectRoom: (roomIndex: number) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
  onAimTargetChange: (label: string | null) => void;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const floorHit = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const lastAimKey = useRef<string | null>(null);
  const lastPlacementKey = useRef<string | null>(null);
  const latestHit = useRef<EditableHit | null>(null);

  function getEditableHit(wallOnly = false) {
    raycaster.setFromCamera(center, camera);
    return findEditableHit(raycaster.intersectObjects(scene.children, true), { wallOnly });
  }

  function setAimLabel(hit: EditableHit | null) {
    const key = hit ? `${hit.target.kind}:${hit.target.label}` : null;

    if (lastAimKey.current === key) {
      return;
    }

    lastAimKey.current = key;
    onAimTargetChange(hit?.target.label ?? null);
  }

  function emitBuilderPlacement(target: BuilderPlacementTarget | null) {
    const key = target
      ? [
          target.roomIndex,
          target.x.toFixed(2),
          target.z.toFixed(2),
          target.wall ?? "",
          target.wallOffset?.toFixed(2) ?? "",
        ].join(":")
      : null;

    if (lastPlacementKey.current === key) {
      return;
    }

    lastPlacementKey.current = key;
    onBuilderPlacementChange(target);
  }

  function getBuilderPlacement(hit: EditableHit | null) {
    if (hit) {
      const basePoint = hit.point.clone();
      const target = hit.target;

      if (target.kind === "builtWall") {
        const dimensions = getRoomDimensions(room, target.roomIndex);
        const basis = getWallBasis(room, target.wall, customWalls);
        if (!basis) {
          return getPlacementFromWorldPoint(room, basePoint);
        }

        return getPlacementFromWorldPoint(room, basePoint, {
          wall: target.wall,
          wallOffset: hit.point.clone().sub(basis.position).dot(basis.axis),
          wallHeight: clamp(hit.point.y, 1.1, dimensions.height - 1.1),
          label: target.label,
        });
      }

      if (target.kind === "customWall") {
        const wall = customWalls.find((item) => item.id === target.id);
        const local = hit.object.worldToLocal(hit.point.clone());

        if (wall) {
          return getPlacementFromWorldPoint(room, basePoint, {
            wall: target.wall,
            wallOffset: local.x,
            wallHeight: clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45),
            label: wall.name,
          });
        }
      }

      return getPlacementFromWorldPoint(room, basePoint);
    }

    camera.getWorldDirection(direction);
    const ray = raycaster.ray;
    ray.set(camera.position, direction);

    if (ray.intersectPlane(floorPlane, floorHit)) {
      return getPlacementFromWorldPoint(room, floorHit);
    }

    const fallbackPoint = camera.position.clone().addScaledVector(direction, 4);
    fallbackPoint.y = 0;
    return getPlacementFromWorldPoint(room, fallbackPoint);
  }

  function placeOnWall(hit: EditableHit) {
    const target = hit.target;

    if (target.kind !== "builtWall" && target.kind !== "customWall") {
      return false;
    }

    if (target.kind === "builtWall") {
      const dimensions = getRoomDimensions(room, target.roomIndex);
      const basis = getWallBasis(room, target.wall, customWalls);
      if (!basis) {
        return false;
      }

      onPlaceImageOnWall(
        target.wall,
        hit.point.clone().sub(basis.position).dot(basis.axis),
        clamp(hit.point.y, 1.1, dimensions.height - 1.1),
      );
      return true;
    }

    if (target.kind !== "customWall") {
      return false;
    }

    const wall = customWalls.find((item) => item.id === target.id);
    if (!wall) {
      return false;
    }

    const local = hit.object.worldToLocal(hit.point.clone());

    onPlaceImageOnWall(
      target.wall,
      local.x,
      clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45),
    );
    return true;
  }

  function selectHit(hit: EditableHit) {
    if (hit.target.kind === "artwork") {
      onSelectImage(hit.target.id);
      return;
    }

    if (hit.target.kind === "customWall") {
      onSelectWall(hit.target.id);
      return;
    }

    if (hit.target.kind === "door") {
      onSelectDoor(hit.target.id);
      return;
    }

    onSelectRoom(hit.target.roomIndex);
  }

  useFrame(() => {
    if (!isEditMode || editorViewMode !== "firstPerson") {
      latestHit.current = null;
      setAimLabel(null);
      return;
    }

    const hit = getEditableHit(Boolean(pendingPlacementImageId));
    const placementHit =
      hit?.target.kind === "builtWall" || hit?.target.kind === "customWall"
        ? hit
        : getEditableHit(true) ?? hit;
    latestHit.current = hit;
    setAimLabel(hit);
    emitBuilderPlacement(getBuilderPlacement(placementHit));
  });

  useEffect(() => {
    const canvas = gl.domElement;

    function onPointerDown(event: PointerEvent) {
      if (
        !isEditMode ||
        editorViewMode !== "firstPerson" ||
        event.button !== 0 ||
        event.target !== canvas
      ) {
        return;
      }

      const hit = pendingPlacementImageId ? getEditableHit(true) : latestHit.current ?? getEditableHit();
      if (!hit) {
        return;
      }

      if (pendingPlacementImageId && placeOnWall(hit)) {
        event.preventDefault();
        return;
      }

      selectHit(hit);
    }

    canvas.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [
    camera,
    customWalls,
    editorViewMode,
    gl,
    isEditMode,
    onPlaceImageOnWall,
    onSelectDoor,
    onSelectImage,
    onSelectRoom,
    onSelectWall,
    pendingPlacementImageId,
    raycaster,
    room.height,
    scene,
  ]);

  useEffect(() => {
    if (!isEditMode || editorViewMode !== "firstPerson") {
      onAimTargetChange(null);
      onBuilderPlacementChange(null);
      lastAimKey.current = null;
      lastPlacementKey.current = null;
    }
  }, [editorViewMode, isEditMode, onAimTargetChange, onBuilderPlacementChange]);

  return null;
}

function Wall({
  length,
  height,
  position,
  rotation = [0, 0, 0],
  onClick,
  editableTarget,
  openings = [],
}: {
  length: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  editableTarget?: EditableHitTarget;
  openings?: WallOpening[];
}) {
  const wallPieces = useMemo(() => {
    const sortedOpenings = openings
      .map((opening) => ({
        start: clamp(opening.offset - opening.width / 2 - 0.08, -length / 2, length / 2),
        end: clamp(opening.offset + opening.width / 2 + 0.08, -length / 2, length / 2),
        offset: opening.offset,
        height: clamp(opening.height + 0.12, 1.2, height - 0.18),
      }))
      .filter((opening) => opening.end > opening.start + 0.1)
      .sort((a, b) => a.start - b.start);
    const pieces: Array<{ key: string; x: number; y: number; width: number; height: number }> = [];
    let cursor = -length / 2;

    sortedOpenings.forEach((opening, index) => {
      const leftWidth = opening.start - cursor;
      if (leftWidth > 0.08) {
        pieces.push({
          key: `side-${index}`,
          x: cursor + leftWidth / 2,
          y: 0,
          width: leftWidth,
          height,
        });
      }

      const topHeight = height - opening.height;
      if (topHeight > 0.08) {
        pieces.push({
          key: `top-${index}`,
          x: (opening.start + opening.end) / 2,
          y: -height / 2 + opening.height + topHeight / 2,
          width: opening.end - opening.start,
          height: topHeight,
        });
      }

      cursor = Math.max(cursor, opening.end);
    });

    const rightWidth = length / 2 - cursor;
    if (rightWidth > 0.08) {
      pieces.push({
        key: "side-end",
        x: cursor + rightWidth / 2,
        y: 0,
        width: rightWidth,
        height,
      });
    }

    return pieces;
  }, [height, length, openings]);

  if (openings.length > 0) {
    return (
      <group position={position} rotation={rotation} userData={editableTarget ? { editableTarget } : undefined}>
        {wallPieces.map((piece) => (
          <mesh
            key={piece.key}
            position={[piece.x, piece.y, 0]}
            castShadow
            receiveShadow
            onClick={onClick}
            userData={editableTarget ? { editableTarget } : undefined}
          >
            <boxGeometry args={[piece.width, piece.height, 0.18]} />
            <meshStandardMaterial color="#e7e1d3" roughness={0.88} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
      onClick={onClick}
      userData={editableTarget ? { editableTarget } : undefined}
    >
      <boxGeometry args={[length, height, 0.18]} />
      <meshStandardMaterial color="#e7e1d3" roughness={0.88} side={THREE.DoubleSide} />
    </mesh>
  );
}

function CustomWall({
  wall,
  room,
  doors,
  isEditMode,
  isSelected,
  editorViewMode,
  transformTool,
  pendingPlacementImageId,
  onSelectWall,
  onUpdateCustomWall,
  onPlaceImageOnWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  doors: GalleryDoor[];
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  pendingPlacementImageId: string | null;
  onSelectWall: (id: string) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, wall.roomIndex);
  const wallGroupRef = useRef<THREE.Group>(null);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);
  const openings = useMemo(() => getCustomWallOpenings(wall, doors), [doors, wall]);
  const wallPieces = useMemo(() => {
    const sortedOpenings = openings
      .map((opening) => ({
        start: clamp(opening.offset - opening.width / 2 - 0.08, -wall.length / 2, wall.length / 2),
        end: clamp(opening.offset + opening.width / 2 + 0.08, -wall.length / 2, wall.length / 2),
        height: clamp(opening.height + 0.12, 1.2, wall.height - 0.18),
      }))
      .filter((opening) => opening.end > opening.start + 0.1)
      .sort((a, b) => a.start - b.start);
    const pieces: Array<{ key: string; x: number; y: number; width: number; height: number }> = [];
    let cursor = -wall.length / 2;

    sortedOpenings.forEach((opening, index) => {
      const leftWidth = opening.start - cursor;
      if (leftWidth > 0.08) {
        pieces.push({
          key: `side-${index}`,
          x: cursor + leftWidth / 2,
          y: 0,
          width: leftWidth,
          height: wall.height,
        });
      }

      const topHeight = wall.height - opening.height;
      if (topHeight > 0.08) {
        pieces.push({
          key: `top-${index}`,
          x: (opening.start + opening.end) / 2,
          y: -wall.height / 2 + opening.height + topHeight / 2,
          width: opening.end - opening.start,
          height: topHeight,
        });
      }

      cursor = Math.max(cursor, opening.end);
    });

    const rightWidth = wall.length / 2 - cursor;
    if (rightWidth > 0.08) {
      pieces.push({
        key: "side-end",
        x: cursor + rightWidth / 2,
        y: 0,
        width: rightWidth,
        height: wall.height,
      });
    }

    return pieces;
  }, [openings, wall.height, wall.length]);
  const frontTarget: EditableHitTarget = {
    kind: "customWall",
    id: wall.id,
    wall: wall.id,
    label: wall.name,
  };
  const backTarget: EditableHitTarget = {
    kind: "customWall",
    id: wall.id,
    wall: customWallBackTarget(wall.id),
    label: `${wall.name} 背面`,
  };

  function selectWall() {
    if (isEditMode) {
      onSelectWall(wall.id);
    }
  }

  function handleClick(event: ThreeEvent<MouseEvent>, target: EditableHitTarget = frontTarget) {
    if (!isEditMode) {
      return;
    }

    event.stopPropagation();

    if (editorViewMode === "firstPerson") {
      return;
    }

    if (!pendingPlacementImageId) {
      selectWall();
      return;
    }

    const local = wallGroupRef.current?.worldToLocal(event.point.clone());
    if (!local) {
      return;
    }

    onPlaceImageOnWall(
      target.kind === "customWall" ? target.wall : wall.id,
      local.x,
      clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45),
    );
  }

  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (
      !isEditMode ||
      pendingPlacementImageId ||
      editorViewMode !== "topdown" ||
      transformTool !== "move" ||
      !event.shiftKey
    ) {
      return;
    }

    event.stopPropagation();
    selectWall();
    isDragging.current = true;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
  }

  function drag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current || !event.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    event.stopPropagation();
    onUpdateCustomWall(wall.id, {
      x: dragPoint.x - xOffset,
      z: dragPoint.z,
    });
  }

  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  }

  return (
    <group
      ref={wallGroupRef}
      position={[xOffset + wall.x, wall.height / 2, wall.z]}
      rotation={[0, wall.rotation, 0]}
    >
      {isSelected ? (
        <mesh position={[0, 0, 0]} onClick={(event) => handleClick(event)} userData={{ editableTarget: frontTarget }}>
          <boxGeometry args={[wall.length + 0.28, wall.height + 0.18, customWallDepth + 0.08]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.28} />
        </mesh>
      ) : null}
      {wallPieces.map((piece) => (
        <group key={piece.key} position={[piece.x, piece.y, 0]}>
          <mesh
            onClick={handleClick}
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            receiveShadow
            castShadow
            userData={{ editableTarget: frontTarget }}
          >
            <boxGeometry args={[piece.width, piece.height, customWallDepth]} />
            <meshStandardMaterial color={isSelected ? "#e7dbc0" : "#ded7c8"} roughness={0.82} />
          </mesh>
          <mesh
            position={[0, 0, wallSurfaceOffset]}
            onClick={(event) => handleClick(event, frontTarget)}
            userData={{ editableTarget: frontTarget }}
          >
            <planeGeometry args={[piece.width, piece.height]} />
            <meshStandardMaterial color="#eee8da" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          <mesh
            position={[0, 0, -wallSurfaceOffset]}
            rotation={[0, Math.PI, 0]}
            onClick={(event) => handleClick(event, backTarget)}
            userData={{ editableTarget: backTarget }}
          >
            <planeGeometry args={[piece.width, piece.height]} />
            <meshStandardMaterial color="#e4ddcf" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {isEditMode && editorViewMode === "topdown" && !pendingPlacementImageId ? (
        <mesh
          position={[0, -wall.height / 2 + 0.08, 0]}
          onClick={(event) => handleClick(event)}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget: frontTarget }}
        >
          <boxGeometry args={[wall.length, 0.08, 0.9]} />
          <meshBasicMaterial
            color={isSelected ? "#f6c453" : "#3b342c"}
            transparent
            opacity={isSelected ? 0.34 : 0.12}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function Door({
  door,
  room,
  customWalls,
  isEditMode,
  isSelected,
  editorViewMode,
  transformTool,
  onSelectDoor,
  onToggleDoor,
  onUpdateDoor,
}: {
  door: GalleryDoor;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  onSelectDoor: (id: string) => void;
  onToggleDoor: (id: string) => void;
  onUpdateDoor: (id: string, patch: Partial<GalleryDoor>) => void;
}) {
  const builtWall = parseBuiltWallTarget(door.wall);
  const customTarget = builtWall ? null : parseCustomWallTarget(door.wall, customWalls);
  const mount = builtWall
    ? getWallMount(room, builtWall.wall, builtWall.roomIndex, 0)
    : customTarget
      ? getCustomWallFaceMount(room, customTarget.wall, customTarget.side)
      : null;

  if (!mount) {
    return null;
  }

  const editableTarget: EditableHitTarget = {
    kind: "door",
    id: door.id,
    label: door.name,
  };
  const wallBasis = getWallBasis(room, door.wall, customWalls, 0);
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);
  const frameThickness = 0.16;
  const frameDepth = 0.24;
  const leafWidth = Math.max(0.3, door.width - 0.1);
  const leafHeight = Math.max(0.8, door.height - 0.1);

  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (!isEditMode || editorViewMode !== "topdown" || transformTool !== "move" || !wallBasis || !event.shiftKey) {
      return;
    }

    event.stopPropagation();
    onSelectDoor(door.id);
    isDragging.current = true;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
  }

  function drag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current || !wallBasis) {
      return;
    }

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      wallBasis.normal,
      wallBasis.position,
    );

    if (!event.ray.intersectPlane(plane, dragPoint)) {
      return;
    }

    event.stopPropagation();
    onUpdateDoor(door.id, {
      offset: dragPoint.clone().sub(wallBasis.position).dot(wallBasis.axis),
    });
  }

  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();

    if (!isEditMode) {
      onToggleDoor(door.id);
      return;
    }

    if (editorViewMode === "firstPerson") {
      return;
    }
    onSelectDoor(door.id);
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[door.offset, door.height / 2, 0]}>
        {isSelected && isEditMode ? (
          <group>
            <mesh position={[-door.width / 2 - 0.12, 0, 0.02]}>
              <boxGeometry args={[0.08, door.height + 0.32, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.55} />
            </mesh>
            <mesh position={[door.width / 2 + 0.12, 0, 0.02]}>
              <boxGeometry args={[0.08, door.height + 0.32, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.55} />
            </mesh>
            <mesh position={[0, door.height / 2 + 0.15, 0.02]}>
              <boxGeometry args={[door.width + 0.4, 0.08, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.55} />
            </mesh>
          </group>
        ) : null}
        <mesh
          position={[-door.width / 2 - frameThickness / 2, 0, 0]}
          onClick={handleClick}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[frameThickness, door.height + frameThickness, frameDepth]} />
          <meshStandardMaterial color="#6d5946" roughness={0.68} />
        </mesh>
        <mesh
          position={[door.width / 2 + frameThickness / 2, 0, 0]}
          onClick={handleClick}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[frameThickness, door.height + frameThickness, frameDepth]} />
          <meshStandardMaterial color="#6d5946" roughness={0.68} />
        </mesh>
        <mesh
          position={[0, door.height / 2 + frameThickness / 2, 0]}
          onClick={handleClick}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[door.width + frameThickness * 2, frameThickness, frameDepth]} />
          <meshStandardMaterial color="#78634f" roughness={0.66} />
        </mesh>
        <mesh
          position={[0, -door.height / 2 + 0.04, 0.01]}
          onClick={handleClick}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[door.width + frameThickness * 1.6, 0.08, frameDepth]} />
          <meshStandardMaterial color="#8b765f" roughness={0.72} />
        </mesh>
        <group
          position={[-door.width / 2, 0, 0.08]}
          rotation={[0, door.isOpen ? -Math.PI * 0.68 : 0, 0]}
        >
          <mesh
            position={[leafWidth / 2 + 0.05, -0.01, 0]}
            castShadow
            onClick={handleClick}
            userData={{ editableTarget }}
          >
            <boxGeometry args={[leafWidth, leafHeight, 0.1]} />
            <meshStandardMaterial color="#594638" roughness={0.6} metalness={0.04} />
          </mesh>
          <mesh
            position={[door.width * 0.82, 0.02, 0.08]}
            onClick={handleClick}
            userData={{ editableTarget }}
          >
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshStandardMaterial color="#d2b56d" roughness={0.38} metalness={0.42} />
          </mesh>
        </group>
        {isEditMode && editorViewMode === "topdown" ? (
          <mesh
            position={[0, -door.height / 2 + 0.08, 0.2]}
            onClick={handleClick}
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            userData={{ editableTarget }}
          >
            <boxGeometry args={[door.width + 0.28, 0.08, 0.82]} />
            <meshBasicMaterial
              color={isSelected ? "#f6c453" : "#211914"}
              transparent
              opacity={isSelected ? 0.45 : 0.22}
            />
          </mesh>
        ) : null}
      </group>
    </group>
  );
}

function ConnectedDoorPortal({
  door,
  room,
  customWalls,
  isEditMode,
  isSelected,
  editorViewMode,
  onSelectDoor,
  onToggleDoor,
}: {
  door: GalleryDoor;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  onSelectDoor: (id: string) => void;
  onToggleDoor: (id: string) => void;
}) {
  const portal = getConnectedDoorPortal(room, customWalls, door);

  if (!portal) {
    return null;
  }

  const mount = getWallMount(room, portal.built.wall, portal.built.roomIndex, 0);
  const editableTarget: EditableHitTarget = {
    kind: "door",
    id: door.id,
    label: `${door.name} 对侧`,
  };
  const frameThickness = 0.16;
  const frameDepth = 0.24;

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();

    if (!isEditMode) {
      onToggleDoor(door.id);
      return;
    }

    if (editorViewMode === "firstPerson") {
      return;
    }

    onSelectDoor(door.id);
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[portal.opening.offset, door.height / 2, 0]}>
        {isSelected && isEditMode ? (
          <group>
            <mesh position={[-door.width / 2 - 0.12, 0, 0.02]}>
              <boxGeometry args={[0.08, door.height + 0.32, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.48} />
            </mesh>
            <mesh position={[door.width / 2 + 0.12, 0, 0.02]}>
              <boxGeometry args={[0.08, door.height + 0.32, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.48} />
            </mesh>
            <mesh position={[0, door.height / 2 + 0.15, 0.02]}>
              <boxGeometry args={[door.width + 0.4, 0.08, 0.3]} />
              <meshBasicMaterial color="#f6c453" transparent opacity={0.48} />
            </mesh>
          </group>
        ) : null}
        <mesh position={[-door.width / 2 - frameThickness / 2, 0, 0]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[frameThickness, door.height + frameThickness, frameDepth]} />
          <meshStandardMaterial color="#6d5946" roughness={0.68} />
        </mesh>
        <mesh position={[door.width / 2 + frameThickness / 2, 0, 0]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[frameThickness, door.height + frameThickness, frameDepth]} />
          <meshStandardMaterial color="#6d5946" roughness={0.68} />
        </mesh>
        <mesh position={[0, door.height / 2 + frameThickness / 2, 0]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[door.width + frameThickness * 2, frameThickness, frameDepth]} />
          <meshStandardMaterial color="#78634f" roughness={0.66} />
        </mesh>
        <mesh position={[0, -door.height / 2 + 0.04, 0.01]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[door.width + frameThickness * 1.6, 0.08, frameDepth]} />
          <meshStandardMaterial color="#8b765f" roughness={0.72} />
        </mesh>
        {!door.isOpen ? (
          <mesh position={[0, -0.01, 0.08]} castShadow onClick={handleClick} userData={{ editableTarget }}>
            <boxGeometry args={[Math.max(0.3, door.width - 0.1), Math.max(0.8, door.height - 0.1), 0.1]} />
            <meshStandardMaterial color="#4d3b2f" roughness={0.62} metalness={0.04} />
          </mesh>
        ) : null}
      </group>
    </group>
  );
}

function DoorConnections({
  room,
  customWalls,
  doors,
}: {
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
}) {
  return (
    <>
      {doors.map((door) => {
        if (door.connectsToRoomIndex === null || door.connectsToRoomIndex === undefined) {
          return null;
        }

        const start = getDoorWorldPosition(room, customWalls, door);
        if (!start) {
          return null;
        }

        const targetEntry = getRoomBoundaryEntryPoint(room, door.connectsToRoomIndex, start, 0.85);
        const end = targetEntry.boundary;
        const delta = end.clone().sub(new THREE.Vector3(start.x, 0, start.z));
        const length = delta.length();

        if (length < 1) {
          return null;
        }

        const midpoint = new THREE.Vector3(start.x, 0.055, start.z).addScaledVector(delta, 0.5);
        const rotationY = Math.atan2(delta.x, delta.z);

        return (
          <group key={door.id} position={[midpoint.x, midpoint.y, midpoint.z]} rotation={[0, rotationY, 0]}>
            <mesh receiveShadow>
              <boxGeometry args={[Math.max(door.width + 0.5, 1.8), 0.06, length]} />
              <meshStandardMaterial
                color={door.isOpen ? "#2c2924" : "#4b4338"}
                roughness={0.82}
                transparent
                opacity={door.isOpen ? 0.9 : 0.34}
              />
            </mesh>
            <mesh position={[0, 0.055, length / 2]}>
              <boxGeometry args={[Math.max(door.width + 0.36, 1.5), 0.08, 0.28]} />
              <meshStandardMaterial
                color={door.isOpen ? "#d4b46b" : "#423932"}
                roughness={0.72}
                transparent
                opacity={door.isOpen ? 0.62 : 0.28}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Artwork({
  image,
  layout,
  room,
  customWalls,
  doors,
  isSelected,
  isEditable,
  editorViewMode,
  onSelect,
}: {
  image: GalleryImage;
  layout: GalleryFrameLayout;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
  isSelected: boolean;
  isEditable: boolean;
  editorViewMode: EditorViewMode;
  onSelect: () => void;
}) {
  const builtWall = parseBuiltWallTarget(layout.wall);
  const customTarget = builtWall ? null : parseCustomWallTarget(layout.wall, customWalls);
  const mount = builtWall ? getWallMount(room, builtWall.wall, builtWall.roomIndex) : null;
  const customMount = customTarget
    ? getCustomWallFaceMount(room, customTarget.wall, customTarget.side)
    : null;
  const texture = useLoader(THREE.TextureLoader, image.url);
  const aspect = image.width / image.height || 1.42;
  const width = layout.width;
  const height = width / aspect;
  const frameOuterWidth = width + 0.28;
  const frameOuterHeight = height + 0.28;
  const selectionSize = 0.045;
  const artworkZ = customTarget ? 0.004 : 0;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

  if (
    (!mount && !customMount) ||
    layoutOverlapsDoorOpening(room, customWalls, doors, layout, width + 0.34, height + 0.34)
  ) {
    return null;
  }

  const editableTarget: EditableHitTarget = {
    kind: "artwork",
    id: image.id,
    label: image.name,
  };

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditable) {
      return;
    }

    event.stopPropagation();
    if (editorViewMode === "firstPerson") {
      return;
    }
    onSelect();
  }

  return (
    <group
      position={customMount?.position ?? mount!.position}
      rotation={customMount?.rotation ?? mount!.rotation}
    >
      <group position={[0, 0, artworkZ]}>
        <group position={[layout.offset, layout.height, 0]}>
          {isSelected ? (
            <group position={[0, 0, artworkFrameDepth + 0.012]}>
              <mesh position={[0, frameOuterHeight / 2 + selectionSize / 2, 0]}>
                <boxGeometry args={[frameOuterWidth + selectionSize * 2, selectionSize, 0.014]} />
                <meshBasicMaterial color="#f6c453" />
              </mesh>
              <mesh position={[0, -frameOuterHeight / 2 - selectionSize / 2, 0]}>
                <boxGeometry args={[frameOuterWidth + selectionSize * 2, selectionSize, 0.014]} />
                <meshBasicMaterial color="#f6c453" />
              </mesh>
              <mesh position={[-frameOuterWidth / 2 - selectionSize / 2, 0, 0]}>
                <boxGeometry args={[selectionSize, frameOuterHeight + selectionSize * 2, 0.014]} />
                <meshBasicMaterial color="#f6c453" />
              </mesh>
              <mesh position={[frameOuterWidth / 2 + selectionSize / 2, 0, 0]}>
                <boxGeometry args={[selectionSize, frameOuterHeight + selectionSize * 2, 0.014]} />
                <meshBasicMaterial color="#f6c453" />
              </mesh>
            </group>
          ) : null}
          <mesh
            position={[0, 0, artworkFrameDepth / 2]}
            castShadow
            onClick={handleClick}
            userData={{ editableTarget }}
          >
            <boxGeometry args={[frameOuterWidth, frameOuterHeight, artworkFrameDepth]} />
            <meshStandardMaterial color="#2f2a22" roughness={0.45} />
          </mesh>
          <mesh position={[0, 0, artworkFrameDepth + 0.006]} onClick={handleClick} userData={{ editableTarget }}>
            <planeGeometry args={[width + 0.1, height + 0.1]} />
            <meshStandardMaterial color="#f7f1e4" roughness={0.72} />
          </mesh>
          <mesh position={[0, 0, artworkFrameDepth + 0.012]} onClick={handleClick} userData={{ editableTarget }}>
            <planeGeometry args={[width, height]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 1.35, 0.18]} intensity={0.55} distance={4.2} color="#fff6df" />
        </group>
      </group>
    </group>
  );
}

function EmptyFrames({
  count,
  room,
  customWalls,
  doors,
}: {
  count: number;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
}) {
  const frames = Array.from({ length: count }, (_, index) => {
    const wall = wallOrder[Math.floor(index / 3) % wallOrder.length];
    const slot = index % 3;
    const usableLength = Math.max(5, getWallLength(room, wall) - 3.6);

    return {
      wall,
      offset: clamp((slot - 1) * Math.max(2.8, usableLength / 3), -usableLength / 2, usableLength / 2),
      height: clamp(room.height * 0.48, 2.2, room.height - 1.15),
    };
  });

  return (
    <>
      {frames.map((layout, index) => {
        if (
          layoutOverlapsDoorOpening(
            room,
            customWalls,
            doors,
            { ...layout, width: 2.8 },
            2.8,
            2,
          )
        ) {
          return null;
        }

        const mount = getWallMount(room, layout.wall);

        return (
          <group key={index} position={mount.position} rotation={mount.rotation}>
            <group position={[layout.offset, layout.height, 0]}>
              <mesh position={[0, 0, 0.05]}>
                <boxGeometry args={[2.8, 2.0, 0.12]} />
                <meshStandardMaterial color="#4b4034" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0, 0.14]}>
                <planeGeometry args={[2.45, 1.65]} />
                <meshStandardMaterial color="#d8d0c0" roughness={0.9} />
              </mesh>
            </group>
          </group>
        );
      })}
    </>
  );
}

export default function GalleryScene({
  images,
  layouts,
  roomConfig,
  customWalls,
  doors,
  mode,
  editorViewMode,
  transformTool,
  editorSettings,
  isGrabActive,
  pendingPlacementImageId,
  selectedImageId,
  selectedWallId,
  selectedDoorId,
  selectedRoomIndex,
  onSelectImage,
  onSelectWall,
  onSelectDoor,
  onSelectRoom,
  onUpdateRoom,
  onUpdateImageLayout,
  onUpdateCustomWall,
  onUpdateDoor,
  onToggleDoor,
  onPlaceImageOnWall,
  onAimTargetChange,
  onBuilderPlacementChange,
}: GallerySceneProps) {
  const isEditMode = mode === "edit";
  const useTopdownEditor = isEditMode && editorViewMode === "topdown";
  const sceneRoomConfig = roomConfig;
  const selectedWallForDrag =
    useTopdownEditor && transformTool === "move" && selectedWallId
      ? customWalls.find((wall) => wall.id === selectedWallId) ?? null
      : null;

  return (
    <Canvas
      shadows
      camera={{ fov: 72, position: [0, eyeHeight, 7], near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#151515"]} />
      <fog attach="fog" args={["#151515", 20, 42]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[3, sceneRoomConfig.height + 3, 5]} intensity={0.8} castShadow />
      <spotLight
        position={[0, sceneRoomConfig.height - 0.35, 0]}
        angle={0.95}
        penumbra={0.6}
        intensity={1.2}
      />
      {Array.from({ length: sceneRoomConfig.roomCount }, (_, roomIndex) => (
        <Room
          key={roomIndex}
          room={sceneRoomConfig}
          roomIndex={roomIndex}
          customWalls={customWalls}
          isEditMode={isEditMode}
          isSelected={selectedRoomIndex === roomIndex}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          pendingPlacementImageId={pendingPlacementImageId}
          doors={doors}
          onSelectRoom={onSelectRoom}
          onUpdateRoom={onUpdateRoom}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {customWalls.map((wall) => (
        <CustomWall
          key={wall.id}
          wall={wall}
          room={sceneRoomConfig}
          doors={doors}
          isEditMode={isEditMode}
          isSelected={selectedWallId === wall.id}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          pendingPlacementImageId={pendingPlacementImageId}
          onSelectWall={onSelectWall}
          onUpdateCustomWall={onUpdateCustomWall}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {selectedWallForDrag ? (
        <>
          <SelectedWallDragSurface
            wall={selectedWallForDrag}
            room={sceneRoomConfig}
            onUpdateCustomWall={onUpdateCustomWall}
          />
          <SelectedWallDomDrag
            wall={selectedWallForDrag}
            room={sceneRoomConfig}
            onUpdateCustomWall={onUpdateCustomWall}
          />
        </>
      ) : null}
      <DoorConnections room={sceneRoomConfig} customWalls={customWalls} doors={doors} />
      {doors.map((door) => (
        <Door
          key={door.id}
          door={door}
          room={sceneRoomConfig}
          customWalls={customWalls}
          isEditMode={isEditMode}
          isSelected={isEditMode && selectedDoorId === door.id}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          onSelectDoor={onSelectDoor}
          onToggleDoor={onToggleDoor}
          onUpdateDoor={onUpdateDoor}
        />
      ))}
      {doors.map((door) => (
        <ConnectedDoorPortal
          key={`${door.id}:portal`}
          door={door}
          room={sceneRoomConfig}
          customWalls={customWalls}
          isEditMode={isEditMode}
          isSelected={isEditMode && selectedDoorId === door.id}
          editorViewMode={editorViewMode}
          onSelectDoor={onSelectDoor}
          onToggleDoor={onToggleDoor}
        />
      ))}
      {images.length > 0 ? (
        images.map((image, index) => (
          <Artwork
            key={image.id}
            image={image}
            layout={layouts[image.id] ?? getDefaultLayout(image, index, sceneRoomConfig)}
            room={sceneRoomConfig}
            customWalls={customWalls}
            doors={doors}
            isSelected={isEditMode && selectedImageId === image.id}
            isEditable={isEditMode}
            editorViewMode={editorViewMode}
            onSelect={() => onSelectImage(image.id)}
          />
        ))
      ) : (
        <EmptyFrames count={6} room={sceneRoomConfig} customWalls={customWalls} doors={doors} />
      )}
      {useTopdownEditor ? (
        <>
          <EditorCameraControls room={sceneRoomConfig} />
          <TopdownBuilderPlacementTracker
            isEditMode={isEditMode}
            editorViewMode={editorViewMode}
            room={sceneRoomConfig}
            onBuilderPlacementChange={onBuilderPlacementChange}
          />
        </>
      ) : (
        <>
          <FirstPersonLookControls
            mode={mode}
            mouseSensitivity={editorSettings.mouseSensitivity}
          />
          <PlayerMovement
            room={sceneRoomConfig}
            settings={editorSettings}
            doors={doors}
            customWalls={customWalls}
          />
          {isEditMode ? (
            <>
              <FirstPersonEditorPicker
                isEditMode={isEditMode}
                editorViewMode={editorViewMode}
                pendingPlacementImageId={pendingPlacementImageId}
                room={sceneRoomConfig}
                customWalls={customWalls}
                onSelectImage={onSelectImage}
                onSelectWall={onSelectWall}
                onSelectDoor={onSelectDoor}
                onSelectRoom={onSelectRoom}
                onPlaceImageOnWall={onPlaceImageOnWall}
                onAimTargetChange={onAimTargetChange}
                onBuilderPlacementChange={onBuilderPlacementChange}
              />
              <FirstPersonAimFollower
                room={sceneRoomConfig}
                customWalls={customWalls}
                layouts={layouts}
                doors={doors}
                selectedImageId={selectedImageId}
                selectedWallId={selectedWallId}
                selectedDoorId={selectedDoorId}
                transformTool={transformTool}
                isGrabActive={isGrabActive}
                onUpdateImageLayout={onUpdateImageLayout}
                onUpdateCustomWall={onUpdateCustomWall}
                onUpdateDoor={onUpdateDoor}
              />
            </>
          ) : null}
        </>
      )}
    </Canvas>
  );
}
