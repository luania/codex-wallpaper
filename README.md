# Pixiv Wallpaper

Pixiv Wallpaper 可下载 Pixiv 插画，并将本地图片注入 ChatGPT 桌面应用作为背景。它支持 Pixiv 日榜、筛选后的月榜、画师作品下载，以及图片自动轮替、显示效果调整和纯享模式。

## 环境要求

- macOS，且已安装 ChatGPT 桌面应用。`pnpm codex:start` 默认从 `/Applications/ChatGPT.app` 启动应用。
- Node.js 24 或更高版本。
- pnpm 11.10.0（项目在 `package.json` 中声明的版本）。

克隆项目后，在项目根目录安装依赖：

```sh
pnpm install
```

## 首次配置

日榜下载不需要 Pixiv 登录配置。月榜和画师下载使用 PixivFlow，需要一份带有有效 `pixiv.refreshToken` 的本地配置文件。

安装依赖后，可复制 PixivFlow 随包提供的排行榜配置示例，再通过 PixivFlow 登录命令写入令牌：

```sh
cp node_modules/pixivflow/config/examples/standalone.config.ranking.json pixivflow-ranking.config.json
pnpm exec pixivflow login --config ./pixivflow-ranking.config.json
```

登录完成后确认配置中的 `pixiv.refreshToken` 已填入。该配置保存在项目根目录，文件名匹配 `.gitignore` 规则，不会被 Git 跟踪。Refresh token 等同于登录凭据：不要将它提交到仓库、粘贴到公开场所或分享配置文件。

如需使用其他 PixivFlow 配置，可在画师下载命令中使用 `--config <路径>`。安全月榜命令默认读取根目录的 `pixivflow-ranking.config.json`。

## 下载图片

### Pixiv 日榜

下载 Pixiv 最新发布的插画日榜：

```sh
pnpm download
```

图片保存到 `imgs/YYYY-MM-DD/`，日期按本机日期生成，文件名保留榜单顺序。同一天再次下载会覆盖同名文件，其他日期的目录会保留。Pixiv 发布的最新日榜日期可能是前一天。图片服务器连接失败时，下载器会尝试公开镜像 `i.pixiv.re`。

### 筛选后的 Pixiv 月榜

```sh
pnpm download:monthly-safe-top100
```

命令读取最新插画月榜并逐页筛选，下载过滤榜单前 100 个作品的第一页原图到 `downloads/`，作品清单写入 `downloads/ranking-monthly-safe-top100.json`。过滤会排除漫画、动图、被遮罩或带有性内容标记的作品，以及标题或标签含裸露、内衣、泳装、性暗示等关键词的作品。如果筛选结果不足 100 个，命令会报错并停止，不会开始下载。此命令需要完成上面的 PixivFlow 登录配置。

### 指定画师

下载画师的全部插画作品，包括多页作品：

```sh
pnpm download:artist 123456
pnpm download:artist https://www.pixiv.net/users/123456
```

默认输出目录为 `downloads/artists/<画师 ID>/`。也可以显式指定画师、配置和输出路径：

```sh
pnpm download:artist --user 123456 --config ./pixivflow-ranking.config.json --output ./downloads/my-artist
```

每位画师使用独立的 PixivFlow 下载记录；重复运行会跳过已完成的作品。该命令需要有效的 PixivFlow 登录配置。更多参数可查看：

```sh
pnpm download:artist --help
```

## 启动应用并注入图片

先启动带有本地调试端口的 ChatGPT 桌面应用：

```sh
pnpm codex:start
```

等待应用打开并进入需要显示背景的页面，然后在另一个终端运行：

```sh
pnpm inject
```

默认递归选择项目的整个 `downloads/` 目录。也可以只注入其中一个子目录，例如：

```sh
pnpm inject artists/1554775/artists/1554775
```

子目录参数相对于 `downloads/`，不要添加 `downloads/` 前缀。不能使用绝对路径或跳出 `downloads/` 的路径。目录中必须至少有一张受支持的图片。

注入通过 Playwright 连接本机 `127.0.0.1:9341`，并由页面读取所选目录中的文件；不需要启动 Live Server 或其他文件服务。注入成功后命令会退出，背景会继续在应用页面中运行。重新加载页面后需要重新执行 `pnpm inject`。

支持 JPG/JPEG、PNG、WebP、GIF、AVIF、BMP 和 SVG。图片按相对路径自然排序。注入程序会读取图片尺寸并区分横图和竖图：窗口横向时优先使用横图，窗口竖向时优先使用竖图；对应方向没有图片时会回退到其他方向。正方形图片按横图处理。无法预先读取尺寸的图片会在浏览器中判断。

图片只在首次显示或切换到该图片时解码。损坏或无法解码的图片会跳过，每张图片最多等待 15 秒。图片对象 URL 会在需要时创建，并在不再使用时回收。

## 默认行为与快捷键

