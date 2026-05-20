from __future__ import annotations

import importlib.util
from pathlib import Path


_ROOT = Path(__file__).resolve().parent
_IMPL = _ROOT / "comfyui-extension" / "ComfyUI-ImageHang-Gallery" / "__init__.py"

_spec = importlib.util.spec_from_file_location("image_hang_gallery_impl", _IMPL)
if _spec is None or _spec.loader is None:
    raise ImportError(f"Cannot load Image Hang Gallery extension from {_IMPL}")

_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

WEB_DIRECTORY = "comfyui-extension/ComfyUI-ImageHang-Gallery/web"
NODE_CLASS_MAPPINGS = _module.NODE_CLASS_MAPPINGS
NODE_DISPLAY_NAME_MAPPINGS = _module.NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
