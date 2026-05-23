# ComfyUI Image Hang Gallery

ComfyUI Image Hang Gallery 是一个给 ComfyUI 使用的 3D 画廊扩展。它可以自动收集 ComfyUI 生成图，在 ComfyUI 页面里管理作品，并一键打开独立 3D 画廊，把作品挂进可行走的展厅。

## 展示

![ComfyUI Image Hang Gallery 宣传片段](docs/images/showcase-preview.gif)

完整宣传视频：[`image-hang-showcase.mp4`](image-hang-showcase.mp4)

B 站演示视频：[ComfyUI 生图直接挂进 3D 画廊！插件演示](https://www.bilibili.com/video/BV1ruLb69Ecc/)

| 观赏模式 | 第一人称编辑 |
| --- | --- |
| ![观赏模式中的 3D 画廊](docs/images/showcase-view-mode.png) | ![第一人称编辑挂画](docs/images/showcase-first-person-edit.png) |

| 俯视编辑 | 自定义组件 |
| --- | --- |
| ![俯视编辑房间布局](docs/images/showcase-topdown-edit.png) | ![自定义组件与画廊面板](docs/images/showcase-components.png) |

## 功能

- ComfyUI 右下角提供可拖动、可缩放的画廊面板。
- 自动收集工作流生成图，支持查看和删除。
- 点击 `进入画廊` 后自动安装缺失的前端依赖、启动本地 3D 画廊服务。
- 3D 画廊支持观赏模式、编辑模式、房间扩展、自定义墙、门、挂画位置和尺寸调整。
- 画廊数据保存到项目文件，不依赖浏览器缓存；换 Chrome、Edge 或不同浏览器 Profile 也能沿用同一套作品和地图。

## 推荐安装

ComfyUI 官方推荐优先使用 ComfyUI Manager 管理自定义节点；如果节点还没有注册到 Manager 搜索列表，就使用 Git clone 或 ZIP 手动安装。本扩展已经支持直接把仓库根目录放进 `custom_nodes`。

进入 ComfyUI 的 `custom_nodes` 目录，直接 clone 本仓库：

```powershell
cd D:\path\to\ComfyUI\custom_nodes
git clone https://github.com/dianfangsihuo/ComfyUI-ImageHang-Gallery.git
```

重启 ComfyUI 后，页面右下角会出现 `画廊` 按钮。

如果你的 ComfyUI Manager 支持从 Git URL 安装，也可以填入：

```text
https://github.com/dianfangsihuo/ComfyUI-ImageHang-Gallery.git
```

Manager 安装后同样可以直接重启 ComfyUI 使用。第一次点击 `进入画廊` 时，扩展会自动检查并安装 3D 画廊前端依赖，然后启动本地服务。你不需要手动运行 `npm install`。如果机器上没有 Node.js/npm，面板会提示先安装 Node.js。

## ZIP 安装

如果不使用 Git，也可以在 GitHub 下载 ZIP：

1. 打开 `https://github.com/dianfangsihuo/ComfyUI-ImageHang-Gallery`
2. 点击 `Code` -> `Download ZIP`
3. 解压后把整个文件夹放到：

```text
ComfyUI/custom_nodes/ComfyUI-ImageHang-Gallery
```

4. 重启 ComfyUI。

## ComfyUI 使用

打开 ComfyUI 后点击右下角 `画廊`：

- 勾选 `自动收集生成图`，工作流执行完成后，输出图片会自动进入画廊。
- 勾选 `启动后自动弹出`，下次打开 ComfyUI 会自动展开面板。
- 图片较多时，面板会自动分页显示，避免画作列表把 ComfyUI 操作区挤满。
- 自动挂画时如果目标房间已满，会继续尝试其他房间；全部房间都满时会在面板里提示。
- 拖动画廊标题栏可以移动面板。
- 拖动右下角手柄可以缩放面板。
- 点击 `进入画廊` 会自动安装缺失依赖、启动本地 3D 画廊服务，并打开浏览器页面。

ComfyUI 原始收集数据保存在：

```text
ComfyUI/user/image_hang_gallery/gallery.json
ComfyUI/user/image_hang_gallery/images/
```

## 独立 3D 画廊

也可以不从 ComfyUI 打开，直接在仓库目录启动：

```powershell
npm install
npm run dev
```

默认会打开类似：

```text
http://127.0.0.1:5174/
```

如果 `5174` 被占用，Vite 会提示另一个端口。

## 跨浏览器保存

3D 画廊的共享数据保存在仓库目录：

```text
.gallery-data/gallery.json
.gallery-data/images/
```

这里会保存：

- 作品列表和图片文件
- 每张画的墙面、位置、高度、尺寸
- 房间数量、房间尺寸和位置
- 自定义墙
- 门
- 编辑器设置和快捷键

因此只要打开的是同一个本地 ComfyUI Image Hang Gallery 服务，不管使用哪个浏览器，都能看到同一套画廊地图和作品。

## 操作

- 观赏模式：点击 `进入画廊`，使用 `WASD` 移动，`Shift` 奔跑，`Space` 跳跃。
- 编辑模式：选择画作或点击场景中的画框，然后调整墙面、位置、高度和尺寸。
- 俯视编辑：选择房间、门、画作等对象进行摆放；按住 `F` 可固定视角并拖动已选对象。
- 作品列表会显示每张画所在房间，可拖动画作到房间按钮上，或用卡片里的房间下拉直接移动。
- 上传图片后会进入待放置状态，点击墙面即可挂画。
- 点击 `保存到本地` 会立即写入 `.gallery-data/gallery.json`，自动保存也会持续更新本地文件。

## 项目结构

```text
__init__.py                                      ComfyUI 根入口，支持直接 clone 到 custom_nodes
comfyui-extension/ComfyUI-ImageHang-Gallery/    ComfyUI 扩展实现
src/                                             3D 画廊应用源码
vite.config.ts                                  本地文件保存接口
.gallery-data/                                  运行时本地画廊数据，不提交到仓库
```

## 更多截图

![ComfyUI Image Hang Gallery 3D 画廊演示](docs/images/image-hang-gallery-demo.png)

![ComfyUI 工作流中的画廊插件演示](docs/images/comfyui-gallery-plugin-demo.png)

