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

## Supabase Storage

Copy `.env.example` to `.env.local` and fill in:

```powershell
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SUPABASE_GALLERY_BUCKET=gallery-images
```

Create a public Supabase Storage bucket with the same bucket name. If Supabase is not configured, uploads still work locally in the browser for prototyping.
