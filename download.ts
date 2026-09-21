import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright';

// Group by the local download date; the latest published ranking may be older.
const today = new Date();
const downloadDate = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
].join('-');
const imagesDirectory = new URL(`./imgs/${downloadDate}/`, import.meta.url);

async function fetchRankingImages() {
  await mkdir(imagesDirectory, { recursive: true });
  const client = await request.newContext({
    extraHTTPHeaders: {
      Referer: 'https://www.pixiv.net/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 20_000,
  });

  try {
    // No date parameter: Pixiv returns its latest published daily ranking.
    const response = await client.get(
      'https://www.pixiv.net/ranking.php?mode=daily&content=illust&format=json',
      { maxRetries: 2 },
    );
    if (!response.ok()) throw new Error(`Pixiv 日榜请求失败：HTTP ${response.status()}`);

    const ranking = (await response.json()) as {
      date?: string;
      contents?: { url?: string; is_masked?: boolean }[];
    };
    if (!Array.isArray(ranking.contents)) throw new Error('Pixiv 日榜数据格式异常');
    const urls = [...new Set(ranking.contents.flatMap((entry) => {
      if (entry.is_masked || !entry.url?.startsWith('https://i.pximg.net/')) return [];
      // Use the full 1200px preview instead of the cropped ranking thumbnail.
      return [entry.url.replace(/\/c\/[^/]+\//, '/')];
    }))];
    if (urls.length === 0) throw new Error('Pixiv 日榜没有可用图片');

    let preferredImageHost = 'i.pximg.net';
    async function downloadImage(url: string) {
      // i.pixiv.re is a public third-party mirror. Only public image paths are
      // sent to it; Pixiv ranking requests continue to use the official site.
      const hosts = [...new Set([preferredImageHost, 'i.pximg.net', 'i.pixiv.re'])];
      const failures: string[] = [];
      for (const host of hosts) {
        const imageUrl = new URL(url);
        imageUrl.hostname = host;
        try {
          // A reset during the TLS handshake is not fixed by retrying the same
          // direct connection repeatedly. Try the alternative host instead.
          const image = await client.get(imageUrl.href, {
            maxRetries: host === 'i.pximg.net' ? 0 : 1,
          });
          try {
            const contentType = image.headers()['content-type']?.split(';')[0]?.trim();
            if (!image.ok() || !contentType?.startsWith('image/')) {
              throw new Error(`HTTP ${image.status()}，类型 ${contentType ?? '未知'}`);
            }
            const body = await image.body();
            if (body.length === 0) throw new Error('图片内容为空');
            if (preferredImageHost !== host) {
              preferredImageHost = host;
              console.log(`[Pixiv 背景] 图片下载切换到 ${host}`);
            }
            return { contentType, body };
          } finally {
            await image.dispose();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
          failures.push(`${host}: ${message}`);
        }
      }
      throw new Error(failures.join('；'));
    }

    let savedCount = 0;
    // Download four images at a time, keeping successful images in ranking order.
    for (let offset = 0; offset < urls.length; offset += 4) {
      const batch = await Promise.all(urls.slice(offset, offset + 4).map(async (url, index) => {
        try {
          const { body } = await downloadImage(url);
          const rank = String(offset + index + 1).padStart(3, '0');
          const filename = `${rank}-${basename(new URL(url).pathname)}`;
          await writeFile(new URL(filename, imagesDirectory), body);
          return true;
        } catch (error) {
          console.warn('[Pixiv 背景] 跳过下载或保存失败的图片', url,
            error instanceof Error ? error.message.split('\n')[0] : error);
          return null;
        }
      }));
      savedCount += batch.filter(Boolean).length;
      console.log(`Pixiv 下载进度：${Math.min(offset + 4, urls.length)}/${urls.length}`);
    }
    if (savedCount === 0) throw new Error('Pixiv 图片全部下载或保存失败，请检查网络连接和 imgs 目录权限');
    console.log(`已下载 Pixiv ${ranking.date ?? ''} 日榜的 ${savedCount} 张图片，保存至 ${fileURLToPath(imagesDirectory)}`);
  } finally {
    await client.dispose();
  }
}

await fetchRankingImages();
