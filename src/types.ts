export type GalleryImageSource = "local" | "supabase" | "sample";

export interface GalleryImage {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
  source: GalleryImageSource;
}

export interface UploadResult {
  image: GalleryImage;
  warning?: string;
}
