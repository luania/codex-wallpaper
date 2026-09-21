import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { loadLocalImages } from './local-images.ts';

// This entire function runs in the page, independently of the Node process.
async function installPixivBackground(images: string[]) {
  const intervalMs = 1 * 60 * 1000;
  const state = window as typeof window & {
    __pixivBackgroundCleanup__?: () => void;
  };
  state.__pixivBackgroundCleanup__?.();

  let stopped = false;
  let timer: number | undefined;
  let index = 0;
  let loading = false;
  state.__pixivBackgroundCleanup__ = () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('keydown', onKeyDown, true);
  };

  async function rotate() {
    if (loading || stopped) return;
    loading = true;

    try {
      // All data is embedded; rotation makes no network requests.
      for (let attempts = 0; attempts < images.length; attempts++) {
        if (stopped) return;
        const next = new Image();
        next.src = images[index]!;
        index = (index + 1) % images.length;

        try {
          await next.decode();
        } catch (error) {
          if (stopped) return;
          console.warn('[Pixiv 背景] 跳过无法解码的图片', error);
          continue;
        }
        if (stopped) return;

        next.id = '__my_overlay__';
        next.alt = '';
        next.setAttribute('aria-hidden', 'true');
        Object.assign(next.style, {
          position: 'fixed',
          inset: '0',
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          objectPosition: 'center',
          // Blend with the interface instead of washing it out like a
          // semi-transparent white veil.
          opacity: '0.28',
          filter: 'saturate(1.18) contrast(1.08) brightness(0.86)',
          mixBlendMode: 'multiply',
          transform: 'translateZ(0)',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        document.getElementById('__my_overlay__')?.remove();
        document.documentElement.appendChild(next);
        return;
      }
      throw new Error('所有日榜图片均无法解码');
    } finally {
      loading = false;
    }
  }

  function restartTimer() {
    window.clearInterval(timer);
    if (stopped || images.length < 2) return;
    timer = window.setInterval(() => {
      void rotate().catch((error) => console.error('[Pixiv 背景]', error));
    }, intervalMs);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Cmd+Option+Right on macOS, Ctrl+Alt+Right on Windows/Linux.
    if (
      event.code !== 'ArrowRight' || !event.altKey ||
      event.metaKey === event.ctrlKey || event.shiftKey ||
      event.isComposing || stopped || images.length < 2
    ) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || loading) return;
    void rotate()
      .then(restartTimer)
      .catch((error) => console.error('[Pixiv 背景]', error));
  }

  await rotate();
  if (!stopped) {
    restartTimer();
    window.addEventListener('keydown', onKeyDown, true);
  }
}

const { values, positionals } = parseArgs({
  options: {
    dir: { type: 'string', short: 'd' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});
if (values.help) {
  console.log('用法：node index.ts [--dir <图片目录>] 或 node index.ts <图片目录>');
  console.log('默认读取 imgs/ 下最新的日期目录；没有日期图片时兼容读取 imgs/。');
  process.exit(0);
}
if (positionals.length > 1 || (values.dir !== undefined && positionals.length > 0)) {
  throw new Error('请只指定一个图片目录：node index.ts --dir <目录>');
}
const { directory, images } = await loadLocalImages(values.dir ?? positionals[0]);
console.log(`从 ${directory} 读取了 ${images.length} 张图片`);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9341');
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url() === 'app://-/index.html') ?? pages[0];
  if (!page) throw new Error('没有找到可注入背景的页面');

  // Reuse the named world so reinjection also cleans up the previous version.
  // No cross-origin privileges are needed: all images were read from local files.
  const session = await page.context().newCDPSession(page);
  const { frameTree } = await session.send('Page.getFrameTree');
  const { executionContextId } = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: '__pixiv_background__',
  });
  const result = await session.send('Runtime.callFunctionOn', {
    executionContextId,
    functionDeclaration: installPixivBackground.toString(),
    arguments: [{ value: images }],
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  console.log('本地图片已注入，每 1 分钟轮替；⌘/Ctrl + Alt + → 切换下一张；程序退出后继续运行。');
} finally {
  // For a CDP-connected browser this only disconnects; page timers keep running.
  await browser.close();
}
