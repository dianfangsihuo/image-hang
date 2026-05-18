import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GalleryImage, UploadResult } from "../types";

const DATABASE_NAME = "image-hang-gallery";
const DATABASE_VERSION = 1;
const IMAGE_STORE = "images";
const LEGACY_LOCAL_STORAGE_KEY = "image-hang.gallery-images";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const bucketName =
  (import.meta.env.VITE_SUPABASE_GALLERY_BUCKET as string | undefined) ||
  "gallery-images";

let client: SupabaseClient | null = null;

interface StoredGalleryImage {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  source: GalleryImage["source"];
  url?: string;
  blob?: Blob;
}

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  client ??= createClient(supabaseUrl!, supabaseAnonKey!);
  return client;
}

function openGalleryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(IMAGE_STORE)) {
        database.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runImageStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>(async (resolve, reject) => {
    try {
      const database = await openGalleryDatabase();
      const transaction = database.transaction(IMAGE_STORE, mode);
      const store = transaction.objectStore(IMAGE_STORE);
      const request = operation(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

function toGalleryImage(record: StoredGalleryImage): GalleryImage {
  return {
    id: record.id,
    name: record.name,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    source: record.source,
    url: record.blob ? URL.createObjectURL(record.blob) : record.url ?? "",
  };
}

async function putStoredImage(record: StoredGalleryImage) {
  await runImageStore("readwrite", (store) => store.put(record));
}

async function migrateLegacyLocalStorage() {
  const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const legacyImages = JSON.parse(raw) as GalleryImage[];

    await Promise.all(
      legacyImages.map(async (image) => {
        if (!image.url) {
          return;
        }

        if (image.source === "local" && image.url.startsWith("data:")) {
          const response = await fetch(image.url);
          const blob = await response.blob();

          await putStoredImage({
            ...image,
            blob,
            url: undefined,
          });
          return;
        }

        await putStoredImage(image);
      }),
    );
  } finally {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  }
}

export async function loadStoredImages(): Promise<GalleryImage[]> {
  await migrateLegacyLocalStorage();

  const records = await runImageStore<StoredGalleryImage[]>("readonly", (store) =>
    store.getAll(),
  );

  return records
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toGalleryImage)
    .filter((image) => image.url);
}

export async function removeStoredImage(id: string) {
  await runImageStore("readwrite", (store) => store.delete(id));
}

export async function clearStoredImages() {
  await runImageStore("readwrite", (store) => store.clear());
}

export function revokeImageUrl(image: GalleryImage) {
  if (image.url.startsWith("blob:")) {
    URL.revokeObjectURL(image.url);
  }
}

function safeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getImageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function uploadToSupabase(file: File) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const path = `${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const upload = await supabase.storage.from(bucketName).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) {
    throw upload.error;
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
  return data.publicUrl;
}

export async function createGalleryImage(file: File): Promise<UploadResult> {
  const { width, height } = await getImageSize(file);
  const baseImage = {
    id: crypto.randomUUID(),
    name: file.name,
    width,
    height,
    createdAt: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    try {
      const publicUrl = await uploadToSupabase(file);

      if (publicUrl) {
        const image: GalleryImage = {
          ...baseImage,
          url: publicUrl,
          source: "supabase",
        };

        await putStoredImage(image);

        return {
          image,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Supabase upload failed";
      const objectUrl = URL.createObjectURL(file);
      const image: GalleryImage = {
        ...baseImage,
        url: objectUrl,
        source: "local",
      };

      await putStoredImage({
        ...baseImage,
        blob: file,
        source: "local",
      });

      return {
        image,
        warning: `Supabase 上传失败，已临时保存到浏览器：${message}`,
      };
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image: GalleryImage = {
    ...baseImage,
    url: objectUrl,
    source: "local",
  };

  await putStoredImage({
    ...baseImage,
    blob: file,
    source: "local",
  });

  return {
    image,
  };
}
