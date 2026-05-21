import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const stateUrl = "/image-hang-gallery/state";
const settingsUrl = "/image-hang-gallery/settings";
const importUrl = "/image-hang-gallery/import-generated";

let panel;
let grid;
let statusLine;
let autoStoreToggle;
let openOnStartToggle;
let targetRoomSelect;
const layoutStorageKey = "image-hang-gallery-panel-layout";
const defaultPanelLayout = {
  width: 380,
  height: 520,
  top: 64,
  left: null,
};
let settings = {
  autoStore: false,
  openOnStart: true,
  dedupeGenerated: true,
  targetRoomIndex: 0,
};
let currentRoomCount = 1;
let knownFingerprints = new Set();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readPanelLayout() {
  try {
    return {
      ...defaultPanelLayout,
      ...(JSON.parse(localStorage.getItem(layoutStorageKey) || "{}") || {}),
    };
  } catch {
    return { ...defaultPanelLayout };
  }
}

function writePanelLayout(layout) {
  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
}

function applyPanelLayout(layout) {
  const minWidth = 260;
  const minHeight = 240;
  const margin = 12;
  const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
  const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);
  const width = clamp(Number(layout.width) || defaultPanelLayout.width, minWidth, maxWidth);
  const height = clamp(Number(layout.height) || defaultPanelLayout.height, minHeight, maxHeight);
  const leftFallback = window.innerWidth - width - 18;
  const left = clamp(Number.isFinite(layout.left) ? layout.left : leftFallback, margin, window.innerWidth - width - margin);
  const top = clamp(Number(layout.top) || defaultPanelLayout.top, margin, window.innerHeight - height - margin);

  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "auto";

  return { width, height, left, top };
}

function saveCurrentPanelLayout() {
  if (!panel) {
    return;
  }

  writePanelLayout({
    width: panel.offsetWidth,
    height: panel.offsetHeight,
    left: panel.offsetLeft,
    top: panel.offsetTop,
  });
}

function imageFingerprint(image) {
  return JSON.stringify({
    filename: image.filename || "",
    subfolder: image.subfolder || "",
    type: image.type || "output",
  });
}

function setStatus(text) {
  if (statusLine) {
    statusLine.textContent = text;
  }
}

async function fetchJson(url, options) {
  const response = await api.fetchApi(url, options);
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return await response.json();
}

async function findRunningViewerUrl() {
  for (let port = 5174; port < 5200; port += 1) {
    const url = `http://127.0.0.1:${port}/`;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        mode: "no-cors",
      });
      if (response) {
        return url;
      }
    } catch {
      // Try the next likely Vite port.
    }
  }

  return null;
}

