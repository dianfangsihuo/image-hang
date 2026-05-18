import {
  Eye,
  ImagePlus,
  Loader2,
  Maximize2,
  Move,
  Pencil,
  RotateCcw,
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
  loadStoredLayouts,
  saveStoredLayouts,
} from "./lib/layoutStorage";
import { createSampleImages } from "./lib/sampleArt";
import type {
  AppMode,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryWall,
} from "./types";

const wallLabels: Record<GalleryWall, string> = {
  north: "前墙",
  south: "后墙",
  west: "左墙",
  east: "右墙",
};

const wallOptions = Object.entries(wallLabels) as Array<[GalleryWall, string]>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWallOffsetLimit(wall: GalleryWall) {
  return wall === "north" || wall === "south" ? 7.2 : 9.2;
}

function App() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [layouts, setLayouts] = useState<GalleryLayouts>(() => loadStoredLayouts());
  const [mode, setMode] = useState<AppMode>("view");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<GalleryImage[]>([]);
  const samples = useMemo(() => createSampleImages(), []);
  const sceneImages = images.length > 0 ? images : samples;
  const selectedIndex = sceneImages.findIndex((image) => image.id === selectedImageId);
  const selectedImage = selectedIndex >= 0 ? sceneImages[selectedIndex] : sceneImages[0];
  const selectedLayout =
    selectedImage &&
    (layouts[selectedImage.id] ?? getDefaultLayout(selectedImage, Math.max(selectedIndex, 0)));
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
      setMessage(warning ?? `已添加 ${results.length} 张图片`);
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
    previousImages.forEach(revokeImageUrl);
    setImages([]);
    setLayouts({});
    setSelectedImageId(null);
    setMessage("已恢复示例画廊");
  }

  function updateSelectedLayout(patch: Partial<GalleryFrameLayout>) {
    if (!selectedImage || !selectedLayout) {
      return;
    }

    const wall = patch.wall ?? selectedLayout.wall;
    const limit = getWallOffsetLimit(wall);

    setLayouts((current) => ({
      ...current,
      [selectedImage.id]: {
        ...selectedLayout,
        ...patch,
        wall,
        offset: clamp(patch.offset ?? selectedLayout.offset, -limit, limit),
        height: clamp(patch.height ?? selectedLayout.height, 1.1, 4.2),
        width: clamp(patch.width ?? selectedLayout.width, 1.2, 5),
      },
    }));
  }

  return (
    <main className="app-shell">
      <section className="gallery-stage" aria-label="3D gallery viewport">
        <GalleryScene
          images={sceneImages}
          layouts={layouts}
          mode={mode}
          selectedImageId={selectedImageId}
          onSelectImage={setSelectedImageId}
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

      <aside className="control-panel" aria-label="Gallery controls">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Image Hang</p>
            <h1>私人画廊</h1>
          </div>
          <span className={supabaseReady ? "status online" : "status"}>
            {supabaseReady ? "Supabase" : "Local"}
          </span>
        </div>

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
                min={-getWallOffsetLimit(selectedLayout.wall)}
                max={getWallOffsetLimit(selectedLayout.wall)}
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
                max="4.2"
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
