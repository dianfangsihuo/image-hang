from __future__ import annotations

import asyncio
import json
import os
import socket
import shutil
import subprocess
import time
import uuid
import urllib.request
from pathlib import Path
from typing import Any

from aiohttp import web
from PIL import Image

import folder_paths
from server import PromptServer


WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


DATA_DIR = Path(folder_paths.get_user_directory()) / "image_hang_gallery"
IMAGE_DIR = DATA_DIR / "images"
STATE_FILE = DATA_DIR / "gallery.json"
VIEWER_PROCESS: subprocess.Popen[bytes] | None = None
VIEWER_PORT: int | None = None

DEFAULT_SETTINGS = {
    "autoStore": False,
    "openOnStart": True,
    "dedupeGenerated": True,
}

DEFAULT_ROOM_CONFIG = {
    "width": 18,
    "depth": 22,
    "height": 5.2,
    "roomCount": 1,
    "rooms": [{"width": 18, "depth": 22, "height": 5.2}],
}

DEFAULT_EDITOR_SETTINGS = {
    "shortcuts": {
        "openMarket": "KeyB",
        "toggleView": "KeyV",
        "moveTool": "KeyG",
        "rotateTool": "KeyR",
        "scaleTool": "KeyS",
        "nudgeLeft": "KeyJ",
        "nudgeRight": "KeyL",
        "nudgeForward": "KeyI",
        "nudgeBackward": "KeyK",
        "rotateLeft": "KeyQ",
        "rotateRight": "KeyE",
        "scaleUp": "Equal",
        "scaleDown": "Minus",
        "grabSelection": "KeyF",
        "deleteSelection": "Delete",
    },
    "mouseSensitivity": 0.0024,
    "walkSpeed": 4.2,
    "sprintSpeed": 7.1,
    "jumpPower": 5.4,
}


