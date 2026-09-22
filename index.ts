import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { loadLocalImages } from './local-images.ts';
import { installPixivBackground } from './background.ts';

const { values, positionals } = parseArgs({
  options: { help: { type: 'boolean', short: 'h' } },
  allowPositionals: true,
});
if (values.help) {
  console.log('用法：pnpm inject [子目录]');
  console.log('默认递归读取项目 downloads/，也可指定相对于 downloads/ 的子目录。');
  console.log('示例：pnpm inject artists/1554775/artists/1554775');
  console.log('图片通过 http://127.0.0.1:5500 提供。');
  process.exit(0);
}
if (positionals.length > 1) {
  throw new Error('inject 最多接受一个 downloads/ 子目录参数。用法：pnpm inject [子目录]');
}
const { directory, images } = await loadLocalImages(positionals[0]);
console.log(`从 ${directory} 读取了 ${images.length} 张图片`);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9341');
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url() === 'app://-/index.html') ?? pages[0];
  if (!page) throw new Error('没有找到可注入背景的页面');

  // Reuse the named world so reinjection also cleans up the previous version.
  // Node classifies supported files from their headers; the page handles only fallback files.
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
  console.log('downloads/ 图片 URL 已注入，按窗口横竖方向筛选并每 1 分钟轮替；⌘/Ctrl + Alt + → 切换下一张，↑/↓ 调整模糊，滚轮调整透明度，Space 显示/隐藏；程序退出后继续运行。');
} finally {
  // For a CDP-connected browser this only disconnects; page timers keep running.
  await browser.close();
}
