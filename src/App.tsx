import { ImagePlus, Loader2, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import GalleryScene from "./components/GalleryScene";
import {
  clearStoredImages,
  createGalleryImage,
  isSupabaseConfigured,
  loadStoredImages,
  removeStoredImage,
  revokeImageUrl,
} from "./lib/galleryStorage";
import { createSampleImages } from "./lib/sampleArt";
import type { GalleryImage } from "./types";

function App() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<GalleryImage[]>([]);
  const samples = useMemo(() => createSampleImages(), []);
  const sceneImages = images.length > 0 ? images : samples;
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
      setImages((current) => [...results.map((result) => result.image), ...current]);
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
  }

  async function resetGallery() {
    const previousImages = images;
    await clearStoredImages();
    previousImages.forEach(revokeImageUrl);
    setImages([]);
    setMessage("已恢复示例画廊");
  }

  return (
    <main className="app-shell">
      <section className="gallery-stage" aria-label="3D gallery viewport">
        <GalleryScene images={sceneImages} />
        <button className="enter-button" type="button">
          进入画廊
        </button>
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

        <div className="collection-header">
          <span>作品</span>
          <span>{images.length || samples.length}</span>
        </div>

        <div className="image-list">
          {images.length === 0 ? (
            samples.slice(0, 4).map((image) => (
              <article className="image-item muted" key={image.id}>
                <img src={image.url} alt="" />
                <div>
                  <strong>{image.name}</strong>
                  <span>sample</span>
                </div>
              </article>
            ))
          ) : (
            images.map((image) => (
              <article className="image-item" key={image.id}>
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
