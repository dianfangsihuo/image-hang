import type { GalleryImage } from "../types";

const palettes = [
  ["#263238", "#ef5350", "#ffd166", "#f7fff7"],
  ["#111827", "#38bdf8", "#a7f3d0", "#f9fafb"],
  ["#252422", "#eb5e28", "#fffcf2", "#403d39"],
  ["#0b132b", "#5bc0be", "#f4f1de", "#f2cc8f"],
  ["#172a3a", "#09bc8a", "#fefae0", "#d62828"],
  ["#2b2d42", "#8d99ae", "#edf2f4", "#ef233c"],
];

function makeArtwork(index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 840;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return "";
  }

  const colors = palettes[index % palettes.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.55, colors[1]);
  gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.82;
  ctx.fillStyle = colors[3];
  for (let i = 0; i < 9; i += 1) {
    const size = 70 + i * 28;
    const x = 150 + ((i * 137) % 860);
    const y = 110 + ((i * 89) % 590);
    ctx.beginPath();
    ctx.roundRect(x, y, size * 1.4, size, 24);
    ctx.fill();
  }

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = colors[0];
  ctx.lineWidth = 20;
  ctx.strokeRect(50, 50, canvas.width - 100, canvas.height - 100);

  return canvas.toDataURL("image/jpeg", 0.9);
}

export function createSampleImages(): GalleryImage[] {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `sample-${index}`,
    name: `Sample ${index + 1}`,
    url: makeArtwork(index),
    width: 1200,
    height: 840,
    createdAt: new Date(0).toISOString(),
    source: "sample",
  }));
}
