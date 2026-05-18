import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GalleryImage, UploadResult } from "../types";

const LOCAL_STORAGE_KEY = "image-hang.gallery-images";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const bucketName =
  (import.meta.env.VITE_SUPABASE_GALLERY_BUCKET as string | undefined) ||
  "gallery-images";

let client: SupabaseClient | null = null;

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

export function loadStoredImages(): GalleryImage[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GalleryImage[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredImages(images: GalleryImage[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(images));
}

export function clearStoredImages() {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function safeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
        return {
          image: {
            ...baseImage,
            url: publicUrl,
            source: "supabase",
          },
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Supabase upload failed";
      const dataUrl = await readFileAsDataUrl(file);

      return {
        image: {
          ...baseImage,
          url: dataUrl,
          source: "local",
        },
        warning: `Supabase 上传失败，已临时保存到浏览器：${message}`,
      };
    }
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    image: {
      ...baseImage,
      url: dataUrl,
      source: "local",
    },
  };
}
