import type {
  EditorSettings,
  GalleryCustomWall,
  GalleryDoor,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
} from "../types";

export interface LocalGalleryState {
  images: GalleryImage[];
  layouts: GalleryLayouts;
  roomConfig: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
  editorSettings: EditorSettings;
}

interface LoadLocalGalleryResponse {
  exists: boolean;
  state: LocalGalleryState | null;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function loadLocalGalleryState() {
  const response = await requestJson<LoadLocalGalleryResponse>("/api/local-gallery");

  return response?.exists ? response.state : null;
}

async function materializeProjectImage(image: GalleryImage): Promise<GalleryImage> {
  if (!image.url.startsWith("blob:") && !image.url.startsWith("data:")) {
    return image;
  }

  try {
    const response = await fetch(image.url);
    const blob = await response.blob();
    const url = await saveLocalGalleryImage(blob, image.id);

    return url ? { ...image, url } : image;
  } catch {
    return image;
  }
}

export async function saveLocalGalleryState(state: LocalGalleryState) {
  const durableState: LocalGalleryState = {
    ...state,
    images: await Promise.all(state.images.map(materializeProjectImage)),
  };
  const response = await requestJson<{ ok: boolean }>("/api/local-gallery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(durableState),
  });

  return Boolean(response?.ok);
}

export async function saveLocalGalleryImage(file: Blob, id: string) {
  const data = arrayBufferToBase64(await file.arrayBuffer());
  const response = await requestJson<{ url: string }>("/api/local-gallery/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      mimeType: file.type,
      data,
    }),
  });

  return response?.url ?? null;
}

export async function syncComfyGalleryImageDelete(id: string) {
  const response = await requestJson<{ ok: boolean }>("/api/comfyui-gallery/image", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id }),
  });

  return Boolean(response?.ok);
}