VIEWER_HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Image Hang 画廊</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: #f7f0e3;
      background: #15120f;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .gallery-shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background:
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px) 0 0 / 42px 42px,
        linear-gradient(180deg, #211b16 0%, #16130f 64%, #100e0c 100%);
    }

    header {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px clamp(18px, 4vw, 44px);
      border-bottom: 1px solid rgba(255,255,255,.12);
      background: rgba(20, 17, 14, .86);
      backdrop-filter: blur(14px);
    }

    h1 {
      margin: 0;
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1;
      letter-spacing: 0;
    }

    .meta {
      color: #d5c7b5;
      font-size: 14px;
    }

    .gallery-wall {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: clamp(18px, 4vw, 44px);
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: clamp(18px, 3vw, 34px);
      align-items: start;
    }

    .art-frame {
      border: 12px solid #3a2b1f;
      border-radius: 6px;
      padding: 8px;
      background: #120f0c;
      box-shadow:
        0 20px 38px rgba(0,0,0,.34),
        inset 0 0 0 1px rgba(255,255,255,.1);
      cursor: zoom-in;
      transform: translateZ(0);
      transition: transform .18s ease, box-shadow .18s ease;
    }

    .art-frame:hover {
      transform: translateY(-4px);
      box-shadow:
        0 26px 48px rgba(0,0,0,.44),
        inset 0 0 0 1px rgba(255,255,255,.12);
    }

    .art-frame img {
      display: block;
      width: 100%;
      aspect-ratio: 1 / .72;
      object-fit: cover;
      background: #0b0908;
    }

    .art-frame figcaption {
      margin-top: 8px;
      overflow: hidden;
      color: #eadcc9;
      font-size: 14px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty {
      max-width: 640px;
      margin: 12vh auto;
      padding: 0 24px;
      color: #d5c7b5;
      text-align: center;
      font-size: 18px;
    }

    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 28px;
      background: rgba(5, 4, 3, .9);
    }

    .lightbox.open {
      display: flex;
    }

    .lightbox img {
      max-width: min(94vw, 1500px);
      max-height: 82vh;
      object-fit: contain;
      box-shadow: 0 28px 70px rgba(0,0,0,.54);
    }

    .lightbox-title {
      position: fixed;
      left: 28px;
      right: 28px;
      bottom: 24px;
      overflow: hidden;
      color: #f7f0e3;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lightbox button {
      position: fixed;
      top: 22px;
      right: 22px;
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #2f281f;
      background: #eadcc9;
      font-weight: 800;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="gallery-shell">
    <header>
      <h1>Image Hang 画廊</h1>
      <span class="meta" id="meta">读取中...</span>
    </header>
    <section class="gallery-wall" id="wall"></section>
    <p class="empty" id="empty" hidden>画廊里还没有图片。回到 ComfyUI 面板开启自动收集，生成完成后再来欣赏。</p>
  </main>

  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true">
    <button type="button" id="close">关闭</button>
    <img id="large" alt="">
    <div class="lightbox-title" id="title"></div>
  </div>

  <script>
    const wall = document.getElementById("wall");
    const meta = document.getElementById("meta");
    const empty = document.getElementById("empty");
    const lightbox = document.getElementById("lightbox");
    const large = document.getElementById("large");
    const title = document.getElementById("title");
    const closeButton = document.getElementById("close");
    let images = [];
    let currentIndex = -1;

    function openImage(index) {
      currentIndex = index;
      const image = images[index];
      large.src = image.url;
      large.alt = image.name || "";
      title.textContent = image.name || "Untitled";
      lightbox.classList.add("open");
    }

    function closeImage() {
      lightbox.classList.remove("open");
      large.removeAttribute("src");
      currentIndex = -1;
    }

    function moveImage(delta) {
      if (currentIndex < 0 || images.length < 2) {
        return;
      }
      openImage((currentIndex + delta + images.length) % images.length);
    }

    async function loadGallery() {
      try {
        const response = await fetch("/image-hang-gallery/state", { cache: "no-store" });
        const data = await response.json();
        images = data.state?.images || [];
        meta.textContent = `${images.length} 张作品`;
        empty.hidden = images.length > 0;
        wall.innerHTML = "";

        images.forEach((image, index) => {
          const frame = document.createElement("figure");
          const img = document.createElement("img");
          const caption = document.createElement("figcaption");
          frame.className = "art-frame";
          img.src = image.url;
          img.loading = "lazy";
          img.alt = "";
          caption.title = image.name || "";
          caption.textContent = image.name || "Untitled";
          frame.append(img, caption);
          frame.addEventListener("click", () => openImage(index));
          wall.appendChild(frame);
        });
      } catch (error) {
        meta.textContent = "读取失败";
        empty.hidden = false;
        empty.textContent = `读取画廊失败：${error.message || error}`;
      }
    }

    closeButton.addEventListener("click", closeImage);
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        closeImage();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeImage();
      }
      if (event.key === "ArrowLeft") {
        moveImage(-1);
      }
      if (event.key === "ArrowRight") {
        moveImage(1);
      }
    });

    void loadGallery();
  </script>
