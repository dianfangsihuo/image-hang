import { PointerLockControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GalleryImage } from "../types";

interface GallerySceneProps {
  images: GalleryImage[];
}

const room = {
  width: 18,
  depth: 22,
  height: 5.2,
};

const frameSlots = [
  { position: [-5.8, 2.45, -10.84], rotation: [0, 0, 0] },
  { position: [0, 2.45, -10.84], rotation: [0, 0, 0] },
  { position: [5.8, 2.45, -10.84], rotation: [0, 0, 0] },
  { position: [-8.84, 2.45, -5.8], rotation: [0, Math.PI / 2, 0] },
  { position: [-8.84, 2.45, 0], rotation: [0, Math.PI / 2, 0] },
  { position: [-8.84, 2.45, 5.8], rotation: [0, Math.PI / 2, 0] },
  { position: [8.84, 2.45, -5.8], rotation: [0, -Math.PI / 2, 0] },
  { position: [8.84, 2.45, 0], rotation: [0, -Math.PI / 2, 0] },
  { position: [8.84, 2.45, 5.8], rotation: [0, -Math.PI / 2, 0] },
  { position: [-5.8, 2.45, 10.84], rotation: [0, Math.PI, 0] },
  { position: [0, 2.45, 10.84], rotation: [0, Math.PI, 0] },
  { position: [5.8, 2.45, 10.84], rotation: [0, Math.PI, 0] },
] satisfies Array<{
  position: [number, number, number];
  rotation: [number, number, number];
}>;

function PlayerMovement() {
  const { camera } = useThree();
  const keys = useRef(new Set<string>());
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(0, 1.75, 7);

    const onKeyDown = (event: KeyboardEvent) => {
      keys.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [camera]);

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

    if (direction.lengthSq() === 0) {
      return;
    }

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
      .multiplyScalar(4.2 * delta);

    camera.position.add(velocity);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -7.5, 7.5);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -9.5, 9.5);
    camera.position.y = 1.75;
  });

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

function Artwork({ image, slotIndex }: { image: GalleryImage; slotIndex: number }) {
  const slot = frameSlots[slotIndex % frameSlots.length];
  const texture = useLoader(THREE.TextureLoader, image.url);
  const aspect = image.width / image.height || 1.42;
  const width = Math.min(3.4, Math.max(2.15, aspect * 2.15));
  const height = width / aspect;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

  return (
    <group position={slot.position} rotation={slot.rotation}>
      <mesh position={[0, 0, 0.05]} castShadow>
        <boxGeometry args={[width + 0.34, height + 0.34, 0.12]} />
        <meshStandardMaterial color="#2f2a22" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.13]}>
        <planeGeometry args={[width + 0.1, height + 0.1]} />
        <meshStandardMaterial color="#f7f1e4" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0, 0.2]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.35, 0.45]} intensity={0.55} distance={4.2} color="#fff6df" />
    </group>
  );
}

function EmptyFrames({ count }: { count: number }) {
  return (
    <>
      {frameSlots.slice(0, count).map((slot, index) => (
        <group key={index} position={slot.position} rotation={slot.rotation}>
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[2.8, 2.0, 0.12]} />
            <meshStandardMaterial color="#4b4034" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.14]}>
            <planeGeometry args={[2.45, 1.65]} />
            <meshStandardMaterial color="#d8d0c0" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export default function GalleryScene({ images }: GallerySceneProps) {
  return (
    <Canvas
      shadows
      camera={{ fov: 72, position: [0, 1.75, 7], near: 0.1, far: 80 }}
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
          <Artwork key={image.id} image={image} slotIndex={index} />
        ))
      ) : (
        <EmptyFrames count={6} />
      )}
      <PlayerMovement />
      <PointerLockControls selector=".enter-button" />
    </Canvas>
  );
}
