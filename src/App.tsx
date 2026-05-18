import {
  Eye,
  ImagePlus,
  Loader2,
  Maximize2,
  Move,
  Pencil,
  Plus,
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
  defaultRoomConfig,
  loadStoredCustomWalls,
  loadStoredLayouts,
  loadStoredRoomConfig,
  saveStoredCustomWalls,
  saveStoredLayouts,
  saveStoredRoomConfig,
} from "./lib/layoutStorage";
import { createSampleImages } from "./lib/sampleArt";
import type {
  AppMode,
  GalleryCustomWall,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
  GalleryWall,
  GalleryWallTarget,
} from "./types";

const wallLabels: Record<GalleryWall, string> = {
  north: "前墙",
  south: "后墙",
  west: "左墙",
  east: "右墙",
};

const builtWallOptions = Object.entries(wallLabels) as Array<[GalleryWall, string]>;

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

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall) {
  return wall === "north" || wall === "south" ? room.width : room.depth;
}

function getWallTargetLength(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  const built = parseBuiltWallTarget(target);

  if (built) {
    return getWallLength(room, built.wall);
  }

  return customWalls.find((wall) => wall.id === target)?.length ?? room.width;
}

function getWallTargetHeight(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  return customWalls.find((wall) => wall.id === target)?.height ?? room.height;
}

function getWallOffsetLimit(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  return Math.max(2.2, getWallTargetLength(room, customWalls, target) / 2 - 1.8);
}

