import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  AppMode,
  EditorViewMode,
  GalleryCustomWall,
  GalleryDoor,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
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
  pendingPlacementImageId: string | null;
  selectedImageId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  selectedRoomIndex: number;
  onSelectImage: (id: string) => void;
  onSelectWall: (id: string) => void;
  onSelectDoor: (id: string) => void;
  onSelectRoom: (roomIndex: number) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}

const fallbackRoom: GalleryRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
  roomCount: 1,
};

const eyeHeight = 1.75;
const wallInset = 0.18;
const wallOrder: GalleryWall[] = ["north", "west", "east", "south"];

function roomOffset(room: GalleryRoomConfig, roomIndex: number) {
  return roomIndex * (room.width + 2.2);
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

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall) {
  return wall === "north" || wall === "south" ? room.width : room.depth;
}

function getWallMount(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0) {
  const xOffset = roomOffset(room, roomIndex);
  const mounts = {
    north: { position: [xOffset, 0, -room.depth / 2 + wallInset], rotation: [0, 0, 0] },
    south: { position: [xOffset, 0, room.depth / 2 - wallInset], rotation: [0, Math.PI, 0] },
    west: { position: [xOffset - room.width / 2 + wallInset, 0, 0], rotation: [0, Math.PI / 2, 0] },
    east: { position: [xOffset + room.width / 2 - wallInset, 0, 0], rotation: [0, -Math.PI / 2, 0] },
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
  return {
    position: [roomOffset(room, wall.roomIndex) + wall.x, 0, wall.z] as [number, number, number],
    rotation: [0, wall.rotation, 0] as [number, number, number],
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
  const wallLength = getWallLength(room, wall);
  const usableLength = Math.max(5, wallLength - 3.6);
  const spacing = Math.max(2.8, usableLength / 3);
  const limit = usableLength / 2;

  return {
    wall: builtWallTarget(roomIndex, wall),
    offset: clamp((slot - 1) * spacing, -limit, limit),
    height: clamp(room.height * 0.48, 2.2, room.height - 1.15),
    width: defaultWidthFor(image),
  };
}

function PlayerMovement({ room }: { room: GalleryRoomConfig }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const verticalVelocity = useRef(0);
  const isGrounded = useRef(true);
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

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
        verticalVelocity.current = 5.4;
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
  }, [camera, gl]);

  useFrame((_, delta) => {
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
      const speed = keys.current.has("ShiftLeft") || keys.current.has("ShiftRight") ? 7.1 : 4.2;

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

    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -room.width / 2 + 1.25,
      roomOffset(room, room.roomCount - 1) + room.width / 2 - 1.25,
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -room.depth / 2 + 1.25,
      room.depth / 2 - 1.25,
    );
  });

  return null;
}

function FirstPersonLookControls({ mode }: { mode: AppMode }) {
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
    const sensitivity = 0.0024;

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
  }, [camera, gl, mode]);

  useEffect(() => {
    if (mode === "edit" && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }
  }, [gl, mode]);

  return null;
}

