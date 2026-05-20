import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const projectRoot = path.resolve(process.env.INIT_CWD || process.cwd());
const dataDir = path.join(projectRoot, ".gallery-data");
const imageDir = path.join(dataDir, "images");
const galleryFile = path.join(dataDir, "gallery.json");

const defaultRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
  roomCount: 1,
  rooms: [{ width: 18, depth: 22, height: 5.2 }],
};

const defaultEditorSettings = {
  shortcuts: {
    openMarket: "KeyB",
    toggleView: "KeyV",
    moveTool: "KeyG",
    rotateTool: "KeyR",
    scaleTool: "KeyS",
    nudgeLeft: "KeyJ",
    nudgeRight: "KeyL",
    nudgeForward: "KeyI",
    nudgeBackward: "KeyK",
    rotateLeft: "KeyQ",
    rotateRight: "KeyE",
    scaleUp: "Equal",
    scaleDown: "Minus",
    grabSelection: "KeyF",
    deleteSelection: "Delete",
  },
  mouseSensitivity: 0.0024,
  walkSpeed: 4.2,
  sprintSpeed: 7.1,
  jumpPower: 5.4,
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function safeImageExtension(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  return "jpg";
}

function listValue(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
}

function objectValue<T extends object>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

function normalizeGalleryState(value: unknown) {
  const state = objectValue<Record<string, unknown>>(value, {});

  return {
    images: listValue(state.images),
    layouts: objectValue(state.layouts, {}),
    roomConfig: objectValue(state.roomConfig, defaultRoomConfig),
    customWalls: listValue(state.customWalls),
    doors: listValue(state.doors),
    editorSettings: objectValue(state.editorSettings, defaultEditorSettings),
  };
}

function localGalleryPersistencePlugin(): Plugin {
  return {
    name: "local-gallery-persistence",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => {
        if (!request.url) {
          next();
          return;
        }

        const url = new URL(request.url, "http://localhost");

        if (url.pathname.startsWith("/gallery-data/images/")) {
          const fileName = path.basename(url.pathname);
          const filePath = path.join(imageDir, fileName);

          try {
            const file = await fs.readFile(filePath);
            response.statusCode = 200;
            response.setHeader("Cache-Control", "no-store");
            response.end(file);
          } catch {
            response.statusCode = 404;
            response.end("Not found");
          }
          return;
        }

        if (url.pathname === "/api/local-gallery/debug" && request.method === "GET") {
          sendJson(response, 200, {
            projectRoot,
            dataDir,
            galleryFile,
            exists: await fs.stat(galleryFile).then(() => true).catch(() => false),
          });
          return;
        }

        if (url.pathname === "/api/local-gallery" && request.method === "GET") {
          try {
            const raw = await fs.readFile(galleryFile, "utf8");
            sendJson(response, 200, {
              exists: true,
              state: normalizeGalleryState(JSON.parse(raw.replace(/^\uFEFF/, ""))),
            });
          } catch {
            sendJson(response, 200, { exists: false, state: null });
          }
          return;
        }

        if (url.pathname === "/api/local-gallery" && request.method === "POST") {
          try {
            await fs.mkdir(dataDir, { recursive: true });
            const body = await readBody(request);
            const state = normalizeGalleryState(JSON.parse(body));
            await fs.writeFile(galleryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
            sendJson(response, 200, { ok: true });
          } catch (error) {
            sendJson(response, 500, {
              ok: false,
              error: error instanceof Error ? error.message : "Failed to save gallery",
            });
          }
          return;
        }

        if (url.pathname === "/api/local-gallery/images" && request.method === "POST") {
          try {
            await fs.mkdir(imageDir, { recursive: true });
            const body = await readBody(request);
            const payload = JSON.parse(body) as {
              id: string;
              mimeType: string;
              data: string;
            };
            const extension = safeImageExtension(payload.mimeType);
            const fileName = `${payload.id}.${extension}`;
            const filePath = path.join(imageDir, fileName);
            await fs.writeFile(filePath, Buffer.from(payload.data, "base64"));
            sendJson(response, 200, { url: `/gallery-data/images/${fileName}` });
          } catch (error) {
            sendJson(response, 500, {
              error: error instanceof Error ? error.message : "Failed to save image",
            });
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localGalleryPersistencePlugin()],
});
