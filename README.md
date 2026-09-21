# Pixiv 背景

需要 Node.js 24+。

下载当前最新发布的 Pixiv 日榜图片：

```sh
pnpm download
# 等价于 node download.ts
```

图片按本机下载日期保存到项目的 `imgs/YYYY-MM-DD/`，文件名前的数字保留榜单顺序。同一天重复下载会覆盖同名文件，其他日期目录保留。Pixiv 最新发布的日榜日期可能是前一天；原图片域名连接失败时会尝试公开镜像 `i.pixiv.re`。

启动带调试端口的应用，然后注入本地图片：

```sh
pnpm start
# 等应用启动完成后运行
pnpm inject
pnpm inject --dir imgs/2026-09-20
pnpm inject --dir "/absolute/path/to/pictures"
# 也支持：node index.ts imgs/2026-09-20
```

注入命令只读取指定目录的图片，不下载、不递归读取子目录。相对路径以当前工作目录为准；未指定目录时，使用项目 `imgs/` 下最新的非空日期目录，兼容原来直接保存在 `imgs/` 的图片。

支持 JPG/JPEG、PNG、WebP、GIF、AVIF、BMP 和 SVG，按文件名自然排序。注入完成后程序退出，页面每分钟轮替；`⌘ + Option + →`（Mac）或 `Ctrl + Alt + →` 切换下一张并重新计时。刷新页面后需要重新注入。
