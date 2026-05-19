import {
  DoorOpen,
  Eye,
  Box,
  ImagePlus,
  Loader2,
  Maximize2,
  Move,
  Pencil,
  RotateCcw,
  Ruler,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import GalleryScene, { getDefaultLayout } from "./components/GalleryScene";
import {
  clearStoredImages,
  createGalleryImage,
  isSupabaseConfigured,
  loadStoredImages,
  removeStoredImage,
  revokeImageUrl,
} from "./lib/galleryStorage";
import {
  clearStoredLayouts,
  clearStoredRoomConfig,
  clearStoredCustomWalls,
  clearStoredDoors,
  clearStoredEditorSettings,
  defaultEditorSettings,
  defaultRoomConfig,
  loadStoredCustomWalls,
  loadStoredDoors,
  loadStoredEditorSettings,
  loadStoredLayouts,
  loadStoredRoomConfig,
  saveStoredCustomWalls,
  saveStoredDoors,
  saveStoredEditorSettings,
  saveStoredLayouts,
  saveStoredRoomConfig,
} from "./lib/layoutStorage";
import { createSampleImages } from "./lib/sampleArt";
import type {
  AppMode,
  BuilderPlacementTarget,
  EditorSettings,
  EditorShortcutAction,
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
} from "./types";

type EditableSelection =
  | { type: "artwork"; id: string }
  | { type: "wall"; id: string }
  | { type: "door"; id: string }
  | { type: "room"; roomIndex: number };

const shortcutLabels: Record<EditorShortcutAction, string> = {
  openMarket: "打开组件市场",
  toggleView: "切换视角",
  moveTool: "移动工具",
  rotateTool: "旋转工具",
  scaleTool: "缩放工具",
  nudgeLeft: "向左/降低偏移",
  nudgeRight: "向右/提高偏移",
  nudgeForward: "向前/升高",
  nudgeBackward: "向后/降低",
  rotateLeft: "逆时针旋转",
  rotateRight: "顺时针旋转",
  scaleUp: "放大",
  scaleDown: "缩小",
  grabSelection: "抓取/释放",
  deleteSelection: "删除选中",
};

const shortcutOrder = Object.keys(shortcutLabels) as EditorShortcutAction[];

const wallLabels: Record<GalleryWall, string> = {
  north: "前墙",
  south: "后墙",
  west: "左墙",
  east: "右墙",
};

const builtWallOptions = Object.entries(wallLabels) as Array<[GalleryWall, string]>;
const roomGap = 0.18;
const frameOuterPadding = 0.28;
const frameWallMargin = 0.18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function builtWallTarget(roomIndex: number, wall: GalleryWall): GalleryWallTarget {
  return roomIndex === 0 ? wall : `room-${roomIndex}:${wall}`;
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

function getRoomDimensions(room: GalleryRoomConfig, roomIndex: number): GalleryRoomDimensions {
  return room.rooms?.[roomIndex] ?? {
    width: room.width,
    depth: room.depth,
    height: room.height,
  };
}

function getLinearRoomOffset(room: GalleryRoomConfig, roomIndex: number) {
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
    x: Number.isFinite(dimensions.x) ? dimensions.x ?? 0 : getLinearRoomOffset(room, roomIndex),
    z: Number.isFinite(dimensions.z) ? dimensions.z ?? 0 : 0,
  };
}

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0) {
  const dimensions = getRoomDimensions(room, roomIndex);
  return wall === "north" || wall === "south" ? dimensions.width : dimensions.depth;
}

function getWallTargetLength(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  const built = parseBuiltWallTarget(target);

  if (built) {
    return getWallLength(room, built.wall, built.roomIndex);
  }

  return parseCustomWallTarget(target, customWalls)?.wall.length ?? room.width;
}

function getWallTargetHeight(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  const built = parseBuiltWallTarget(target);

  if (built) {
    return getRoomDimensions(room, built.roomIndex).height;
  }

  return parseCustomWallTarget(target, customWalls)?.wall.height ?? room.height;
}

function getWallOffsetLimit(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  return Math.max(2.2, getWallTargetLength(room, customWalls, target) / 2 - 1.8);
}

function getDefaultFrameWidth(image: GalleryImage) {
  const aspect = getImageAspect(image);
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
}

function getImageAspect(image: GalleryImage) {
  const aspect = image.width / image.height;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1.42;
}

function getFrameLayoutConstraints(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  wall: GalleryWallTarget,
  image: GalleryImage,
) {
  const aspect = getImageAspect(image);
  const wallLength = getWallTargetLength(room, customWalls, wall);
  const wallHeight = getWallTargetHeight(room, customWalls, wall);
  const maxByLength = Math.max(0.7, wallLength - frameOuterPadding - frameWallMargin * 2);
  const maxByHeight = Math.max(0.7, (wallHeight - frameOuterPadding - frameWallMargin * 2) * aspect);
  const maxWidth = Math.max(0.65, Math.min(5, maxByLength, maxByHeight));
  const minWidth = Math.min(1.2, maxWidth);

  return {
    aspect,
    minWidth,
    maxWidth,
  };
}

function normalizeFrameLayout(
  image: GalleryImage,
  layout: GalleryFrameLayout,
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
) {
  const constraints = getFrameLayoutConstraints(room, customWalls, layout.wall, image);
  const width = clamp(layout.width, constraints.minWidth, constraints.maxWidth);
  const artworkHeight = width / constraints.aspect;
  const frameOuterWidth = width + frameOuterPadding;
  const frameOuterHeight = artworkHeight + frameOuterPadding;
  const wallLength = getWallTargetLength(room, customWalls, layout.wall);
  const wallHeight = getWallTargetHeight(room, customWalls, layout.wall);
  const offsetLimit = Math.max(0, wallLength / 2 - frameOuterWidth / 2 - frameWallMargin);
  const minHeight = Math.min(
    wallHeight / 2,
    frameOuterHeight / 2 + frameWallMargin,
  );
  const maxHeight = Math.max(
    minHeight,
    wallHeight - frameOuterHeight / 2 - frameWallMargin,
  );

  return {
    ...layout,
    offset: clamp(layout.offset, -offsetLimit, offsetLimit),
    height: clamp(layout.height, minHeight, maxHeight),
    width,
  };
}

function layoutChanged(a: GalleryFrameLayout, b: GalleryFrameLayout) {
  return (
    a.wall !== b.wall ||
    Math.abs(a.offset - b.offset) > 0.001 ||
    Math.abs(a.height - b.height) > 0.001 ||
    Math.abs(a.width - b.width) > 0.001
  );
}

function formatKeyCode(code: string) {
  if (code.startsWith("Key")) {
    return code.slice(3);
  }

  if (code.startsWith("Digit")) {
    return code.slice(5);
  }

  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
  }

  const labels: Record<string, string> = {
    Equal: "+",
    Minus: "-",
    Space: "Space",
    Delete: "Del",
    Backspace: "Backspace",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ShiftLeft: "L Shift",
    ShiftRight: "R Shift",
  };

  return labels[code] ?? code;
}