function EditorCameraControls({ room }: { room: GalleryRoomConfig }) {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3());
  const zoomHeight = useRef(26);
  const isPanning = useRef(false);
  const pointerId = useRef<number | null>(null);

  const applyCamera = () => {
    const center = target.current;
    camera.position.set(center.x, zoomHeight.current, center.z + zoomHeight.current * 0.38);
    camera.lookAt(center.x, 0, center.z);
    camera.updateProjectionMatrix();
  };

  const clampTarget = () => {
    const totalMinX = -room.width / 2 - 2;
    const totalMaxX = roomOffset(room, room.roomCount - 1) + room.width / 2 + 2;

    target.current.x = THREE.MathUtils.clamp(target.current.x, totalMinX, totalMaxX);
    target.current.z = THREE.MathUtils.clamp(
      target.current.z,
      -room.depth / 2 - 2,
      room.depth / 2 + 2,
    );
  };

  useEffect(() => {
    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }

    const centerX = roomOffset(room, room.roomCount - 1) / 2;
    target.current.set(centerX, 0, 0);
    zoomHeight.current = THREE.MathUtils.clamp(
      Math.max(room.width, room.depth, room.roomCount * 8) * 1.25,
      18,
      52,
    );
    camera.rotation.order = "YXZ";
    applyCamera();
  }, [camera, gl, room.depth, room.height, room.roomCount, room.width]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== canvas || event.button !== 0) {
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

function FloorLines({ room }: { room: GalleryRoomConfig }) {
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

function CeilingLights({ room }: { room: GalleryRoomConfig }) {
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

function Baseboards({ room }: { room: GalleryRoomConfig }) {
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

function Room({
  room,
  roomIndex,
  isEditMode,
  isSelected,
  pendingPlacementImageId,
  onSelectRoom,
  onPlaceImageOnWall,
}: {
  room: GalleryRoomConfig;
  roomIndex: number;
  isEditMode: boolean;
  isSelected: boolean;
  pendingPlacementImageId: string | null;
  onSelectRoom: (roomIndex: number) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, roomIndex);
  const placeOnWall = (wall: GalleryWall, event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode || !pendingPlacementImageId) {
      return;
    }

    event.stopPropagation();
    const local = event.object.worldToLocal(event.point.clone());
    onPlaceImageOnWall(
      builtWallTarget(roomIndex, wall),
      local.x,
      clamp(local.y + room.height / 2, 1.1, room.height - 1.1),
    );
  };
  const selectRoom = (event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode) {
      return;
    }

    event.stopPropagation();
    onSelectRoom(roomIndex);
  };

  return (
    <group position={[xOffset, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={selectRoom}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color={isSelected && isEditMode ? "#c5bdab" : "#b9b6aa"} roughness={0.58} metalness={0.04} />
      </mesh>
      {isSelected && isEditMode ? (
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[room.width, 0.035, room.depth]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.16} />
        </mesh>
      ) : null}
      <mesh position={[0, room.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color="#efe9dc" roughness={0.82} />
      </mesh>
      <Wall length={room.width} height={room.height} position={[0, room.height / 2, -room.depth / 2]} onClick={(event) => placeOnWall("north", event)} />
      <Wall length={room.width} height={room.height} position={[0, room.height / 2, room.depth / 2]} rotation={[0, Math.PI, 0]} onClick={(event) => placeOnWall("south", event)} />
      <Wall length={room.depth} height={room.height} position={[-room.width / 2, room.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} onClick={(event) => placeOnWall("west", event)} />
      <Wall length={room.depth} height={room.height} position={[room.width / 2, room.height / 2, 0]} rotation={[0, -Math.PI / 2, 0]} onClick={(event) => placeOnWall("east", event)} />
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.05, 0.04, room.depth]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <mesh position={[0, 0.022, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.05, 0.04, room.width]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <FloorLines room={room} />
      <Baseboards room={room} />
      <CeilingLights room={room} />
    </group>
  );
}

function Wall({
  length,
  height,
  position,
  rotation = [0, 0, 0],
  onClick,
}: {
  length: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <mesh position={position} rotation={rotation} receiveShadow onClick={onClick}>
      <planeGeometry args={[length, height]} />
      <meshStandardMaterial color="#e7e1d3" roughness={0.88} />
    </mesh>
  );
}

function CustomWall({
  wall,
  room,
  isEditMode,
  isSelected,
  editorViewMode,
  pendingPlacementImageId,
  onSelectWall,
  onUpdateCustomWall,
  onPlaceImageOnWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  pendingPlacementImageId: string | null;
  onSelectWall: (id: string) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, wall.roomIndex);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);

  function selectWall() {
    if (isEditMode) {
      onSelectWall(wall.id);
    }
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditMode || !pendingPlacementImageId) {
      selectWall();
      return;
    }

    event.stopPropagation();
    const local = event.object.worldToLocal(event.point.clone());
    onPlaceImageOnWall(wall.id, local.x, clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45));
  }

  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (!isEditMode || pendingPlacementImageId || editorViewMode !== "topdown") {
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
    <group position={[xOffset + wall.x, wall.height / 2, wall.z]} rotation={[0, wall.rotation, 0]}>
      {isSelected ? (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[wall.length + 0.28, wall.height + 0.18, 0.24]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.28} />
        </mesh>
      ) : null}
      <mesh
        onClick={handleClick}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[wall.length, wall.height, 0.18]} />
        <meshStandardMaterial color={isSelected ? "#e7dbc0" : "#ded7c8"} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0, 0.096]}>
        <planeGeometry args={[wall.length, wall.height]} />
        <meshStandardMaterial color="#eee8da" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Door({
  door,
  room,
  customWalls,
  isEditMode,
  isSelected,
  onSelectDoor,
}: {
  door: GalleryDoor;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isEditMode: boolean;
  isSelected: boolean;
  onSelectDoor: (id: string) => void;
}) {
  const builtWall = parseBuiltWallTarget(door.wall);
  const customWall = builtWall
    ? null
    : customWalls.find((wall) => wall.id === door.wall) ?? null;
  const mount = builtWall
    ? getWallMount(room, builtWall.wall, builtWall.roomIndex)
    : customWall
      ? getCustomWallMount(room, customWall)
      : null;

  if (!mount) {
    return null;
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditMode) {
      return;
    }

    event.stopPropagation();
    onSelectDoor(door.id);
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[door.offset, door.height / 2, 0.23]}>
        {isSelected ? (
          <mesh position={[0, 0, -0.018]}>
            <planeGeometry args={[door.width + 0.28, door.height + 0.22]} />
            <meshBasicMaterial color="#f6c453" transparent opacity={0.88} />
          </mesh>
        ) : null}
        <mesh onClick={handleClick}>
          <boxGeometry args={[door.width, door.height, 0.16]} />
          <meshStandardMaterial color="#43372d" roughness={0.66} metalness={0.08} />
        </mesh>
        <mesh position={[door.width * 0.36, 0.04, 0.095]} onClick={handleClick}>
          <sphereGeometry args={[0.055, 12, 12]} />
          <meshStandardMaterial color="#d2b56d" roughness={0.38} metalness={0.42} />
        </mesh>
      </group>
    </group>
  );
}