</body>
</html>"""


def _ensure_dirs() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "images": [],
        "settings": DEFAULT_SETTINGS.copy(),
    }


def _load_state() -> dict[str, Any]:
    _ensure_dirs()
    if not STATE_FILE.exists():
        return _default_state()

    try:
        with STATE_FILE.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except Exception:
        return _default_state()

    state.setdefault("version", 1)
    state.setdefault("images", [])
    state["settings"] = {
        **DEFAULT_SETTINGS,
        **state.get("settings", {}),
    }
    return state


def _save_state(state: dict[str, Any]) -> None:
    _ensure_dirs()
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)
        file.write("\n")
    tmp.replace(STATE_FILE)


def _json_response(payload: Any) -> web.Response:
    return web.json_response(payload, dumps=lambda data: json.dumps(data, ensure_ascii=False))


def _project_root() -> Path | None:
    env_root = os.environ.get("IMAGE_HANG_PROJECT_ROOT")
    candidates = []

    if env_root:
        candidates.append(Path(env_root))

    current = Path(__file__).resolve()
    candidates.extend(current.parents)
    candidates.append(Path.home() / "Documents" / "image hang")

    for candidate in candidates:
        if (candidate / "package.json").is_file() and (candidate / "src" / "App.tsx").is_file():
            return candidate

    return None


def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _is_url_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:
            return 200 <= response.status < 500
    except Exception:
        return False


def _find_viewer_port() -> int:
    for port in range(5174, 5200):
        if _is_port_free(port):
            return port
    raise RuntimeError("没有可用的本地画廊端口")


def _list_value(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and value:
        return [value]
    return []


def _dict_value(value: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    return value if isinstance(value, dict) else fallback


def _copy_state_to_project(project_root: Path) -> None:
    state = _load_state()
    local_data_dir = project_root / ".gallery-data"
    local_image_dir = local_data_dir / "images"
    local_gallery_file = local_data_dir / "gallery.json"
    local_image_dir.mkdir(parents=True, exist_ok=True)

    existing: dict[str, Any] = {}
    if local_gallery_file.is_file():
        try:
            with local_gallery_file.open("r", encoding="utf-8") as file:
                loaded = json.load(file)
                if isinstance(loaded, dict):
                    existing = loaded
        except Exception:
            existing = {}

    images = []
    for image in state.get("images", []):
        filename = os.path.basename(image.get("filename", ""))
        source = IMAGE_DIR / filename
        if not filename or not source.is_file():
            continue

        target = local_image_dir / filename
        shutil.copy2(source, target)
        images.append(
            {
                "id": image.get("id") or str(uuid.uuid4()),
                "name": image.get("name") or filename,
                "url": f"/gallery-data/images/{filename}",
                "width": image.get("width") or 1024,
                "height": image.get("height") or 768,
                "createdAt": image.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "source": "local",
            }
        )

    local_state = {
        "images": images,
        "layouts": _dict_value(existing.get("layouts"), {}),
        "roomConfig": _dict_value(existing.get("roomConfig"), DEFAULT_ROOM_CONFIG),
        "customWalls": _list_value(existing.get("customWalls")),
        "doors": _list_value(existing.get("doors")),
        "editorSettings": _dict_value(existing.get("editorSettings"), DEFAULT_EDITOR_SETTINGS),
    }

    with local_gallery_file.open("w", encoding="utf-8") as file:
        json.dump(local_state, file, ensure_ascii=False, indent=2)
        file.write("\n")


def _start_viewer_service(project_root: Path) -> str:
    global VIEWER_PROCESS, VIEWER_PORT

    if VIEWER_PORT and _is_url_ready(f"http://127.0.0.1:{VIEWER_PORT}/"):
        return f"http://127.0.0.1:{VIEWER_PORT}/"

    if VIEWER_PROCESS and VIEWER_PROCESS.poll() is None:
        VIEWER_PROCESS.terminate()

    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise RuntimeError("找不到 npm，请先安装 Node.js")

    if not (project_root / "node_modules").is_dir():
        subprocess.run([npm, "install"], cwd=project_root, check=True)

    port = _find_viewer_port()
    VIEWER_PROCESS = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", str(port), "--host", "127.0.0.1"],
        cwd=project_root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    VIEWER_PORT = port
    url = f"http://127.0.0.1:{port}/"

    for _ in range(60):
        if VIEWER_PROCESS.poll() is not None:
            raise RuntimeError("画廊服务启动失败")
        if _is_url_ready(url):
            return url
        time.sleep(0.25)

    return url


def _launch_viewer_url() -> str:
    project_root = _project_root()
    if project_root is None:
        raise RuntimeError("找不到 Image Hang 项目目录。可设置 IMAGE_HANG_PROJECT_ROOT 指向项目根目录。")

    _copy_state_to_project(project_root)
    return _start_viewer_service(project_root)


def _safe_rel_path(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.replace("\\", "/").strip("/")
    parts = [part for part in cleaned.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)


def _source_path(image: dict[str, Any]) -> Path | None:
    filename = image.get("filename")
    if not filename:
        return None

    folder_type = image.get("type", "output")
    base = folder_paths.get_directory_by_type(folder_type)
    if base is None:
        return None

    subfolder = _safe_rel_path(image.get("subfolder"))
    base_path = Path(base).resolve()
    source = (base_path / subfolder / os.path.basename(filename)).resolve()

    try:
        source.relative_to(base_path)
    except ValueError:
        return None

    return source if source.is_file() else None


def _image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def _gallery_url(filename: str) -> str:
    return f"/image-hang-gallery/image/{filename}"


def _record_for_file(
    source: Path,
    *,
    original_name: str | None = None,
    origin: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ensure_dirs()
    image_id = str(uuid.uuid4())
    extension = source.suffix.lower() or ".png"
    dest_name = f"{image_id}{extension}"
    dest = IMAGE_DIR / dest_name
    shutil.copy2(source, dest)
    width, height = _image_size(dest)

    return {
        "id": image_id,
        "name": original_name or source.name,
        "filename": dest_name,
        "url": _gallery_url(dest_name),
        "width": width,
        "height": height,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": "local",
        "origin": origin or {},
    }


def _fingerprint(image: dict[str, Any]) -> str:
    return json.dumps(
        {
            "filename": image.get("filename", ""),
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


@PromptServer.instance.routes.get("/image-hang-gallery/state")
async def get_state(request: web.Request) -> web.Response:
    state = _load_state()
    return _json_response(
        {
            "ok": True,
            "state": state,
            "dataDir": str(DATA_DIR),
        }
    )


@PromptServer.instance.routes.get("/image-hang-gallery/viewer")
async def get_viewer(request: web.Request) -> web.Response:
    try:
        raise web.HTTPFound(await asyncio.to_thread(_launch_viewer_url))
    except web.HTTPFound:
        raise
    except Exception as error:
        return web.Response(
            text=f"启动 Image Hang 画廊失败：{error}",
            content_type="text/plain",
            status=500,
        )


async def _launch_viewer_response() -> web.Response:
    try:
        url = await asyncio.to_thread(_launch_viewer_url)
    except Exception as error:
        return _json_response(
            {
                "ok": False,
                "error": str(error),
            }
        )

    return _json_response(
        {
            "ok": True,
            "url": url,
        }
    )


@PromptServer.instance.routes.get("/image-hang-gallery/launch-viewer")
async def launch_viewer_get(request: web.Request) -> web.Response:
    return await _launch_viewer_response()


@PromptServer.instance.routes.post("/image-hang-gallery/launch-viewer")
async def launch_viewer_post(request: web.Request) -> web.Response:
    return await _launch_viewer_response()


@PromptServer.instance.routes.post("/image-hang-gallery/settings")
async def update_settings(request: web.Request) -> web.Response:
    body = await request.json()
    state = _load_state()
    state["settings"] = {
        **DEFAULT_SETTINGS,
        **state.get("settings", {}),
        **(body.get("settings", {}) if isinstance(body, dict) else {}),
    }
    _save_state(state)
    return _json_response({"ok": True, "settings": state["settings"]})


@PromptServer.instance.routes.post("/image-hang-gallery/import-generated")
async def import_generated(request: web.Request) -> web.Response:
    body = await request.json()
    images = body.get("images", []) if isinstance(body, dict) else []
    state = _load_state()
    settings = state.get("settings", DEFAULT_SETTINGS)
    existing = {
        item.get("origin", {}).get("fingerprint")
        for item in state.get("images", [])
        if item.get("origin", {}).get("fingerprint")
    }
    imported: list[dict[str, Any]] = []
    skipped = 0

    for image in images:
        if not isinstance(image, dict):
            continue

        fingerprint = _fingerprint(image)
        if settings.get("dedupeGenerated", True) and fingerprint in existing:
            skipped += 1
            continue

        source = _source_path(image)
        if source is None:
            skipped += 1
            continue

        record = _record_for_file(
            source,
            original_name=image.get("filename"),
            origin={
                "kind": "comfyui-generated",
                "fingerprint": fingerprint,
                "filename": image.get("filename"),
                "subfolder": image.get("subfolder", ""),
                "type": image.get("type", "output"),
            },
        )
        state["images"].insert(0, record)
        existing.add(fingerprint)
        imported.append(record)

    if imported:
        _save_state(state)

    return _json_response({"ok": True, "imported": imported, "skipped": skipped})


@PromptServer.instance.routes.delete("/image-hang-gallery/image/{image_id}")
async def delete_image(request: web.Request) -> web.Response:
    image_id = request.match_info["image_id"]
    state = _load_state()
    kept = []
    removed = None

    for image in state.get("images", []):
        if image.get("id") == image_id:
            removed = image
            continue
        kept.append(image)

    state["images"] = kept
    if removed:
        filename = os.path.basename(removed.get("filename", ""))
        if filename:
            try:
                (IMAGE_DIR / filename).unlink(missing_ok=True)
            except Exception:
                pass
        _save_state(state)

    return _json_response({"ok": True, "removed": bool(removed)})


@PromptServer.instance.routes.get("/image-hang-gallery/image/{filename}")
async def get_image(request: web.Request) -> web.StreamResponse:
    filename = os.path.basename(request.match_info["filename"])
    path = IMAGE_DIR / filename
    if not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path)