function clampSetting(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getRoomList(config: GalleryRoomConfig, count = config.roomCount) {
  return Array.from({ length: count }, (_, index) => getRoomDimensions(config, index));
}

function calculateGalleryCapacity(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  images: GalleryImage[],
  layouts: GalleryLayouts,
) {
  const horizontalGap = 0.7;
  const verticalGap = 0.55;
  const averageWidth =
    images.length > 0
      ? images.reduce(
          (sum, image) => sum + (layouts[image.id]?.width ?? getDefaultFrameWidth(image)),
          0,
        ) / images.length
      : 3;
  const averageAspect =
    images.length > 0
      ? images.reduce((sum, image) => sum + getImageAspect(image), 0) / images.length
      : 1.42;
  const averageHeight = averageWidth / averageAspect;
  const builtinTargets = Array.from({ length: room.roomCount }, (_, roomIndex) =>
    builtWallOptions.map(([wall]) => builtWallTarget(roomIndex, wall)),
  ).flat();
  const allTargets = [
    ...builtinTargets,
    ...customWalls.flatMap((wall) => [wall.id, customWallBackTarget(wall.id)]),
  ];

  return allTargets.reduce((total, target) => {
    const usableLength = Math.max(0, getWallTargetLength(room, customWalls, target) - 2.4);
    const usableHeight = Math.max(0, getWallTargetHeight(room, customWalls, target) - 1.4 - 0.85);
    const rows = Math.max(
      1,
      Math.floor((usableHeight + verticalGap) / (averageHeight + verticalGap)),
    );
    const columns = Math.max(
      0,
      Math.floor((usableLength + horizontalGap) / (averageWidth + horizontalGap)),
    );

    return total + columns * rows;
  }, 0);
}

function App() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [layouts, setLayouts] = useState<GalleryLayouts>(() => loadStoredLayouts());
  const [roomConfig, setRoomConfig] = useState<GalleryRoomConfig>(() => loadStoredRoomConfig());
  const [customWalls, setCustomWalls] = useState<GalleryCustomWall[]>(() =>
    loadStoredCustomWalls(),
  );
  const [doors, setDoors] = useState<GalleryDoor[]>(() => loadStoredDoors());
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [selectedObject, setSelectedObject] = useState<EditableSelection | null>(null);
  const [transformTool, setTransformTool] = useState<EditorTransformTool>("move");
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() =>
    loadStoredEditorSettings(),
  );
  const [capturingShortcut, setCapturingShortcut] = useState<EditorShortcutAction | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGrabActive, setIsGrabActive] = useState(false);
  const [aimTargetLabel, setAimTargetLabel] = useState<string | null>(null);
  const [builderPlacement, setBuilderPlacement] = useState<BuilderPlacementTarget | null>(null);
  const [isComponentMarketOpen, setIsComponentMarketOpen] = useState(false);
  const [pendingPlacementIds, setPendingPlacementIds] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>("view");
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>("topdown");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<GalleryImage[]>([]);
  const samples = useMemo(() => createSampleImages(), []);
  const sceneImages = images.length > 0 ? images : samples;
  const placedSceneImages = sceneImages.filter(
    (image) => !pendingPlacementIds.includes(image.id) || layouts[image.id],
  );
  const selectedIndex = sceneImages.findIndex((image) => image.id === selectedImageId);
  const selectedImage = selectedIndex >= 0 ? sceneImages[selectedIndex] : undefined;
  const selectedLayout =
    selectedImage &&
    normalizeFrameLayout(
      selectedImage,
      layouts[selectedImage.id] ??
        getDefaultLayout(selectedImage, Math.max(selectedIndex, 0), roomConfig),
      roomConfig,
      customWalls,
    );
  const selectedLayoutConstraints =
    selectedImage && selectedLayout
      ? getFrameLayoutConstraints(roomConfig, customWalls, selectedLayout.wall, selectedImage)
      : null;
  const capacity = useMemo(
    () => calculateGalleryCapacity(roomConfig, customWalls, sceneImages, layouts),
    [customWalls, layouts, roomConfig, sceneImages],
  );
  const remainingCapacity = Math.max(0, capacity - sceneImages.length);
  const supabaseReady = isSupabaseConfigured();

  function switchMode(nextMode: AppMode) {
    setMode(nextMode);

    if (nextMode === "view") {
      setSelectedImageId(null);
      setSelectedWallId(null);
      setSelectedDoorId(null);
      setSelectedObject(null);
      setIsGrabActive(false);
    }
  }

  function selectArtwork(id: string) {
    setSelectedObject({ type: "artwork", id });
    setSelectedImageId(id);
    setSelectedWallId(null);
    setSelectedDoorId(null);
  }

  function selectWall(id: string) {
    setSelectedObject({ type: "wall", id });
    setSelectedWallId(id);
    setSelectedImageId(null);
    setSelectedDoorId(null);
  }

  function selectDoor(id: string) {
    setSelectedObject({ type: "door", id });
    setSelectedDoorId(id);
    setSelectedImageId(null);
    setSelectedWallId(null);
  }

  function selectRoom(roomIndex: number) {
    setSelectedObject({ type: "room", roomIndex });
    setSelectedRoomIndex(roomIndex);
    setSelectedImageId(null);
    setSelectedWallId(null);
    setSelectedDoorId(null);
  }

  useEffect(() => {
    let isMounted = true;

    void loadStoredImages()
      .then((storedImages) => {
        if (isMounted) {
          setImages(storedImages);
        } else {
          storedImages.forEach(revokeImageUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setMessage("读取本地画廊失败");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    saveStoredLayouts(layouts);
  }, [layouts]);

  useEffect(() => {
    saveStoredRoomConfig(roomConfig);
  }, [roomConfig]);

  useEffect(() => {
    saveStoredCustomWalls(customWalls);
  }, [customWalls]);

  useEffect(() => {
    saveStoredDoors(doors);
  }, [doors]);

  useEffect(() => {
    saveStoredEditorSettings(editorSettings);
  }, [editorSettings]);

  useEffect(() => {
    if (sceneImages.length === 0) {
      return;
    }

    setLayouts((current) => {
      let changed = false;
      const next = { ...current };

      sceneImages.forEach((image) => {
        const currentLayout = current[image.id];
        if (!currentLayout) {
          return;
        }

        const normalized = normalizeFrameLayout(image, currentLayout, roomConfig, customWalls);

        if (layoutChanged(currentLayout, normalized)) {
          changed = true;
          next[image.id] = normalized;
        }
      });

      return changed ? next : current;
    });
  }, [customWalls, roomConfig, sceneImages]);

  useEffect(() => {
    if (mode !== "edit" || editorViewMode !== "firstPerson" || transformTool !== "move") {
      setIsGrabActive(false);
    }
  }, [editorViewMode, mode, transformTool]);

  useEffect(() => {
    if (!selectedObject) {
      setIsGrabActive(false);
    }
  }, [selectedObject]);

  useEffect(() => {
    if (mode !== "edit" || editorViewMode !== "firstPerson") {
      setAimTargetLabel(null);
    }
  }, [editorViewMode, mode]);

  useEffect(() => {
    if (mode !== "edit") {
      setIsComponentMarketOpen(false);
    }
  }, [mode]);

  useEffect(() => {
    setSelectedRoomIndex((current) => clamp(Math.round(current), 0, roomConfig.roomCount - 1));
  }, [roomConfig.roomCount]);

  useEffect(() => {
    if (selectedObject?.type === "artwork" && !sceneImages.some((image) => image.id === selectedObject.id)) {
      setSelectedObject(null);
      setSelectedImageId(null);
    }
  }, [sceneImages, selectedObject]);

  useEffect(
    () => () => {
      imagesRef.current.forEach(revokeImageUrl);
    },
    [],
  );

  async function handleFiles(files: FileList | null) {
    const fileArray = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (fileArray.length === 0) {
      setMessage("请选择图片文件");
      return;
    }

    setIsUploading(true);
    setMessage("");

    try {
      const results = await Promise.all(fileArray.map(createGalleryImage));
      const uploadedImages = results.map((result) => result.image);
      setImages((current) => [...uploadedImages, ...current]);
      if (uploadedImages[0]) {
        selectArtwork(uploadedImages[0].id);
      }
      const warning = results.find((result) => result.warning)?.warning;

      if (mode === "edit") {
        setPendingPlacementIds((current) => [...current, ...uploadedImages.map((image) => image.id)]);
        setMessage(warning ?? `已导入 ${results.length} 张图片，请点击墙面指定挂画位置`);
      } else {
        setMessage(warning ?? `已添加 ${results.length} 张图片`);
      }
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : "图片处理失败，请换一张图片试试";
      setMessage(fallback);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function removeImage(id: string) {
    const image = images.find((item) => item.id === id);
    setImages((current) => current.filter((item) => item.id !== id));
    if (image) {
      revokeImageUrl(image);
    }
    await removeStoredImage(id);
    setLayouts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function resetGallery() {
    const previousImages = images;
    await clearStoredImages();
    clearStoredLayouts();
    clearStoredRoomConfig();
    clearStoredCustomWalls();
    clearStoredDoors();
    clearStoredEditorSettings();
    previousImages.forEach(revokeImageUrl);
    setImages([]);
    setLayouts({});
    setRoomConfig(defaultRoomConfig);
    setCustomWalls([]);
    setDoors([]);
    setPendingPlacementIds([]);
    setSelectedImageId(null);
    setSelectedWallId(null);
    setSelectedDoorId(null);
    setSelectedRoomIndex(0);
    setSelectedObject(null);
    setEditorSettings(defaultEditorSettings);
    setCapturingShortcut(null);
    setIsGrabActive(false);
    setMessage("已恢复示例画廊");
  }

  function updateSelectedLayout(patch: Partial<GalleryFrameLayout>) {
    if (!selectedImage || !selectedLayout) {
      return;
    }

    updateImageLayout(selectedImage.id, patch);
  }

  function updateImageLayout(id: string, patch: Partial<GalleryFrameLayout>) {
    const imageIndex = sceneImages.findIndex((image) => image.id === id);
    const image = imageIndex >= 0 ? sceneImages[imageIndex] : undefined;

    if (!image) {
      return;
    }

    setLayouts((current) => {
      const currentLayout =
        current[id] ?? layouts[id] ?? getDefaultLayout(image, Math.max(imageIndex, 0), roomConfig);
      const wall = patch.wall ?? currentLayout.wall;
      const nextLayout = normalizeFrameLayout(
        image,
        {
          ...currentLayout,
          ...patch,
          wall,
        },
        roomConfig,
        customWalls,
      );

      return {
        ...current,
        [id]: nextLayout,
      };
    });
  }

  function updateRoomConfig(patch: Partial<GalleryRoomConfig & GalleryRoomDimensions>) {
    setRoomConfig((current) => {
      const roomCount = Math.round(clamp(patch.roomCount ?? current.roomCount, 1, 5));
      const rooms = getRoomList(current, roomCount).map((room, index) => {
        if (index !== selectedRoomIndex || patch.roomCount !== undefined) {
          return room;
        }

        return {
          width: clamp(patch.width ?? room.width, 4, 40),
          depth: clamp(patch.depth ?? room.depth, 6, 48),
          height: clamp(patch.height ?? room.height, 3.2, 9),
          x: clamp(patch.x ?? room.x ?? getLinearRoomOffset(current, index), -80, 80),
          z: clamp(patch.z ?? room.z ?? 0, -80, 80),
        };
      });
      const next = {
        width: rooms[0]?.width ?? current.width,
        depth: rooms[0]?.depth ?? current.depth,
        height: rooms[0]?.height ?? current.height,
        roomCount,
        rooms,
      };

      setLayouts((currentLayouts) =>
        Object.fromEntries(
          Object.entries(currentLayouts).map(([id, layout]) => {
            const image = sceneImages.find((item) => item.id === id);
            const normalized = image
              ? normalizeFrameLayout(image, layout, next, customWalls)
              : layout;

            return [
              id,
              normalized,
            ];
          }),
        ),
      );

      setCustomWalls((currentWalls) =>
        currentWalls.map((wall) => {
          const roomIndex = Math.min(wall.roomIndex, next.roomCount - 1);
          const dimensions = getRoomDimensions(next, roomIndex);

          return {
            ...wall,
            roomIndex,
            x: clamp(wall.x, -dimensions.width / 2 + 1, dimensions.width / 2 - 1),
            z: clamp(wall.z, -dimensions.depth / 2 + 1, dimensions.depth / 2 - 1),
            length: clamp(wall.length, 2, dimensions.width - 0.6),
            height: clamp(wall.height, 2.2, dimensions.height - 0.35),
          };
        }),
      );
      setDoors((currentDoors) =>
        currentDoors.map((door) => ({
          ...door,
          roomIndex: Math.min(door.roomIndex, next.roomCount - 1),
          offset: clamp(
            door.offset,
            -getWallOffsetLimit(next, customWalls, door.wall),
            getWallOffsetLimit(next, customWalls, door.wall),
          ),
          height: clamp(door.height, 1.9, getWallTargetHeight(next, customWalls, door.wall) - 0.5),
        })),
      );

      return next;
    });
  }

  function updateRoom(roomIndex: number, patch: Partial<GalleryRoomDimensions>) {
    setRoomConfig((current) => {
      const rooms = getRoomList(current).map((room, index) =>
        index === roomIndex
          ? {
              ...room,
              ...patch,
              width: clamp(patch.width ?? room.width, 4, 40),
              depth: clamp(patch.depth ?? room.depth, 6, 48),
              height: clamp(patch.height ?? room.height, 3.2, 9),
              x: clamp(patch.x ?? room.x ?? getLinearRoomOffset(current, index), -80, 80),
              z: clamp(patch.z ?? room.z ?? 0, -80, 80),
            }
          : room,
      );
      const first = rooms[0] ?? getRoomDimensions(current, 0);

      return {
        ...current,
        width: first.width,
        depth: first.depth,
        height: first.height,
        rooms,
      };
    });
  }

  function getWallOptions() {
    const builtin = Array.from({ length: roomConfig.roomCount }, (_, roomIndex) =>
      builtWallOptions.map(([wall, label]) => [
        builtWallTarget(roomIndex, wall),
        roomIndex === 0 ? label : `房间 ${roomIndex + 1} ${label}`,
      ] as [GalleryWallTarget, string]),
    ).flat();

    return [
      ...builtin,
      ...customWalls.flatMap((wall) => [
        [wall.id, `${wall.name} 正面`] as [GalleryWallTarget, string],
        [customWallBackTarget(wall.id), `${wall.name} 背面`] as [GalleryWallTarget, string],
      ]),
    ];
  }

  function getBuilderPlacement() {
    const roomIndex = clamp(
      Math.round(builderPlacement?.roomIndex ?? selectedRoomIndex),
      0,
      roomConfig.roomCount - 1,
    );
    const dimensions = getRoomDimensions(roomConfig, roomIndex);

    return {
      roomIndex,
      x: clamp(builderPlacement?.x ?? 0, -dimensions.width / 2 + 1, dimensions.width / 2 - 1),
      z: clamp(builderPlacement?.z ?? 0, -dimensions.depth / 2 + 1, dimensions.depth / 2 - 1),
      wall: builderPlacement?.wall,
      wallOffset: builderPlacement?.wallOffset,
    };
  }

  function closeComponentMarket() {
    setIsComponentMarketOpen(false);
  }

  function openComponentMarket() {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    setIsComponentMarketOpen(true);
  }

  function toggleComponentMarket() {
    setIsComponentMarketOpen((current) => {
      if (current) {
        return false;
      }

      if (document.pointerLockElement) {
        document.exitPointerLock();
      }

      return true;
    });
  }

  function addRoom() {
    if (roomConfig.roomCount >= 5) {
      setMessage("最多支持 5 个房间");
      closeComponentMarket();
      return;
    }

    const nextRoomNumber = roomConfig.roomCount + 1;
    setRoomConfig((current) => {
      const template = getRoomDimensions(current, selectedRoomIndex);
      const rooms = getRoomList(current);
      const lastIndex = rooms.length - 1;
      const lastRoom = rooms[lastIndex] ?? template;
      const lastCenter = getRoomCenter(current, Math.max(0, lastIndex));

      return {
        ...current,
        roomCount: Math.round(clamp(current.roomCount + 1, 1, 5)),
        rooms: [
          ...rooms,
          {
            width: template.width,
            depth: template.depth,
            height: template.height,
            x: lastCenter.x + lastRoom.width / 2 + template.width / 2 + roomGap,
            z: template.z ?? 0,
          },
        ],
      };
    });
    selectRoom(roomConfig.roomCount);
    closeComponentMarket();
    setMessage(`已新增房间 ${nextRoomNumber}`);
  }

  function deleteRoom(roomIndex: number) {
    if (roomConfig.roomCount <= 1) {
      setMessage("至少需要保留一个房间");
      return;
    }

    const removedWallIds = customWalls
      .filter((wall) => wall.roomIndex === roomIndex)
      .flatMap((wall) => [wall.id, customWallBackTarget(wall.id)]);
    const removedWallIdSet = new Set(removedWallIds);

    setLayouts((currentLayouts) =>
      Object.fromEntries(
        Object.entries(currentLayouts).flatMap(([id, layout]) => {
          const built = parseBuiltWallTarget(layout.wall);

          if (built) {
            if (built.roomIndex === roomIndex) {
              return [];
            }

            return [
              [
                id,
                {
                  ...layout,
                  wall: builtWallTarget(
                    built.roomIndex > roomIndex ? built.roomIndex - 1 : built.roomIndex,
                    built.wall,
                  ),
                },
              ],
            ];
          }

          if (removedWallIdSet.has(layout.wall)) {
            return [];
          }

          return [[id, layout]];
        }),
      ),
    );
    setCustomWalls((current) =>
      current
        .filter((wall) => wall.roomIndex !== roomIndex)
        .map((wall) => ({
          ...wall,
          roomIndex: wall.roomIndex > roomIndex ? wall.roomIndex - 1 : wall.roomIndex,
        })),
    );
    setDoors((current) =>
      current
        .filter((door) => door.roomIndex !== roomIndex && !removedWallIdSet.has(door.wall))
        .map((door) => ({
          ...door,
          roomIndex: door.roomIndex > roomIndex ? door.roomIndex - 1 : door.roomIndex,
          connectsToRoomIndex:
            door.connectsToRoomIndex === null || door.connectsToRoomIndex === undefined
              ? door.connectsToRoomIndex
              : door.connectsToRoomIndex === roomIndex
                ? null
                : door.connectsToRoomIndex > roomIndex
                  ? door.connectsToRoomIndex - 1
                  : door.connectsToRoomIndex,
          wall: parseBuiltWallTarget(door.wall)
            ? builtWallTarget(
                Math.max(0, door.roomIndex > roomIndex ? door.roomIndex - 1 : door.roomIndex),
                parseBuiltWallTarget(door.wall)?.wall ?? "north",
              )
            : door.wall,
        })),
    );
    setRoomConfig((current) => {
      const rooms = getRoomList(current).filter((_, index) => index !== roomIndex);
      const fallback = rooms[0] ?? getRoomDimensions(current, 0);

      return {
        width: fallback.width,
        depth: fallback.depth,
        height: fallback.height,
        roomCount: Math.max(1, rooms.length),
        rooms: rooms.length > 0 ? rooms : [fallback],
      };
    });
    selectRoom(Math.max(0, Math.min(roomIndex, roomConfig.roomCount - 2)));
    setMessage(`已删除房间 ${roomIndex + 1}`);
  }

  function addCustomWall() {
    const placement = getBuilderPlacement();
    const dimensions = getRoomDimensions(roomConfig, placement.roomIndex);
    const wall: GalleryCustomWall = {
      id: `wall-${crypto.randomUUID()}`,
      name: `自定义墙 ${customWalls.length + 1}`,
      roomIndex: placement.roomIndex,
      x: placement.x,
      z: placement.z,
      length: Math.min(7, dimensions.width - 0.6),
      height: Math.min(dimensions.height - 0.3, 4.8),
      rotation: 0,
    };

    setCustomWalls((current) => [...current, wall]);
    selectWall(wall.id);
    closeComponentMarket();
    setMessage(`已新增 ${wall.name}`);
  }

  function updateCustomWall(id: string, patch: Partial<GalleryCustomWall>) {
    setCustomWalls((current) =>
      current.map((wall) =>
        wall.id === id
          ? {
              ...wall,
              ...patch,
              roomIndex: Math.round(clamp(patch.roomIndex ?? wall.roomIndex, 0, roomConfig.roomCount - 1)),
              x: clamp(
                patch.x ?? wall.x,
                -getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).width / 2 + 1,
                getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).width / 2 - 1,
              ),
              z: clamp(
                patch.z ?? wall.z,
                -getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).depth / 2 + 1,
                getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).depth / 2 - 1,
              ),
              length: clamp(
                patch.length ?? wall.length,
                2,
                getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).width - 0.6,
              ),
              height: clamp(
                patch.height ?? wall.height,
                2.2,
                getRoomDimensions(roomConfig, patch.roomIndex ?? wall.roomIndex).height - 0.35,
              ),
              rotation: patch.rotation ?? wall.rotation,
            }
          : wall,
      ),
    );
  }

  function deleteCustomWall(id: string) {
    const backId = customWallBackTarget(id);

    setCustomWalls((current) => current.filter((wall) => wall.id !== id));
    setDoors((current) => current.filter((door) => door.wall !== id && door.wall !== backId));
    setLayouts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, layout]) => layout.wall !== id && layout.wall !== backId),
      ),
    );
    setSelectedObject(null);
    setSelectedWallId(null);
    setMessage("已删除自定义墙壁");
  }

  function getDoorRoomIndex(wall: GalleryWallTarget) {
    const built = parseBuiltWallTarget(wall);

    if (built) {
      return built.roomIndex;
    }

    return parseCustomWallTarget(wall, customWalls)?.wall.roomIndex ?? selectedRoomIndex;
  }

  function addDoor() {
    const placement = getBuilderPlacement();
    const wall = placement.wall ?? selectedWallId ?? builtWallTarget(placement.roomIndex, "north");
    const wallHeight = getWallTargetHeight(roomConfig, customWalls, wall);
    const door: GalleryDoor = {
      id: `door-${crypto.randomUUID()}`,
      name: `门 ${doors.length + 1}`,
      roomIndex: getDoorRoomIndex(wall),
      wall,
      offset: placement.wallOffset ?? 0,
      width: 1.55,
      height: Math.min(2.35, wallHeight - 0.6),
      isOpen: false,
      connectsToRoomIndex: roomConfig.roomCount > 1 ? (placement.roomIndex + 1) % roomConfig.roomCount : null,
    };

    setDoors((current) => [...current, door]);
    selectDoor(door.id);
    closeComponentMarket();
    setMessage(`已新增 ${door.name}`);
  }

  function updateDoor(id: string, patch: Partial<GalleryDoor>) {
    setDoors((current) =>
      current.map((door) => {
        if (door.id !== id) {
          return door;
        }

        const wall = patch.wall ?? door.wall;
        const roomIndex = getDoorRoomIndex(wall);
        const limit = getWallOffsetLimit(roomConfig, customWalls, wall);
        const wallHeight = getWallTargetHeight(roomConfig, customWalls, wall);

        return {
          ...door,
          ...patch,
          wall,
          roomIndex,
          offset: clamp(patch.offset ?? door.offset, -limit, limit),
          width: clamp(patch.width ?? door.width, 0.8, 3.2),
          height: clamp(patch.height ?? door.height, 1.8, wallHeight - 0.4),
          connectsToRoomIndex:
            patch.connectsToRoomIndex === undefined
              ? door.connectsToRoomIndex
              : patch.connectsToRoomIndex === null
                ? null
                : Math.round(clamp(patch.connectsToRoomIndex, 0, roomConfig.roomCount - 1)),
        };
      }),
    );
  }

  function toggleDoor(id: string) {
    setDoors((current) =>
      current.map((door) => (door.id === id ? { ...door, isOpen: !door.isOpen } : door)),
    );
  }

  function deleteDoor(id: string) {
    setDoors((current) => current.filter((door) => door.id !== id));
    setSelectedObject(null);
    setSelectedDoorId(null);
    setMessage("已删除门");
  }

  function deleteSelectedObject() {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "wall") {
      deleteCustomWall(selectedObject.id);
      return;
    }

    if (selectedObject.type === "door") {
      deleteDoor(selectedObject.id);
      return;
    }

    if (selectedObject.type === "room") {
      deleteRoom(selectedObject.roomIndex);
      return;
    }

    if (selectedObject.type === "artwork") {
      void removeImage(selectedObject.id);
      setSelectedObject(null);
      setSelectedImageId(null);
    }
  }

  function nudgeSelectedObject(axis: "x" | "z" | "height", amount: number) {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "artwork" && selectedLayout) {
      updateSelectedLayout(
        axis === "height"
          ? { height: selectedLayout.height + amount }
          : { offset: selectedLayout.offset + amount },
      );
      return;
    }

    if (selectedObject.type === "door" && selectedDoor) {
      updateDoor(
        selectedDoor.id,
        axis === "height"
          ? { height: selectedDoor.height + amount }
          : { offset: selectedDoor.offset + amount },
      );
      return;
    }

    if (selectedObject.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, {
        x: selectedWall.x + (axis === "x" ? amount : 0),
        z: selectedWall.z + (axis === "z" ? amount : 0),
      });
      return;
    }

    if (selectedObject.type === "room") {
      if (transformTool === "move") {
        const room = getRoomDimensions(roomConfig, selectedObject.roomIndex);
        updateRoom(selectedObject.roomIndex, {
          x: (room.x ?? getLinearRoomOffset(roomConfig, selectedObject.roomIndex)) +
            (axis === "x" ? amount : 0),
          z: (room.z ?? 0) + (axis === "z" ? amount : 0),
        });
        return;
      }

      updateRoomConfig(
        axis === "z"
          ? { depth: roomConfig.depth + amount }
          : axis === "height"
            ? { height: roomConfig.height + amount }
            : { width: roomConfig.width + amount },
      );
    }
  }

  function scaleSelectedObject(amount: number) {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "artwork" && selectedLayout) {
      updateSelectedLayout({ width: selectedLayout.width + amount });
      return;
    }

    if (selectedObject.type === "door" && selectedDoor) {
      updateDoor(selectedDoor.id, { width: selectedDoor.width + amount });
      return;
    }

    if (selectedObject.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, { length: selectedWall.length + amount });
      return;
    }

    if (selectedObject.type === "room") {
      updateRoomConfig({
        width: roomConfig.width + amount,
        depth: roomConfig.depth + amount,
      });
    }
  }

  function rotateSelectedObject(amount: number) {
    if (selectedObject?.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, { rotation: selectedWall.rotation + amount });
    }
  }

  function updateEditorSetting<K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) {
    setEditorSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function bindShortcut(action: EditorShortcutAction, code: string) {
    setEditorSettings((current) => ({
      ...current,
      shortcuts: {
        ...current.shortcuts,
        [action]: code,
      },
    }));
  }

  function placePendingImage(wall: GalleryWallTarget, offset: number, height: number) {
    const imageId = pendingPlacementIds[0];

    if (!imageId) {
      return;
    }

    const image = images.find((item) => item.id === imageId);
    if (!image) {
      return;
    }

    const layout = normalizeFrameLayout(
      image,
      {
        wall,
        offset,
        height,
        width: getDefaultFrameWidth(image),
      },
      roomConfig,
      customWalls,
    );

    setLayouts((current) => ({
      ...current,
      [imageId]: layout,
    }));
    setPendingPlacementIds((current) => current.slice(1));
    selectArtwork(imageId);
    setMessage(pendingPlacementIds.length > 1 ? "已放置图片，请继续点击墙面" : "图片已挂到墙面");
  }

  const wallOptions = getWallOptions();
  const selectedWall = selectedWallId
    ? customWalls.find((wall) => wall.id === selectedWallId)
    : undefined;
  const selectedDoor = selectedDoorId ? doors.find((door) => door.id === selectedDoorId) : undefined;
  const selectedRoomLabel = `房间 ${selectedRoomIndex + 1}`;
  const selectedRoomDimensions = getRoomDimensions(roomConfig, selectedRoomIndex);
  const selectedWallRoomDimensions = selectedWall
    ? getRoomDimensions(roomConfig, selectedWall.roomIndex)
    : selectedRoomDimensions;
  const builderPlacementSummary = builderPlacement
    ? builderPlacement.wall
      ? `${builderPlacement.label ?? "墙面"} · 偏移 ${(builderPlacement.wallOffset ?? 0).toFixed(1)}`
      : `房间 ${builderPlacement.roomIndex + 1} · X ${builderPlacement.x.toFixed(1)} · Z ${builderPlacement.z.toFixed(1)}`
    : `房间 ${selectedRoomIndex + 1} · 默认位置`;

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (capturingShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (event.code !== "Escape") {
          bindShortcut(capturingShortcut, event.code);
        }

        setCapturingShortcut(null);
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const isTyping = Boolean(target?.closest("input, textarea, select"));
      const isPointerLocked = document.pointerLockElement !== null;
      const isFirstPersonMovementKey =
        editorViewMode === "firstPerson" &&
        isPointerLocked &&
        ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(event.code);

      if (isTyping && !isPointerLocked) {
        return;
      }

      if (isFirstPersonMovementKey) {
        return;
      }

      const shortcutEntry = Object.entries(editorSettings.shortcuts).find(
        ([, code]) => code === event.code,
      ) as [EditorShortcutAction, string] | undefined;

      if (!shortcutEntry) {
        if (event.code === "Escape") {
          setIsComponentMarketOpen(false);
        }
        return;
      }

      const action = shortcutEntry[0];
      event.preventDefault();
      event.stopImmediatePropagation();

      if (action === "openMarket") {
        toggleComponentMarket();
        return;
      }

      if (action === "moveTool") {
        setTransformTool("move");
        return;
      }

      if (action === "rotateTool") {
        setTransformTool("rotate");
        return;
      }

      if (action === "scaleTool") {
        setTransformTool("scale");
        return;
      }

      if (action === "toggleView") {
        setEditorViewMode((current) => (current === "topdown" ? "firstPerson" : "topdown"));
        return;
      }

      if (action === "deleteSelection") {
        deleteSelectedObject();
        return;
      }

      if (action === "grabSelection") {
        if (selectedObject && editorViewMode === "firstPerson") {
          setTransformTool("move");
          setIsGrabActive((current) => !current);
        }
        return;
      }

      if (action === "rotateLeft") {
        rotateSelectedObject(-0.08);
        return;
      }

      if (action === "rotateRight") {
        rotateSelectedObject(0.08);
        return;
      }

      if (action === "nudgeLeft") {
        nudgeSelectedObject("x", -0.2);
        return;
      }

      if (action === "nudgeRight") {
        nudgeSelectedObject("x", 0.2);
        return;
      }

      if (action === "nudgeForward") {
        nudgeSelectedObject(selectedObject?.type === "wall" || selectedObject?.type === "room" ? "z" : "height", 0.2);
        return;
      }

      if (action === "nudgeBackward") {
        nudgeSelectedObject(selectedObject?.type === "wall" || selectedObject?.type === "room" ? "z" : "height", -0.2);
        return;
      }

      if (action === "scaleUp") {
        scaleSelectedObject(0.2);
        return;
      }

      if (action === "scaleDown") {
        scaleSelectedObject(-0.2);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    mode,
    selectedObject,
    selectedLayout,
    selectedDoor,
    selectedWall,
    roomConfig,
    selectedRoomIndex,
    editorSettings.shortcuts,
    capturingShortcut,
    editorViewMode,
    transformTool,
  ]);

  return (
    <main className={`app-shell ${mode}-shell`}>
      <section className="gallery-stage" aria-label="3D gallery viewport">
        <GalleryScene
          images={placedSceneImages}
          layouts={layouts}
          roomConfig={roomConfig}
          customWalls={customWalls}
          doors={doors}
          mode={mode}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          editorSettings={editorSettings}
          isGrabActive={isGrabActive}
          pendingPlacementImageId={pendingPlacementIds[0] ?? null}
          selectedImageId={selectedImageId}
          selectedWallId={selectedWallId}
          selectedDoorId={selectedDoorId}
          selectedRoomIndex={selectedRoomIndex}
          onSelectImage={selectArtwork}
          onSelectWall={selectWall}
          onSelectDoor={selectDoor}
          onSelectRoom={selectRoom}
          onUpdateRoom={updateRoom}
          onUpdateImageLayout={updateImageLayout}
          onUpdateCustomWall={updateCustomWall}
          onUpdateDoor={updateDoor}
          onToggleDoor={toggleDoor}
          onPlaceImageOnWall={placePendingImage}
          onAimTargetChange={setAimTargetLabel}
          onBuilderPlacementChange={setBuilderPlacement}
        />
        {mode === "edit" ? (
          <div
            className={`edit-crosshair ${editorViewMode === "firstPerson" ? "active" : ""} ${
              aimTargetLabel ? "targeted" : ""
            }`}
          >
            <span />
            {editorViewMode === "firstPerson" && aimTargetLabel ? (
              <strong>{pendingPlacementIds[0] ? `挂到 ${aimTargetLabel}` : aimTargetLabel}</strong>
            ) : null}
          </div>
        ) : null}
        <div className="floating-mode-switch" aria-label="Mode switch">
          <button
            type="button"
            className={`view-mode-button ${mode === "view" ? "active" : ""}`}
            onClick={() => switchMode("view")}
            title="观赏模式"
          >
            <Eye size={17} />
            <span>观赏</span>
          </button>
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => switchMode("edit")}
            title="编辑模式"
          >
            <Pencil size={17} />
            <span>编辑</span>
          </button>
        </div>
        {mode === "edit" ? (
          <div className="edit-badge">
            <Move size={16} />
            <span>{editorViewMode === "topdown" ? "俯视编辑" : "第一人称编辑"}</span>
          </div>
        ) : null}
      </section>

      <aside className={`control-panel ${mode}-panel`} aria-label="Gallery controls">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Image Hang</p>
            <h1>私人画廊</h1>
          </div>
          <span className={supabaseReady ? "status online" : "status"}>
            {supabaseReady ? "Supabase" : "Local"}
          </span>
        </div>

        {mode === "view" ? (
          <section className="view-console" aria-label="Viewing console">
            <strong>观赏模式</strong>
            <span>点击左下角或画布进入画廊视角</span>
            <div>
              <b>{placedSceneImages.length}</b>
              <small>已展览</small>
            </div>
            <div>
              <b>{roomConfig.roomCount}</b>
              <small>房间</small>
            </div>
          </section>
        ) : null}

        <div className="mode-switch" aria-label="Mode switch">
          <button
            type="button"
            className={`view-mode-button ${mode === "view" ? "active" : ""}`}
            onClick={() => switchMode("view")}
            title="进入画廊"
          >
            <Eye size={17} />
            <span>观赏</span>
          </button>
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => switchMode("edit")}
          >
            <Pencil size={17} />
            <span>编辑</span>
          </button>
        </div>

        <label className="upload-dropzone">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <span className="upload-icon" aria-hidden="true">
            {isUploading || isLoading ? <Loader2 size={28} /> : <ImagePlus size={28} />}
          </span>
          <span>{isLoading ? "载入中" : isUploading ? "上传中" : "添加照片"}</span>
        </label>

        <div className="button-row">
          <button
            type="button"
            className="tool-button"
            onClick={() => fileInputRef.current?.click()}
            title="选择图片"
          >
            <UploadCloud size={18} />
            <span>上传</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void resetGallery()}
            title="恢复示例"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {message ? <p className="message">{message}</p> : null}

        {mode === "edit" ? (
          <section className="editor-panel editor-hints" aria-label="Editor hints">
            <div className="editor-heading">
              <Pencil size={17} />
              <span>编辑工作台</span>
            </div>
            <div className="view-toggle" aria-label="Editor view mode">
              <button
                type="button"
                className={editorViewMode === "topdown" ? "active" : ""}
                onClick={() => setEditorViewMode("topdown")}
              >
                <Move size={15} />
                <span>俯视</span>
              </button>
              <button
                type="button"
                className={editorViewMode === "firstPerson" ? "active" : ""}
                onClick={() => setEditorViewMode("firstPerson")}
              >
                <Eye size={15} />
                <span>第一人称</span>
              </button>
            </div>
            <div className="hint-grid">
              <span>视角</span>
              <strong>
                {editorViewMode === "topdown"
                  ? "拖动画布平移，滚轮缩放俯视图"
                  : "点击画布锁定视角，准星对准对象后点击选中"}
              </strong>
              <span>挂画</span>
              <strong>
                {pendingPlacementIds.length > 0
                  ? "点击墙面上的目标位置放置待挂图片"
                  : "先上传图片，再点击墙面定位"}
              </strong>
              <span>对象</span>
              <strong>从组件市场添加房间、墙壁、门，再选择对象调整参数</strong>
            </div>
            <div className="shortcut-grid" aria-label="Editor shortcuts">
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.openMarket)}</kbd> 组件市场</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.toggleView)}</kbd> 切换视角</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.moveTool)}</kbd> 移动</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.rotateTool)}</kbd> 旋转</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.scaleTool)}</kbd> 缩放</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.nudgeLeft)}</kbd><kbd>{formatKeyCode(editorSettings.shortcuts.nudgeRight)}</kbd> 左右移动</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.nudgeForward)}</kbd><kbd>{formatKeyCode(editorSettings.shortcuts.nudgeBackward)}</kbd> 前后/高度</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.rotateLeft)}</kbd><kbd>{formatKeyCode(editorSettings.shortcuts.rotateRight)}</kbd> 旋转墙壁</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.scaleUp)}</kbd><kbd>{formatKeyCode(editorSettings.shortcuts.scaleDown)}</kbd> 缩放</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.grabSelection)}</kbd> 抓取/释放</span>
              <span><kbd>{formatKeyCode(editorSettings.shortcuts.deleteSelection)}</kbd> 删除</span>
            </div>
          </section>
        ) : null}

        {mode === "edit" ? (
          <section className="editor-panel object-inspector" aria-label="Object inspector">
            <div className="editor-heading">
              <Move size={17} />
              <span>对象编辑器</span>
            </div>

            <div className="transform-tools" aria-label="Transform tools">
              <button
                type="button"
                className={transformTool === "move" ? "active" : ""}
                onClick={() => setTransformTool("move")}
              >
                <Move size={15} />
                <span>移动</span>
              </button>
              <button
                type="button"
                className={transformTool === "rotate" ? "active" : ""}
                onClick={() => setTransformTool("rotate")}
              >
                <RotateCcw size={15} />
                <span>旋转</span>
              </button>
              <button
                type="button"
                className={transformTool === "scale" ? "active" : ""}
                onClick={() => setTransformTool("scale")}
              >
                <Maximize2 size={15} />
                <span>缩放</span>
              </button>
            </div>

            {editorViewMode === "firstPerson" && transformTool === "move" ? (
              <button
                type="button"
                className={`tool-button secondary grab-button ${isGrabActive ? "active" : ""}`}
                onClick={() => selectedObject && setIsGrabActive((current) => !current)}
                disabled={!selectedObject}
              >
                <Move size={17} />
                <span>
                  {isGrabActive
                    ? "释放准星跟随"
                    : `抓取到准星 (${formatKeyCode(editorSettings.shortcuts.grabSelection)})`}
                </span>
              </button>
            ) : null}

            {!selectedObject ? (
              <p className="empty-inspector">
                俯视下点击对象编辑；第一人称下把准星对准画作、门或墙壁后点击即可选中。
              </p>
            ) : null}

            {selectedObject?.type === "artwork" && selectedImage && selectedLayout ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedImage.name}</strong>
                  <span>画作</span>
                </div>

                {(transformTool === "move" || transformTool === "rotate") ? (
                  <label className="field">
                    <span>{transformTool === "rotate" ? "朝向墙面" : "墙面"}</span>
                    <select
                      value={selectedLayout.wall}
                      onChange={(event) =>
                        updateSelectedLayout({ wall: event.target.value as GalleryWallTarget })
                      }
                    >
                      {wallOptions.map(([wall, label]) => (
                        <option key={wall} value={wall}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>横向位置 {selectedLayout.offset.toFixed(1)}</span>
                      <input
                        type="range"
                        min={
                          selectedLayoutConstraints
                            ? -(
                                getWallTargetLength(roomConfig, customWalls, selectedLayout.wall) / 2 -
                                (selectedLayout.width + frameOuterPadding) / 2 -
                                frameWallMargin
                              )
                            : -getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)
                        }
                        max={
                          selectedLayoutConstraints
                            ? getWallTargetLength(roomConfig, customWalls, selectedLayout.wall) / 2 -
                              (selectedLayout.width + frameOuterPadding) / 2 -
                              frameWallMargin
                            : getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)
                        }
                        step="0.1"
                        value={selectedLayout.offset}
                        onChange={(event) =>
                          updateSelectedLayout({ offset: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedLayout.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min={
                          selectedLayoutConstraints
                            ? Math.min(
                                getWallTargetHeight(roomConfig, customWalls, selectedLayout.wall) / 2,
                                selectedLayout.width / selectedLayoutConstraints.aspect / 2 +
                                  frameOuterPadding / 2 +
                                  frameWallMargin,
                              )
                            : 1.1
                        }
                        max={Math.max(
                          1.2,
                          selectedLayoutConstraints
                            ? getWallTargetHeight(roomConfig, customWalls, selectedLayout.wall) -
                                selectedLayout.width / selectedLayoutConstraints.aspect / 2 -
                                frameOuterPadding / 2 -
                                frameWallMargin
                            : getWallTargetHeight(roomConfig, customWalls, selectedLayout.wall) - 1.15,
                        )}
                        step="0.1"
                        value={selectedLayout.height}
                        onChange={(event) =>
                          updateSelectedLayout({ height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                {transformTool === "scale" ? (
                  <label className="field">
                    <span>大小 {selectedLayout.width.toFixed(1)}</span>
                    <input
                      type="range"
                      min={selectedLayoutConstraints?.minWidth ?? 1.2}
                      max={selectedLayoutConstraints?.maxWidth ?? 5}
                      step="0.1"
                      value={selectedLayout.width}
                      onChange={(event) =>
                        updateSelectedLayout({ width: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary"
                  onClick={() =>
                    setLayouts((current) => {
                      const next = { ...current };
                      delete next[selectedImage.id];
                      return next;
                    })
                  }
                >
                  <Maximize2 size={17} />
                  <span>重置画作变换</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "room" ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedRoomLabel}</strong>
                  <span>房间</span>
                </div>

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>X {((selectedRoomDimensions.x ?? getLinearRoomOffset(roomConfig, selectedRoomIndex))).toFixed(1)}</span>
                      <input
                        type="range"
                        min="-80"
                        max="80"
                        step="0.5"
                        value={selectedRoomDimensions.x ?? getLinearRoomOffset(roomConfig, selectedRoomIndex)}
                        onChange={(event) => updateRoom(selectedRoomIndex, { x: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>Z {(selectedRoomDimensions.z ?? 0).toFixed(1)}</span>
                      <input
                        type="range"
                        min="-80"
                        max="80"
                        step="0.5"
                        value={selectedRoomDimensions.z ?? 0}
                        onChange={(event) => updateRoom(selectedRoomIndex, { z: Number(event.target.value) })}
                      />
                    </label>
                  </>
                ) : null}

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>宽度 {selectedRoomDimensions.width.toFixed(1)}</span>
                      <input
                        type="range"
                        min="4"
                        max="40"
                        step="0.5"
                        value={selectedRoomDimensions.width}
                        onChange={(event) => updateRoomConfig({ width: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>深度 {selectedRoomDimensions.depth.toFixed(1)}</span>
                      <input
                        type="range"
                        min="6"
                        max="48"
                        step="0.5"
                        value={selectedRoomDimensions.depth}
                        onChange={(event) => updateRoomConfig({ depth: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>层高 {selectedRoomDimensions.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="3.2"
                        max="9"
                        step="0.1"
                        value={selectedRoomDimensions.height}
                        onChange={(event) => updateRoomConfig({ height: Number(event.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <p className="empty-inspector">房间位置由连续展厅结构自动排列，切到“缩放”可把当前房间做成展厅或走廊。</p>
                )}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteRoom(selectedRoomIndex)}
                  disabled={roomConfig.roomCount <= 1}
                >
                  <Trash2 size={17} />
                  <span>删除当前房间</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "wall" && selectedWall ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedWall.name}</strong>
                  <span>墙壁</span>
                </div>

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>所属房间 {selectedWall.roomIndex + 1}</span>
                      <input
                        type="range"
                        min="0"
                        max={roomConfig.roomCount - 1}
                        step="1"
                        value={selectedWall.roomIndex}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { roomIndex: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>X {selectedWall.x.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-selectedWallRoomDimensions.width / 2 + 1}
                        max={selectedWallRoomDimensions.width / 2 - 1}
                        step="0.1"
                        value={selectedWall.x}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { x: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Z {selectedWall.z.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-selectedWallRoomDimensions.depth / 2 + 1}
                        max={selectedWallRoomDimensions.depth / 2 - 1}
                        step="0.1"
                        value={selectedWall.z}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { z: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                {transformTool === "rotate" ? (
                  <label className="field">
                    <span>旋转 {Math.round((selectedWall.rotation * 180) / Math.PI)}°</span>
                    <input
                      type="range"
                      min="-3.14"
                      max="3.14"
                      step="0.05"
                      value={selectedWall.rotation}
                      onChange={(event) =>
                        updateCustomWall(selectedWall.id, { rotation: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>长度 {selectedWall.length.toFixed(1)}</span>
                      <input
                        type="range"
                        min="2"
                        max={selectedWallRoomDimensions.width - 0.6}
                        step="0.1"
                        value={selectedWall.length}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { length: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedWall.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="2.2"
                        max={selectedWallRoomDimensions.height - 0.35}
                        step="0.1"
                        value={selectedWall.height}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteCustomWall(selectedWall.id)}
                >
                  <Trash2 size={17} />
                  <span>删除选中墙壁</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "door" && selectedDoor ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedDoor.name}</strong>
                  <span>{selectedDoor.isOpen ? "已打开" : "已关闭"}</span>
                </div>

                <button
                  type="button"
                  className="tool-button secondary"
                  onClick={() => toggleDoor(selectedDoor.id)}
                >
                  <DoorOpen size={17} />
                  <span>{selectedDoor.isOpen ? "关闭门" : "打开门"}</span>
                </button>

                {(transformTool === "move" || transformTool === "rotate") ? (
                  <label className="field">
                    <span>{transformTool === "rotate" ? "朝向墙面" : "所在墙面"}</span>
                    <select
                      value={selectedDoor.wall}
                      onChange={(event) =>
                        updateDoor(selectedDoor.id, { wall: event.target.value as GalleryWallTarget })
                      }
                    >
                      {wallOptions.map(([wall, label]) => (
                        <option key={wall} value={wall}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>位置 {selectedDoor.offset.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-getWallOffsetLimit(roomConfig, customWalls, selectedDoor.wall)}
                        max={getWallOffsetLimit(roomConfig, customWalls, selectedDoor.wall)}
                        step="0.1"
                        value={selectedDoor.offset}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, { offset: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>连接到</span>
                      <select
                        value={selectedDoor.connectsToRoomIndex ?? ""}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, {
                            connectsToRoomIndex:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                      >
                        <option value="">未指定</option>
                        {Array.from({ length: roomConfig.roomCount }, (_, roomIndex) => (
                          <option key={roomIndex} value={roomIndex}>
                            房间 {roomIndex + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>宽度 {selectedDoor.width.toFixed(1)}</span>
                      <input
                        type="range"
                        min="0.8"
                        max="3.2"
                        step="0.1"
                        value={selectedDoor.width}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, { width: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedDoor.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="1.8"
                        max={getWallTargetHeight(roomConfig, customWalls, selectedDoor.wall) - 0.4}
                        step="0.1"
                        value={selectedDoor.height}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, { height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteDoor(selectedDoor.id)}
                >
                  <Trash2 size={17} />
                  <span>删除选中门</span>
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {mode === "edit" ? (
          <section className="editor-panel settings-panel" aria-label="Editor settings">
            <div className="editor-heading">
              <Pencil size={17} />
              <span>设置</span>
            </div>

            <button
              type="button"
              className="tool-button secondary"
              onClick={() => setIsSettingsOpen((current) => !current)}
            >
              <span>{isSettingsOpen ? "收起设置" : "打开设置"}</span>
            </button>

            {isSettingsOpen ? (
              <>
                <div className="settings-group">
                  <strong>数值</strong>
                  <label className="field">
                    <span>鼠标灵敏度 {(editorSettings.mouseSensitivity * 1000).toFixed(1)}</span>
                    <input
                      type="range"
                      min="0.8"
                      max="6"
                      step="0.1"
                      value={editorSettings.mouseSensitivity * 1000}
                      onChange={(event) =>
                        updateEditorSetting(
                          "mouseSensitivity",
                          clampSetting(Number(event.target.value) / 1000, 0.0008, 0.006),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span>行走速度 {editorSettings.walkSpeed.toFixed(1)}</span>
                    <input
                      type="range"
                      min="1.5"
                      max="9"
                      step="0.1"
                      value={editorSettings.walkSpeed}
                      onChange={(event) =>
                        updateEditorSetting(
                          "walkSpeed",
                          clampSetting(Number(event.target.value), 1.5, 9),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span>疾跑速度 {editorSettings.sprintSpeed.toFixed(1)}</span>
                    <input
                      type="range"
                      min="2.5"
                      max="14"
                      step="0.1"
                      value={editorSettings.sprintSpeed}
                      onChange={(event) =>
                        updateEditorSetting(
                          "sprintSpeed",
                          clampSetting(Number(event.target.value), 2.5, 14),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span>跳跃力度 {editorSettings.jumpPower.toFixed(1)}</span>
                    <input
                      type="range"
                      min="2.5"
                      max="9"
                      step="0.1"
                      value={editorSettings.jumpPower}
                      onChange={(event) =>
                        updateEditorSetting(
                          "jumpPower",
                          clampSetting(Number(event.target.value), 2.5, 9),
                        )
                      }
                    />
                  </label>
                </div>

                <div className="settings-group">
                  <strong>快捷键</strong>
                  <div className="shortcut-list">
                    {shortcutOrder.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={`shortcut-bind ${capturingShortcut === action ? "recording" : ""}`}
                        onClick={() => setCapturingShortcut(action)}
                      >
                        <span>{shortcutLabels[action]}</span>
                        <kbd>
                          {capturingShortcut === action
                            ? "按键..."
                            : formatKeyCode(editorSettings.shortcuts[action])}
                        </kbd>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="tool-button secondary"
                    onClick={() => {
                      setEditorSettings(defaultEditorSettings);
                      setCapturingShortcut(null);
                    }}
                  >
                    <RotateCcw size={17} />
                    <span>恢复默认设置</span>
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {mode === "edit" ? (
          <section className="editor-panel space-panel" aria-label="Room editor">
            <div className="editor-heading">
              <Ruler size={17} />
              <span>空间</span>
            </div>

            <div className="capacity-card">
              <strong>{sceneImages.length} / {capacity}</strong>
              <span>估算容量</span>
              <small>剩余 {remainingCapacity} 张</small>
            </div>

            <div className="room-selector" aria-label="Room selector">
              {Array.from({ length: roomConfig.roomCount }, (_, roomIndex) => (
                <button
                  key={roomIndex}
                  type="button"
                  className={selectedRoomIndex === roomIndex ? "active" : ""}
                  onClick={() => selectRoom(roomIndex)}
                >
                  房间 {roomIndex + 1}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="tool-button component-market-trigger"
              onClick={openComponentMarket}
            >
              <Box size={18} />
              <span>组件市场 ({formatKeyCode(editorSettings.shortcuts.openMarket)})</span>
            </button>

            <p className="placement-note">建造点：{builderPlacementSummary}</p>

            {pendingPlacementIds.length > 0 ? (
              <p className="placement-note">待放置 {pendingPlacementIds.length} 张：点击任意墙面挂画</p>
            ) : null}

          </section>
        ) : null}

        <div className="collection-header">
          <span>作品</span>
          <span>{images.length || samples.length}</span>
        </div>

        <div className="image-list">
          {images.length === 0 ? (
            samples.slice(0, 4).map((image) => (
              <article
                className={`image-item muted ${selectedImageId === image.id ? "selected" : ""}`}
                key={image.id}
                onClick={() => selectArtwork(image.id)}
              >
                <img src={image.url} alt="" />
                <div>
                  <strong>{image.name}</strong>
                  <span>sample</span>
                </div>
              </article>
            ))
          ) : (
            images.map((image) => (
              <article
                className={`image-item ${selectedImageId === image.id ? "selected" : ""}`}
                key={image.id}
                onClick={() => selectArtwork(image.id)}
              >
                <img src={image.url} alt="" />
                <div>
                  <strong title={image.name}>{image.name}</strong>
                  <span>{image.source}</span>
                </div>
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => void removeImage(image.id)}
                  title="移除"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          )}
        </div>
      </aside>

      {mode === "edit" && isComponentMarketOpen ? (
        <div className="market-overlay" role="dialog" aria-modal="true" aria-label="Component market">
          <div className="market-modal">
            <div className="market-modal-header">
              <div>
                <strong>组件市场</strong>
                <span>{builderPlacementSummary}</span>
              </div>
              <button type="button" className="icon-button" onClick={closeComponentMarket} title="关闭">
                ×
              </button>
            </div>

            <div className="market-modal-grid">
              <button type="button" className="build-card" onClick={addRoom}>
                <span className="build-preview preview-room" aria-hidden="true">
                  <i />
                </span>
                <strong>房间</strong>
                <span>扩展连续展厅空间</span>
              </button>
              <button type="button" className="build-card" onClick={addCustomWall}>
                <span className="build-preview preview-wall" aria-hidden="true">
                  <i />
                </span>
                <strong>墙壁</strong>
                <span>生成在当前光标点</span>
              </button>
              <button type="button" className="build-card" onClick={addDoor}>
                <span className="build-preview preview-door" aria-hidden="true">
                  <i />
                </span>
                <strong>门</strong>
                <span>挂到当前准星墙面</span>
              </button>
              <button type="button" className="build-card" disabled title="后续可扩展展台对象">
                <span className="build-preview preview-plinth" aria-hidden="true">
                  <i />
                </span>
                <strong>展台</strong>
                <span>后续扩展陈列物件</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
