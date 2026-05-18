import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  AppMode,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryWall,
} from "../types";

interface GallerySceneProps {
  images: GalleryImage[];
  layouts: GalleryLayouts;
  mode: AppMode;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
}

const room = {
  width: 18,
  depth: 22,
  height: 5.2,
};

const eyeHeight = 1.75;
const wallInset = 0.16;

const wallMounts = {
  north: { position: [0, 0, -room.depth / 2 + wallInset], rotation: [0, 0, 0] },
  south: { position: [0, 0, room.depth / 2 - wallInset], rotation: [0, Math.PI, 0] },
  west: { position: [-room.width / 2 + wallInset, 0, 0], rotation: [0, Math.PI / 2, 0] },
  east: { position: [room.width / 2 - wallInset, 0, 0], rotation: [0, -Math.PI / 2, 0] },
} satisfies Record<
  GalleryWall,
  {
    position: [number, number, number];
    rotation: [number, number, number];
  }
>;

const defaultLayouts = [
  { wall: "north", offset: -5.8, height: 2.45 },
  { wall: "north", offset: 0, height: 2.45 },
  { wall: "north", offset: 5.8, height: 2.45 },
  { wall: "west", offset: -5.8, height: 2.45 },
  { wall: "west", offset: 0, height: 2.45 },
  { wall: "west", offset: 5.8, height: 2.45 },
  { wall: "east", offset: -5.8, height: 2.45 },
  { wall: "east", offset: 0, height: 2.45 },
  { wall: "east", offset: 5.8, height: 2.45 },
  { wall: "south", offset: -5.8, height: 2.45 },
  { wall: "south", offset: 0, height: 2.45 },
  { wall: "south", offset: 5.8, height: 2.45 },
] satisfies Array<Omit<GalleryFrameLayout, "width">>;

function defaultWidthFor(image: GalleryImage) {
  const aspect = image.width / image.height || 1.42;
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
}

export function getDefaultLayout(image: GalleryImage, index: number): GalleryFrameLayout {
  return {
    ...defaultLayouts[index % defaultLayouts.length],
    width: defaultWidthFor(image),
  };
}

function PlayerMovement() {
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
      if (shouldIgnoreKeyboard(event)) {
        return;
      }

      keys.current.delete(event.code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -7.5, 7.5);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -9.5, 9.5);
  });

  return null;
}

function FirstPersonLookControls({ mode }: { mode: AppMode }) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);
  const isDragging = useRef(false);

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

      if (mode === "edit" && event.target === canvas && event.button === 0) {
        isDragging.current = true;
      }

      if (mode === "view" && event.target === canvas && event.button === 0) {
        requestPointerLock();
      }
    };

    const onPointerUp = () => {
      isDragging.current = false;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        rotateBy(event.movementX, event.movementY);
        return;
      }

      if (mode === "edit" && isDragging.current) {
        rotateBy(event.movementX, event.movementY);
      }
    };

    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
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

function Room() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.78} />
      </mesh>
      <mesh position={[0, room.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color="#f4f0e6" roughness={0.9} />
      </mesh>
      <Wall position={[0, room.height / 2, -room.depth / 2]} />
      <Wall position={[0, room.height / 2, room.depth / 2]} rotation={[0, Math.PI, 0]} />
      <Wall position={[-room.width / 2, room.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Wall position={[room.width / 2, room.height / 2, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.05, 0.04, room.depth]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <mesh position={[0, 0.022, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.05, 0.04, room.width]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
    </group>
  );
}

function Wall({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      <planeGeometry args={[room.width, room.height]} />
      <meshStandardMaterial color="#eee9df" roughness={0.86} />
    </mesh>
  );
}

function Artwork({
  image,
  layout,
  isSelected,
  isEditable,
  onSelect,
}: {
  image: GalleryImage;
  layout: GalleryFrameLayout;
  isSelected: boolean;
  isEditable: boolean;
  onSelect: () => void;
}) {
  const mount = wallMounts[layout.wall];
  const texture = useLoader(THREE.TextureLoader, image.url);
  const aspect = image.width / image.height || 1.42;
  const width = layout.width;
  const height = width / aspect;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

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

function EmptyFrames({ count }: { count: number }) {
  const frames = defaultLayouts.slice(0, count);

  return (
    <>
      {frames.map((layout, index) => {
        const mount = wallMounts[layout.wall];

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
  mode,
  selectedImageId,
  onSelectImage,
}: GallerySceneProps) {
  const isEditMode = mode === "edit";

  return (
    <Canvas
      shadows
      camera={{ fov: 72, position: [0, eyeHeight, 7], near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#151515"]} />
      <fog attach="fog" args={["#151515", 20, 42]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[3, 8, 5]} intensity={1.2} castShadow />
      <spotLight position={[0, 4.85, 0]} angle={0.9} penumbra={0.5} intensity={1.5} />
      <Room />
      {images.length > 0 ? (
        images.map((image, index) => (
          <Artwork
            key={image.id}
            image={image}
            layout={layouts[image.id] ?? getDefaultLayout(image, index)}
            isSelected={isEditMode && selectedImageId === image.id}
            isEditable={isEditMode}
            onSelect={() => onSelectImage(image.id)}
          />
        ))
      ) : (
        <EmptyFrames count={6} />
      )}
      <FirstPersonLookControls mode={mode} />
      <PlayerMovement />
    </Canvas>
  );
}
