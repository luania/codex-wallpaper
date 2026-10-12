# Codex Wallpaper

Codex Wallpaper 的核心功能是把本地图片作为 ChatGPT 桌面应用的背景，并按窗口方向自动轮替。你可以直接使用已有图片；Pixiv 下载命令只是可选的图片来源，放在本文最后。

## 环境要求

- macOS，且已安装 ChatGPT 桌面应用。`pnpm codex:start` 默认从 `/Applications/ChatGPT.app` 启动应用。
- Node.js 24 或更高版本。
- pnpm 11.10.0（项目在 `package.json` 中声明的版本）。

在项目根目录安装依赖：

```sh
pnpm install
```

## 快速开始

1. 将一张或多张支持的图片复制到 `downloads/`，可使用 Finder 或其他文件管理器。
2. 启动带本机调试端口的 ChatGPT 应用：

   ```sh
   pnpm codex:start
   ```

3. 等待应用打开并进入要显示背景的页面，再在另一个终端运行：

   ```sh
   pnpm inject
   ```

默认会递归读取整个 `downloads/`。也可以只注入某个子目录：

```sh
pnpm inject my-wallpapers
```

路径相对于 `downloads/`，不要加 `downloads/` 前缀；不支持绝对路径或跳出该目录的路径。注入至少需要一张受支持的图片。刷新应用页面后，需要重新运行 `pnpm inject`。

## 实现原理

1. Node.js 递归扫描所选目录，按相对路径排序，并读取图片尺寸，用于区分横图和竖图。
2. Playwright 连接 `127.0.0.1:9341` 上的 ChatGPT 应用，通过目录选择 input 将本地文件交给页面。图片由页面读取，不需要启动本地文件服务器。
3. 页面根据窗口方向选择图片，按需解码并创建图片 URL，再负责轮替、淡入淡出和显示效果。注入脚本退出后，页面中的背景仍会继续运行。

## 图片与轮替

支持 JPG/JPEG、PNG、WebP、GIF、AVIF、BMP 和 SVG。图片按相对路径自然排序。横向窗口优先使用横图，竖向窗口优先使用竖图；对应方向没有图片时回退到另一方向。正方形按横图处理；无法预先读取尺寸的图片会在浏览器中判断。

默认每 5 分钟轮替一次，淡入淡出时长为 1000 毫秒。窗口从横向切换到竖向或相反方向时会立即换图；同一方向内调整窗口大小不会切图。损坏或无法解码的图片会跳过，每张最多等待 15 秒。图片仅在首次显示或切换到它时解码，并在需要显示时创建 URL，不再使用时回收。

底部进度线显示本轮轮替进度。关闭自动轮替或当前窗口方向只有一张可用图片时，进度线隐藏。当前注入会话保留最近 20 张历史图片；刷新或重新注入后历史清空。

## 设置与快捷键

按 `⌘/Ctrl + Alt + ,` 打开设置面板。修改即时生效，并保存到当前应用页面的 `localStorage`；重新注入后会继续使用上次设置。面板可配置自动轮替、轮替间隔、淡入淡出、模糊、不透明度、前景图显示状态、`mixBlendMode`、`objectFit`、纯享模式自动进入和空闲时间，也可重新录入快捷键。快捷键冲突时会拒绝保存并提示。

| 默认按键 | 功能 |
| --- | --- |
| `⌘/Ctrl + Alt + ,` | 打开设置面板 |
| `⌘/Ctrl + Alt + →` | 前进历史；到最新记录后随机切换图片 |
| `⌘/Ctrl + Alt + ←` | 回看上一张历史图片，最多保留 20 张 |
| `⌘/Ctrl + Alt + Space` | 显示或隐藏前景图 |
| `⌘/Ctrl + Alt + ↑` / `↓` | 增加或减少模糊值，每次 1 px；最低为 0 px |
| `⌘/Ctrl + Alt + 滚轮 ↑` / `↓` | 增加或减少不透明度，每次 0.01 |
| `⌘/Ctrl + Alt + C` | 复制当前图片相对路径 |
| `F5` 按住 | 临时查看当前图片原图；松开后恢复效果 |
| `F4` 双击 | 开启或退出纯享模式 |
| 纯享模式中按住 `F4` | 临时显示完整界面；松开后恢复纯享模式 |

面板可调范围：轮替间隔 10 秒到 1 小时，淡入淡出 0 到 5000 毫秒，模糊 0 到 500 px，不透明度 0 到 100%，空闲时间 5 秒到 10 分钟。`mixBlendMode` 和 `objectFit` 使用浏览器支持的固定选项，默认分别为 `screen` 和 `cover`。默认模糊为 0 px，不透明度为 0.33。切图、窗口方向变化或隐藏前景图不会重置这些显示设置。调整数值时会短暂显示当前值；按 `C` 复制路径后会显示“已复制”。