function getDefaultFrameWidth(image: GalleryImage) {
  const aspect = image.width / image.height || 1.42;
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
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
      ? images.reduce((sum, image) => sum + (image.width / image.height || 1.42), 0) /
        images.length
      : 1.42;
  const averageHeight = averageWidth / averageAspect;
  const usableHeight = Math.max(0, room.height - 1.4 - 0.85);
  const rows = Math.max(1, Math.floor((usableHeight + verticalGap) / (averageHeight + verticalGap)));

  const builtinTargets = Array.from({ length: room.roomCount }, (_, roomIndex) =>
    builtWallOptions.map(([wall]) => builtWallTarget(roomIndex, wall)),
  ).flat();
  const allTargets = [...builtinTargets, ...customWalls.map((wall) => wall.id)];

  return allTargets.reduce((total, target) => {
    const usableLength = Math.max(0, getWallTargetLength(room, customWalls, target) - 2.4);
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
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [pendingPlacementIds, setPendingPlacementIds] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>("view");
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
  const selectedImage = selectedIndex >= 0 ? sceneImages[selectedIndex] : sceneImages[0];
  const selectedLayout =
    selectedImage &&
    (layouts[selectedImage.id] ??
      getDefaultLayout(selectedImage, Math.max(selectedIndex, 0), roomConfig));
  const capacity = useMemo(
    () => calculateGalleryCapacity(roomConfig, customWalls, sceneImages, layouts),
    [customWalls, layouts, roomConfig, sceneImages],
  );
  const remainingCapacity = Math.max(0, capacity - sceneImages.length);
  const supabaseReady = isSupabaseConfigured();

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
    if (mode !== "edit") {
      return;
    }

    if (!selectedImageId || !sceneImages.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(sceneImages[0]?.id ?? null);
    }
  }, [mode, sceneImages, selectedImageId]);

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
      setSelectedImageId(uploadedImages[0]?.id ?? null);
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
    previousImages.forEach(revokeImageUrl);
    setImages([]);
    setLayouts({});
    setRoomConfig(defaultRoomConfig);
    setCustomWalls([]);
    setPendingPlacementIds([]);
    setSelectedImageId(null);
    setMessage("已恢复示例画廊");
  }

  function updateSelectedLayout(patch: Partial<GalleryFrameLayout>) {
    if (!selectedImage || !selectedLayout) {
      return;
    }

    const wall = patch.wall ?? selectedLayout.wall;
    const limit = getWallOffsetLimit(roomConfig, customWalls, wall);
    const wallHeight = getWallTargetHeight(roomConfig, customWalls, wall);

    setLayouts((current) => ({
      ...current,
      [selectedImage.id]: {
        ...selectedLayout,
        ...patch,
        wall,
        offset: clamp(patch.offset ?? selectedLayout.offset, -limit, limit),
        height: clamp(patch.height ?? selectedLayout.height, 1.1, wallHeight - 1.15),
        width: clamp(patch.width ?? selectedLayout.width, 1.2, 5),
      },
    }));
  }

  function updateRoomConfig(patch: Partial<GalleryRoomConfig>) {
    setRoomConfig((current) => {
      const next = {
        width: clamp(patch.width ?? current.width, 12, 36),
        depth: clamp(patch.depth ?? current.depth, 14, 44),
        height: clamp(patch.height ?? current.height, 4.2, 8),
        roomCount: Math.round(clamp(patch.roomCount ?? current.roomCount, 1, 5)),
      };

      setLayouts((currentLayouts) =>
        Object.fromEntries(
          Object.entries(currentLayouts).map(([id, layout]) => {
            const limit = getWallOffsetLimit(next, customWalls, layout.wall);
            const wallHeight = getWallTargetHeight(next, customWalls, layout.wall);

            return [
              id,
              {
                ...layout,
                offset: clamp(layout.offset, -limit, limit),
                height: clamp(layout.height, 1.1, wallHeight - 1.15),
              },
            ];
          }),
        ),
      );

      return next;
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
      ...customWalls.map((wall) => [wall.id, `${wall.name}`] as [GalleryWallTarget, string]),
    ];
  }

  function addRoom() {
    updateRoomConfig({ roomCount: roomConfig.roomCount + 1 });
    setMessage(`已新增房间 ${roomConfig.roomCount + 1}`);
  }

  function addCustomWall() {
    const roomIndex = Math.max(0, roomConfig.roomCount - 1);
    const wall: GalleryCustomWall = {
      id: `wall-${crypto.randomUUID()}`,
      name: `自定义墙 ${customWalls.length + 1}`,
      roomIndex,
      x: 0,
      z: 0,
      length: Math.min(7, roomConfig.width - 2),
      height: Math.min(roomConfig.height - 0.3, 4.8),
      rotation: 0,
    };

    setCustomWalls((current) => [...current, wall]);
    setSelectedWallId(wall.id);
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
              x: clamp(patch.x ?? wall.x, -roomConfig.width / 2 + 1, roomConfig.width / 2 - 1),
              z: clamp(patch.z ?? wall.z, -roomConfig.depth / 2 + 1, roomConfig.depth / 2 - 1),
              length: clamp(patch.length ?? wall.length, 2, roomConfig.width - 1),
              height: clamp(patch.height ?? wall.height, 2.2, roomConfig.height - 0.35),
              rotation: patch.rotation ?? wall.rotation,
            }
          : wall,
      ),
    );
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

    setLayouts((current) => ({
      ...current,
      [imageId]: {
        wall,
        offset: clamp(offset, -getWallOffsetLimit(roomConfig, customWalls, wall), getWallOffsetLimit(roomConfig, customWalls, wall)),
        height: clamp(height, 1.1, getWallTargetHeight(roomConfig, customWalls, wall) - 1.15),
        width: getDefaultFrameWidth(image),
      },
    }));
    setPendingPlacementIds((current) => current.slice(1));
    setSelectedImageId(imageId);
    setMessage(pendingPlacementIds.length > 1 ? "已放置图片，请继续点击墙面" : "图片已挂到墙面");
  }

  const wallOptions = getWallOptions();
  const selectedWall = customWalls.find((wall) => wall.id === selectedWallId) ?? customWalls[0];

  return (
    <main className="app-shell">
      <section className="gallery-stage" aria-label="3D gallery viewport">
        <GalleryScene
          images={placedSceneImages}
          layouts={layouts}
          roomConfig={roomConfig}
          customWalls={customWalls}
          mode={mode}
          pendingPlacementImageId={pendingPlacementIds[0] ?? null}
          selectedImageId={selectedImageId}
          onSelectImage={setSelectedImageId}
          onPlaceImageOnWall={placePendingImage}
        />
        {mode === "view" ? (
          <button className="enter-button" type="button">
            进入画廊
          </button>
        ) : (
          <div className="edit-badge">
            <Move size={16} />
            <span>编辑模式</span>
          </div>
        )}
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
            onClick={() => setMode("view")}
            title="进入画廊"
          >
            <Eye size={17} />
            <span>观赏</span>
          </button>
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => setMode("edit")}
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

        {mode === "edit" && selectedImage && selectedLayout ? (
          <section className="editor-panel" aria-label="Frame editor">
            <div className="editor-heading">
              <Move size={17} />
              <span>{selectedImage.name}</span>
            </div>

            <label className="field">
              <span>墙面</span>
              <select
                value={selectedLayout.wall}
                onChange={(event) =>
                  updateSelectedLayout({ wall: event.target.value as GalleryWall })
                }
              >
                {wallOptions.map(([wall, label]) => (
                  <option key={wall} value={wall}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>横向位置 {selectedLayout.offset.toFixed(1)}</span>
              <input
                type="range"
                min={-getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)}
                max={getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)}
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
                min="1.1"
                max={Math.max(
                  1.2,
                  getWallTargetHeight(roomConfig, customWalls, selectedLayout.wall) - 1.15,
                )}
                step="0.1"
                value={selectedLayout.height}
                onChange={(event) =>
                  updateSelectedLayout({ height: Number(event.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>大小 {selectedLayout.width.toFixed(1)}</span>
              <input
                type="range"
                min="1.2"
                max="5"
                step="0.1"
                value={selectedLayout.width}
                onChange={(event) =>
                  updateSelectedLayout({ width: Number(event.target.value) })
                }
              />
            </label>

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
              <span>重置画框</span>
            </button>
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

            <div className="button-row">
              <button type="button" className="tool-button secondary" onClick={addRoom}>
                <Plus size={17} />
                <span>新增房间</span>
              </button>
              <button type="button" className="tool-button secondary" onClick={addCustomWall}>
                <Plus size={17} />
                <span>新增墙壁</span>
              </button>
            </div>

            {pendingPlacementIds.length > 0 ? (
              <p className="placement-note">待放置 {pendingPlacementIds.length} 张：点击任意墙面挂画</p>
            ) : null}

            <label className="field">
              <span>宽度 {roomConfig.width.toFixed(1)}</span>
              <input
                type="range"
                min="12"
                max="36"
                step="0.5"
                value={roomConfig.width}
                onChange={(event) => updateRoomConfig({ width: Number(event.target.value) })}
              />
            </label>

            <label className="field">
              <span>深度 {roomConfig.depth.toFixed(1)}</span>
              <input
                type="range"
                min="14"
                max="44"
                step="0.5"
                value={roomConfig.depth}
                onChange={(event) => updateRoomConfig({ depth: Number(event.target.value) })}
              />
            </label>

            <label className="field">
              <span>房间数 {roomConfig.roomCount}</span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={roomConfig.roomCount}
                onChange={(event) => updateRoomConfig({ roomCount: Number(event.target.value) })}
              />
            </label>

            <label className="field">
              <span>层高 {roomConfig.height.toFixed(1)}</span>
              <input
                type="range"
                min="4.2"
                max="8"
                step="0.1"
                value={roomConfig.height}
                onChange={(event) => updateRoomConfig({ height: Number(event.target.value) })}
              />
            </label>
          </section>
        ) : null}

        {mode === "edit" && customWalls.length > 0 && selectedWall ? (
          <section className="editor-panel" aria-label="Wall editor">
            <div className="editor-heading">
              <Ruler size={17} />
              <span>{selectedWall.name}</span>
            </div>

            <label className="field">
              <span>墙壁</span>
              <select
                value={selectedWall.id}
                onChange={(event) => setSelectedWallId(event.target.value)}
              >
                {customWalls.map((wall) => (
                  <option key={wall.id} value={wall.id}>
                    {wall.name}
                  </option>
                ))}
              </select>
            </label>

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
                min={-roomConfig.width / 2 + 1}
                max={roomConfig.width / 2 - 1}
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
                min={-roomConfig.depth / 2 + 1}
                max={roomConfig.depth / 2 - 1}
                step="0.1"
                value={selectedWall.z}
                onChange={(event) =>
                  updateCustomWall(selectedWall.id, { z: Number(event.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>长度 {selectedWall.length.toFixed(1)}</span>
              <input
                type="range"
                min="2"
                max={roomConfig.width - 1}
                step="0.1"
                value={selectedWall.length}
                onChange={(event) =>
                  updateCustomWall(selectedWall.id, { length: Number(event.target.value) })
                }
              />
            </label>

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
                onClick={() => setSelectedImageId(image.id)}
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
                onClick={() => setSelectedImageId(image.id)}
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
    </main>
  );
}

export default App;