默认每 5 分钟随机轮替一次，淡入淡出时长为 1000 毫秒。底部进度线显示当前轮替进度；关闭自动轮替或当前方向只有一张可用图片时，进度线隐藏。窗口从横向变为竖向或相反时会立即重新选择图片，同一方向内调整窗口大小不会切图。当前注入会话保留最近 20 张历史图片；刷新或重新注入后历史会清空。

按 `⌘/Ctrl + Alt + ,` 打开设置面板。修改即时生效，并保存到当前应用页面的 `localStorage`；重新注入后会继续使用上次设置。面板可配置自动轮替、轮替间隔、淡入淡出时长、模糊、不透明度、前景图显示状态、纯享模式自动进入和空闲时间，也可重新录入快捷键。录入的快捷键与现有动作冲突时会拒绝保存并提示。

| 默认按键 | 功能 |
| --- | --- |
| `⌘/Ctrl + Alt + ,` | 打开设置面板 |
| `⌘/Ctrl + Alt + →` | 前进历史；到最新记录后随机切换图片 |
| `⌘/Ctrl + Alt + ←` | 回看上一张历史图片，最多保留 20 张 |
| `⌘/Ctrl + Alt + Space` | 显示或隐藏前景图 |
| `⌘/Ctrl + Alt + ↑` / `↓` | 增加或减少模糊值，每次 1 px；最低为 0 px |
| `⌘/Ctrl + Alt + PageUp` / `PageDown` | 增加或减少不透明度，每次 0.01 |
| `⌘/Ctrl + Alt + C` | 复制当前图片相对路径 |
| `⌘/Ctrl + Alt + 滚轮` | 调整不透明度，每次滚轮事件 0.01 |
| `F5` 按住 | 临时查看当前图片原图；松开后恢复效果 |
| `F4` 双击 | 开启或退出纯享模式 |
| 纯享模式中按住 `F4` | 临时显示完整界面；松开后恢复纯享模式 |

纯享模式默认在鼠标和键盘连续 30 秒没有活动后自动进入。鼠标点击或移动不会退出纯享模式；可双击 `F4` 退出。按住单独的 `F4` 会暂时显示完整界面，松开后恢复。两次按下间隔超过约 300 毫秒时按单次按住处理。纯享模式保留主对话内容及其元素，并隐藏主区域以外的界面；打开的设置面板和 Composer 菜单保持可见。进入和退出时使用约 200 毫秒淡变效果。

设置面板中的范围：轮替间隔 10 秒到 1 小时，淡入淡出 0 到 5000 毫秒，模糊 0 到 500 px，不透明度 0 到 100%，空闲时间 5 秒到 10 分钟。默认模糊值为 0 px，不透明度为 0.33。调整模糊或不透明度会短暂显示当前值；切图、窗口方向变化或隐藏前景图不会重置这两个值，也不会因单张图片而禁用调整。按 `C` 复制路径后会短暂显示“已复制”。

快捷键中的 `Primary` 在 macOS 上表示 Command，在 Windows/Linux 上表示 Ctrl。设置保存在版本化键 `__pixiv_inject_settings_v1__` 下，只对当前浏览器配置中的页面生效。

## 项目生成目录

| 路径 | 内容 |
| --- | --- |
| `imgs/YYYY-MM-DD/` | 日榜下载的图片 |
| `downloads/` | 月榜图片、清单和画师下载内容；也是默认注入目录 |
| `data/` | PixivFlow 下载记录、日志及月榜筛选生成文件 |
| `codex-snapshot/` | `pnpm codex:snapshot` 生成的页面快照 |

这些数据目录和本地 PixivFlow 配置均由 `.gitignore` 排除。建议仍然避免分享包含账号凭据或个人下载内容的文件。

## 其他命令

生成当前已连接页面的本地快照，并在 Chrome 中打开：

```sh
pnpm codex:snapshot
```

该命令也需要 `pnpm codex:start` 启动的调试端口；快照写入 `codex-snapshot/`，本地预览使用端口 `8765`。

运行项目测试：

```sh
pnpm test
```

## 常见问题

- **找不到调试端口或没有可注入页面：**确认 `pnpm codex:start` 已成功启动 ChatGPT 桌面应用，并且目标页面已打开。注入程序连接 `127.0.0.1:9341`；不要用普通方式启动的应用代替该命令启动的实例。
- **找不到 PixivFlow 配置或下载认证失败：**确认项目根目录存在 `pixivflow-ranking.config.json`，`pixiv.refreshToken` 有效，并重新运行 `pnpm exec pixivflow login --config ./pixivflow-ranking.config.json`。安全月榜命令固定读取该文件。
- **提示下载目录不存在或没有支持的图片：**先运行对应下载命令；使用 `pnpm inject <子目录>` 时，确认路径相对于 `downloads/` 且目录中有支持的图片。
- **Pixiv 下载失败：**检查网络连接和 Pixiv 认证状态。日榜图片下载会尝试公开图片镜像；月榜或画师下载还依赖 PixivFlow 配置及网络访问。
- **调整设置后页面显示没有变化：**确认背景注入已完成；刷新应用页面会清除当前注入，需要再次运行 `pnpm inject`。
