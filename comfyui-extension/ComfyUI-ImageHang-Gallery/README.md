# ComfyUI Image Hang Gallery

Image Hang 的 ComfyUI 集成扩展。推荐直接安装仓库根目录，而不是只复制这个子目录。

## 推荐安装

如果 ComfyUI Manager 已经能通过 Git URL 安装仓库，可以直接使用：

```text
https://github.com/dianfangsihuo/image-hang.git
```

如果使用手动安装，执行：

```powershell
cd D:\path\to\ComfyUI\custom_nodes
git clone https://github.com/dianfangsihuo/image-hang.git
cd image-hang
npm install
```

重启 ComfyUI 后，右下角会出现 `画廊` 按钮。

## ZIP 安装

也可以从 GitHub 下载 ZIP，解压后把整个仓库目录放到：

```text
ComfyUI/custom_nodes/image-hang
```

然后在 `image-hang` 目录运行：

```powershell
npm install
```

最后重启 ComfyUI。

## 功能

- 在 ComfyUI 页面添加可拖动、可缩放的画廊面板。
- 查看和删除已收集图片。
- `自动收集生成图`：工作流执行完成后自动保存输出图片。
- `启动后自动弹出`：打开 ComfyUI 后自动展开面板。
- `进入画廊`：自动启动本地 3D 画廊服务，并打开可行走的展厅。

## 保存位置

ComfyUI 生成图先保存到：

```text
ComfyUI/user/image_hang_gallery/gallery.json
ComfyUI/user/image_hang_gallery/images/
```

点击 `进入画廊` 时，扩展会把图片同步到仓库的本地画廊数据：

```text
image-hang/.gallery-data/gallery.json
image-hang/.gallery-data/images/
```

`.gallery-data/gallery.json` 会保存作品、挂画位置、房间、自定义墙、门和编辑器设置。因为它是项目文件，不是浏览器缓存，所以换浏览器也能沿用同一套画廊地图。

## 使用步骤

1. 重启 ComfyUI。
2. 点击右下角 `画廊`。
3. 勾选 `自动收集生成图`。
4. 正常运行工作流生成图片。
5. 图片进入面板后点击 `进入画廊`。
6. 在 3D 画廊里切到编辑模式，布置房间和挂画。
7. 点击 `保存到本地`，后续也会自动保存到 `.gallery-data/gallery.json`。

## 结构

```text
image-hang/
  __init__.py                                      ComfyUI 根入口
  comfyui-extension/ComfyUI-ImageHang-Gallery/
    __init__.py                                    后端路由、本地保存、启动 3D 服务
    web/image_hang_gallery.js                      ComfyUI 前端面板
  src/                                             独立 3D 画廊
  vite.config.ts                                   .gallery-data 本地保存接口
```