function Artwork({
  image,
  layout,
  room,
  customWalls,
  isSelected,
  isEditable,
  onSelect,
}: {
  image: GalleryImage;
  layout: GalleryFrameLayout;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isSelected: boolean;
  isEditable: boolean;
  onSelect: () => void;
}) {
  const builtWall = parseBuiltWallTarget(layout.wall);
  const customWall = builtWall
    ? null
    : customWalls.find((wall) => wall.id === layout.wall) ?? null;
  const mount = builtWall
    ? getWallMount(room, builtWall.wall, builtWall.roomIndex)
    : customWall
      ? getCustomWallMount(room, customWall)
      : null;
  const texture = useLoader(THREE.TextureLoader, image.url);
  const aspect = image.width / image.height || 1.42;
  const width = layout.width;
  const height = width / aspect;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

  if (!mount) {
    return null;
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditable) {
      return;
    }

    event.stopPropagation();
    onSelect();
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[layout.offset, layout.height, 0]}>
        {isSelected ? (
          <mesh position={[0, 0, 0.015]}>
            <planeGeometry args={[width + 0.62, height + 0.62]} />
            <meshBasicMaterial color="#f6c453" transparent opacity={0.9} />
          </mesh>
        ) : null}
        <mesh position={[0, 0, 0.05]} castShadow onClick={handleClick}>
          <boxGeometry args={[width + 0.34, height + 0.34, 0.12]} />
          <meshStandardMaterial color="#2f2a22" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0, 0.13]} onClick={handleClick}>
          <planeGeometry args={[width + 0.1, height + 0.1]} />
          <meshStandardMaterial color="#f7f1e4" roughness={0.72} />
        </mesh>
        <mesh position={[0, 0, 0.2]} onClick={handleClick}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 1.35, 0.45]} intensity={0.55} distance={4.2} color="#fff6df" />
      </group>
    </group>
  );
}

function EmptyFrames({ count, room }: { count: number; room: GalleryRoomConfig }) {
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
  pendingPlacementImageId,
  selectedImageId,
  selectedWallId,
  selectedDoorId,
  selectedRoomIndex,
  onSelectImage,
  onSelectWall,
  onSelectDoor,
  onSelectRoom,
  onUpdateCustomWall,
  onPlaceImageOnWall,
}: GallerySceneProps) {
  const isEditMode = mode === "edit";
  const useTopdownEditor = isEditMode && editorViewMode === "topdown";

  return (
    <Canvas
      shadows
      camera={{ fov: 72, position: [0, eyeHeight, 7], near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#151515"]} />
      <fog attach="fog" args={["#151515", 20, 42]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[3, roomConfig.height + 3, 5]} intensity={0.8} castShadow />
      <spotLight
        position={[0, roomConfig.height - 0.35, 0]}
        angle={0.95}
        penumbra={0.6}
        intensity={1.2}
      />
      {Array.from({ length: roomConfig.roomCount }, (_, roomIndex) => (
        <Room
          key={roomIndex}
          room={roomConfig}
          roomIndex={roomIndex}
          isEditMode={isEditMode}
          isSelected={selectedRoomIndex === roomIndex}
          pendingPlacementImageId={pendingPlacementImageId}
          onSelectRoom={onSelectRoom}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {customWalls.map((wall) => (
        <CustomWall
          key={wall.id}
          wall={wall}
          room={roomConfig}
          isEditMode={isEditMode}
          isSelected={selectedWallId === wall.id}
          editorViewMode={editorViewMode}
          pendingPlacementImageId={pendingPlacementImageId}
          onSelectWall={onSelectWall}
          onUpdateCustomWall={onUpdateCustomWall}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {doors.map((door) => (
        <Door
          key={door.id}
          door={door}
          room={roomConfig}
          customWalls={customWalls}
          isEditMode={isEditMode}
          isSelected={selectedDoorId === door.id}
          onSelectDoor={onSelectDoor}
        />
      ))}
      {images.length > 0 ? (
        images.map((image, index) => (
          <Artwork
            key={image.id}
            image={image}
            layout={layouts[image.id] ?? getDefaultLayout(image, index, roomConfig)}
            room={roomConfig}
            customWalls={customWalls}
            isSelected={isEditMode && selectedImageId === image.id}
            isEditable={isEditMode}
            onSelect={() => onSelectImage(image.id)}
          />
        ))
      ) : (
        <EmptyFrames count={6} room={roomConfig} />
      )}
      {useTopdownEditor ? (
        <EditorCameraControls room={roomConfig} />
      ) : (
        <>
          <FirstPersonLookControls mode={mode} />
          <PlayerMovement room={roomConfig} />
        </>
      )}
    </Canvas>
  );
}
