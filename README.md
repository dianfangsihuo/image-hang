# Image Hang

A browser-based 3D gallery for walking through user-uploaded photos.

## Stack

- React + TypeScript + Vite
- Three.js through React Three Fiber
- Supabase Storage for hosted uploads

## Development

```powershell
npm install
npm run dev
```

Open the URL printed by Vite. Click inside the scene to lock the pointer, use WASD to move, and drag the mouse to look around.

## Controls

- View mode: click `进入画廊`, move with `WASD`, sprint with `Shift`, and jump with `Space`.
- Edit mode: select an artwork from the list or click a frame in the scene, then adjust wall, horizontal position, height, and size from the side panel.
- Edit mode also includes room width, depth, and ceiling-height controls. The capacity card estimates how many artworks the current gallery can hold.
- Edit mode supports adding room sections and custom freestanding walls.
- In edit mode, uploaded images enter placement mode first. Click a wall at the desired point to hang the next pending image.
- Frame layouts are saved in the browser and survive refreshes.

## Supabase Storage

Copy `.env.example` to `.env.local` and fill in:

```powershell
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SUPABASE_GALLERY_BUCKET=gallery-images
```

Create a public Supabase Storage bucket with the same bucket name. If Supabase is not configured, uploads still work locally in the browser for prototyping.