function injectStyle() {
  if (document.getElementById("image-hang-gallery-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "image-hang-gallery-style";
  style.textContent = `
    .image-hang-toggle {
      position: fixed;
      right: 18px;
      bottom: 84px;
      z-index: 9999;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 8px;
      padding: 9px 12px;
      color: #f7f0e3;
      background: #2f281f;
      box-shadow: 0 10px 30px rgba(0,0,0,.34);
      font: 800 13px/1.1 system-ui, sans-serif;
      cursor: pointer;
    }

    .image-hang-panel {
      position: fixed;
      top: 64px;
      right: 18px;
      width: min(380px, calc(100vw - 32px));
      height: min(520px, calc(100vh - 96px));
      min-width: 260px;
      min-height: 240px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      z-index: 9998;
      display: none;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 8px;
      color: #f7f0e3;
      background: rgba(30, 26, 22, .96);
      box-shadow: 0 18px 48px rgba(0,0,0,.42);
      font-family: system-ui, sans-serif;
      box-sizing: border-box;
    }

    .image-hang-panel.open {
      display: flex;
    }

    .image-hang-head,
    .image-hang-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .image-hang-head {
      cursor: move;
      user-select: none;
      touch-action: none;
    }

    .image-hang-head strong {
      font-size: 15px;
    }

    .image-hang-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .image-hang-head button,
    .image-hang-actions button {
      border: 0;
      border-radius: 6px;
      padding: 7px 10px;
      color: #2f281f;
      background: #eadcc9;
      font-weight: 800;
      cursor: pointer;
    }

    .image-hang-row {
      padding: 9px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,.07);
      font-size: 13px;
    }

    .image-hang-row label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .image-hang-room-select {
      width: 100%;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 6px;
      padding: 7px 9px;
      color: #f7f0e3;
      background: rgba(10, 8, 6, .58);
      font: 700 13px/1.2 system-ui, sans-serif;
    }

    .image-hang-status {
      color: #d5c7b5;
      font-size: 12px;
      min-height: 16px;
    }

    .image-hang-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      overflow: auto;
      padding-right: 2px;
      min-height: 0;
    }

    .image-hang-card {
      position: relative;
      border: 1px solid rgba(255,255,255,.11);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255,255,255,.06);
    }

    .image-hang-card img {
      display: block;
      width: 100%;
      aspect-ratio: 1 / .72;
      object-fit: cover;
      background: #16130f;
    }

    .image-hang-card footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 8px;
      font-size: 12px;
    }

    .image-hang-card-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px 8px;
    }

    .image-hang-card select {
      min-width: 0;
      flex: 1;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 5px;
      padding: 5px 7px;
      color: #f7f0e3;
      background: rgba(10, 8, 6, .58);
      font: 700 12px/1.2 system-ui, sans-serif;
    }

    .image-hang-card span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-hang-delete {
      position: absolute;
      right: 7px;
      top: 7px;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 999px;
      padding: 0;
      color: #fff2ee;
      background: rgba(143,48,38,.86);
      box-shadow: 0 6px 16px rgba(0,0,0,.36);
      font: 900 16px/1 system-ui, sans-serif;
      cursor: pointer;
    }

    .image-hang-delete:hover {
      background: rgba(178,50,38,.96);
    }

    .image-hang-resize {
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 18px;
      height: 18px;
      border: 0;
      padding: 0;
      background:
        linear-gradient(135deg, transparent 0 50%, rgba(234,220,201,.62) 50% 58%, transparent 58%),
        linear-gradient(135deg, transparent 0 66%, rgba(234,220,201,.5) 66% 74%, transparent 74%);
      cursor: nwse-resize;
      opacity: .9;
      touch-action: none;
    }
  `;
  document.head.appendChild(style);
}

function makeToggleButton() {
  const button = document.createElement("button");
  button.className = "image-hang-toggle";
  button.textContent = "画廊";
  button.addEventListener("click", () => {
    panel.classList.toggle("open");
  });
  document.body.appendChild(button);
}

function makePanel() {
  panel = document.createElement("section");
  panel.className = "image-hang-panel";
  panel.innerHTML = `
    <div class="image-hang-head">
      <strong>Image Hang 画廊</strong>
      <div class="image-hang-actions">
        <button type="button" data-action="open-viewer">进入画廊</button>
        <button type="button" data-action="refresh">刷新</button>
      </div>
    </div>
    <div class="image-hang-row">
      <label><input type="checkbox" data-setting="autoStore"> 自动收集生成图</label>
    </div>
    <div class="image-hang-row">
      <label><input type="checkbox" data-setting="openOnStart"> 启动后自动弹出</label>
    </div>
    <div class="image-hang-row">
      <select class="image-hang-room-select" data-setting="targetRoomIndex" title="自动收集图片时指定挂到哪个房间"></select>
    </div>
    <div class="image-hang-status"></div>
    <div class="image-hang-grid"></div>
    <button type="button" class="image-hang-resize" aria-label="调整画廊大小" title="拖动调整大小"></button>
  `;
  document.body.appendChild(panel);
  applyPanelLayout(readPanelLayout());

  grid = panel.querySelector(".image-hang-grid");
  statusLine = panel.querySelector(".image-hang-status");
  autoStoreToggle = panel.querySelector('[data-setting="autoStore"]');
  openOnStartToggle = panel.querySelector('[data-setting="openOnStart"]');
  targetRoomSelect = panel.querySelector('[data-setting="targetRoomIndex"]');

  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => {
    void loadGallery();
  });

  panel.querySelector('[data-action="open-viewer"]').addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "启动中...";

    try {
      let data;
      try {
        data = await fetchJson("/image-hang-gallery/launch-viewer");
      } catch (error) {
        if (error.status !== 404 && error.status !== 405) {
          throw error;
        }

        const fallbackUrl = await findRunningViewerUrl();
        if (!fallbackUrl) {
          throw error;
        }

        data = { ok: true, url: fallbackUrl };
      }

      if (!data.ok || !data.url) {
        throw new Error(data.error || "启动画廊失败");
      }
      window.open(data.url, "image-hang-gallery-viewer");
      setStatus("画廊服务已启动");
    } catch (error) {
      setStatus(`启动画廊失败：${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  });

  autoStoreToggle.addEventListener("change", () => {
    settings.autoStore = autoStoreToggle.checked;
    void saveSettings();
  });

  openOnStartToggle.addEventListener("change", () => {
    settings.openOnStart = openOnStartToggle.checked;
    void saveSettings();
  });

  targetRoomSelect.addEventListener("change", () => {
    settings.targetRoomIndex = Number(targetRoomSelect.value) || 0;
    void saveSettings();
  });

  enablePanelDragAndResize();
  window.addEventListener("resize", () => {
    applyPanelLayout(readPanelLayout());
    saveCurrentPanelLayout();
  });
}

function updateRoomOptions(roomConfig) {
  if (!targetRoomSelect) {
    return;
  }

  const roomCount = Math.max(1, Number(roomConfig?.roomCount) || 1);
  currentRoomCount = roomCount;
  const selected = clamp(Number(settings.targetRoomIndex) || 0, 0, roomCount - 1);
  targetRoomSelect.innerHTML = "";

  for (let index = 0; index < roomCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `自动挂到：房间 ${index + 1}`;
    targetRoomSelect.appendChild(option);
  }

  targetRoomSelect.value = String(selected);
  settings.targetRoomIndex = selected;
}

function makeRoomSelect(selectedRoomIndex, onChange) {
  const select = document.createElement("select");
  const selected = clamp(Number(selectedRoomIndex) || 0, 0, currentRoomCount - 1);

  for (let index = 0; index < currentRoomCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `房间 ${index + 1}`;
    select.appendChild(option);
  }

  select.value = String(selected);
  select.addEventListener("change", () => onChange(Number(select.value) || 0));
  return select;
}

function enablePanelDragAndResize() {
  const head = panel.querySelector(".image-hang-head");
  const resizeHandle = panel.querySelector(".image-hang-resize");

  head.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panel.offsetLeft;
    const startTop = panel.offsetTop;

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const margin = 12;
      panel.style.left = `${clamp(startLeft + moveEvent.clientX - startX, margin, window.innerWidth - width - margin)}px`;
      panel.style.top = `${clamp(startTop + moveEvent.clientY - startY, margin, window.innerHeight - height - margin)}px`;
    };

    const stop = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
      saveCurrentPanelLayout();
    };

    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = panel.offsetWidth;
    const startHeight = panel.offsetHeight;
    const startLeft = panel.offsetLeft;
    const startTop = panel.offsetTop;

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const margin = 12;
      const maxWidth = window.innerWidth - startLeft - margin;
      const maxHeight = window.innerHeight - startTop - margin;
      panel.style.width = `${clamp(startWidth + moveEvent.clientX - startX, 260, maxWidth)}px`;
      panel.style.height = `${clamp(startHeight + moveEvent.clientY - startY, 240, maxHeight)}px`;
    };

    const stop = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
      saveCurrentPanelLayout();
    };

    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
  });
}

function renderImages(images) {
  grid.innerHTML = "";
  knownFingerprints = new Set(
    images
      .map((image) => image.origin?.fingerprint)
      .filter(Boolean),
  );

  if (!images.length) {
    const empty = document.createElement("div");
    empty.className = "image-hang-status";
    empty.textContent = "画廊里还没有图片。开启自动收集后，生成完成的图片会进入这里。";
    grid.appendChild(empty);
    return;
  }

  for (const image of images) {
    const card = document.createElement("article");
    card.className = "image-hang-card";
    card.innerHTML = `
      <img src="${image.url}" loading="lazy" alt="">
      <button type="button" class="image-hang-delete" title="从画廊删除" aria-label="删除画作">×</button>
      <footer>
        <span title="${image.name || ""}">${image.name || "Untitled"}</span>
      </footer>
      <div class="image-hang-card-controls"></div>
    `;
    card.querySelector(".image-hang-card-controls").appendChild(
      makeRoomSelect(image.targetRoomIndex ?? image.origin?.targetRoomIndex ?? 0, async (targetRoomIndex) => {
        try {
          await fetchJson(`/image-hang-gallery/image/${encodeURIComponent(image.id)}/room`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetRoomIndex }),
          });
          await loadGallery();
          setStatus(`已指定到房间 ${targetRoomIndex + 1}`);
        } catch (error) {
          setStatus(`指定房间失败：${error.message || error}`);
        }
      }),
    );
    card.querySelector(".image-hang-delete").addEventListener("click", async (event) => {
      event.stopPropagation();
      const confirmed = window.confirm(`删除这张画作？\n${image.name || "Untitled"}`);
      if (!confirmed) {
        return;
      }

      try {
        await fetchJson(`/image-hang-gallery/image/${encodeURIComponent(image.id)}`, {
          method: "DELETE",
        });
        await loadGallery();
        setStatus("已删除画作");
      } catch (error) {
        setStatus(`删除失败：${error.message || error}`);
      }
    });
    grid.appendChild(card);
  }
}

async function loadGallery() {
  try {
    const data = await fetchJson(stateUrl);
    settings = {
      ...settings,
      ...(data.state?.settings || {}),
    };
    autoStoreToggle.checked = Boolean(settings.autoStore);
    openOnStartToggle.checked = Boolean(settings.openOnStart);
    updateRoomOptions(data.roomConfig);
    renderImages(data.state?.images || []);
    setStatus(`保存目录：${data.dataDir || "ComfyUI/user/image_hang_gallery"}`);
  } catch (error) {
    setStatus(`读取画廊失败：${error.message || error}`);
  }
}

async function saveSettings() {
  try {
    await fetchJson(settingsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setStatus(settings.autoStore ? "自动收集已开启" : "自动收集已关闭");
  } catch (error) {
    setStatus(`保存设置失败：${error.message || error}`);
  }
}

async function importGeneratedImages(images) {
  if (!settings.autoStore || !images?.length) {
    return;
  }

  const fresh = settings.dedupeGenerated
    ? images.filter((image) => !knownFingerprints.has(imageFingerprint(image)))
    : images;

  if (!fresh.length) {
    return;
  }

  try {
    const result = await fetchJson(importUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: fresh, targetRoomIndex: Number(settings.targetRoomIndex) || 0 }),
    });
    if (result.imported?.length) {
      panel.classList.add("open");
      await loadGallery();
      setStatus(`已自动保存 ${result.imported.length} 张生成图`);
    }
  } catch (error) {
    setStatus(`自动保存失败：${error.message || error}`);
  }
}

function listenForGeneratedImages() {
  api.addEventListener("executed", ({ detail }) => {
    if (detail?.output?.images?.length) {
      void importGeneratedImages(detail.output.images);
    }
  });
}

app.registerExtension({
  name: "ImageHang.GalleryPanel",
  async setup() {
    injectStyle();
    makePanel();
    makeToggleButton();
    await loadGallery();
    listenForGeneratedImages();

    if (settings.openOnStart) {
      window.setTimeout(() => panel.classList.add("open"), 600);
    }
  },
});