快捷键中的 `Primary` 在 macOS 上表示 Command，在 Windows/Linux 上表示 Ctrl。设置使用版本化键 `__pixiv_inject_settings_v1__` 保存，只在当前浏览器配置的页面中生效。

## 纯享模式

默认在鼠标和键盘连续 30 秒没有活动后自动进入。纯享模式保留主对话内容并隐藏主区域以外的界面；打开的设置面板和 Composer 菜单保持可见。鼠标点击或移动不会退出纯享模式，双击 `F4` 可退出。按住单独的 `F4` 会暂时显示完整界面，松开后恢复纯享模式。两次按下间隔超过约 300 毫秒时按单次按住处理。进入和退出使用约 200 毫秒淡变效果。

## 目录与辅助命令

| 路径 | 内容 |
| --- | --- |
| `downloads/` | 本地背景图片及可选下载内容，也是默认注入目录 |
| `imgs/YYYY-MM-DD/` | 可选的 Pixiv 日榜图片 |
| `data/` | 下载记录、日志和辅助数据 |
| `codex-snapshot/` | 页面快照命令生成的文件 |

上述生成目录以及本地 Pixiv 配置由 `.gitignore` 排除。仍需避免分享含有账号凭据或个人下载内容的文件。

生成当前已连接页面的本地快照，并在 Chrome 中打开：

```sh
pnpm codex:snapshot
```

快照命令需要 `pnpm codex:start` 启动的调试端口，输出到 `codex-snapshot/`，本地预览使用端口 `8765`。运行项目测试：

```sh
pnpm test
```

## 常见问题

- **找不到调试端口或可注入页面：**确认已运行 `pnpm codex:start`，等待 ChatGPT 应用和目标页面打开。脚本连接 `127.0.0.1:9341`。
- **提示下载目录不存在或没有支持的图片：**创建 `downloads/` 并放入支持的图片；使用子目录参数时，确认路径相对于 `downloads/`。
- **注入后没有背景或设置未生效：**确认注入命令成功完成。重新加载应用页面会清除注入，需要再次运行 `pnpm inject`。

## 可选：从 Pixiv 获取图片

以下命令只是获取本地图片的可选方式；只使用自己的图片时，可以跳过本节。Pixiv 月榜和画师下载使用 PixivFlow，需要本地配置和有效的 `pixiv.refreshToken`。安装依赖后，复制随包提供的排行榜配置示例并登录：

```sh
cp node_modules/pixivflow/config/examples/standalone.config.ranking.json pixivflow-ranking.config.json
pnpm exec pixivflow login --config ./pixivflow-ranking.config.json
```

登录后确认 `pixiv.refreshToken` 已写入配置。配置文件位于项目根目录并被 Git 忽略。Refresh token 等同于登录凭据，不要提交、公开粘贴或分享包含它的配置文件。画师下载可以通过 `--config <路径>` 使用其他配置；月榜命令固定读取根目录的 `pixivflow-ranking.config.json`。

### Pixiv 日榜

下载最新发布的插画日榜，无需 PixivFlow 登录配置：

```sh
pnpm download
```

图片按本机日期保存到 `imgs/YYYY-MM-DD/`，文件名保留榜单顺序。同一天重复下载会覆盖同名文件，其他日期目录保留。Pixiv 最新发布的日榜日期可能是前一天。图片服务器连接失败时会尝试公开镜像 `i.pixiv.re`。

### 筛选后的 Pixiv 月榜

```sh
pnpm download:monthly-safe-top100
```

命令逐页筛选最新插画月榜，下载过滤榜单前 100 个作品的第一页原图到 `downloads/`，并将清单写入 `downloads/ranking-monthly-safe-top100.json`。过滤会排除漫画、动图、被遮罩或带性内容标记的作品，以及标题或标签含裸露、内衣、泳装、性暗示等关键词的作品。筛选结果不足 100 个时会报错，不会开始下载。需要先完成 PixivFlow 登录配置。

### 指定画师

下载指定画师的全部插画作品，包括多页作品：

```sh
pnpm download:artist 123456
pnpm download:artist https://www.pixiv.net/users/123456
pnpm download:artist --user 123456 --config ./pixivflow-ranking.config.json --output ./downloads/my-artist
```

默认保存到 `downloads/artists/<画师 ID>/`。每位画师使用独立的下载记录，重复执行会跳过已完成作品。命令需要 PixivFlow 配置；完整参数可用 `pnpm download:artist --help` 查看。

若 Pixiv 下载失败，请检查网络和 Pixiv 登录状态；月榜和画师下载还需要配置文件中的有效 `pixiv.refreshToken`。
