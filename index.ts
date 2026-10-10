import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadLocalImages } from './local-images.ts';
import { installPixivBackground } from './background.ts';
import { installPureMode } from './pure-mode.ts';

const { values, positionals } = parseArgs({
  options: { help: { type: 'boolean', short: 'h' } },
  allowPositionals: true,
});
if (values.help) {
  console.log('用法：pnpm inject [子目录]');
  console.log('默认递归读取项目 downloads/，也可指定相对于 downloads/ 的子目录。');
  console.log('示例：pnpm inject artists/1554775/artists/1554775');
  console.log('图片由页面通过 file input 读取，不需要启动本地文件服务。');
  process.exit(0);
}
if (positionals.length > 1) {
  throw new Error('inject 最多接受一个 downloads/ 子目录参数。用法：pnpm inject [子目录]');
}
const { directory, images } = await loadLocalImages(positionals[0]);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9341');
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url() === 'app://-/index.html') ?? pages[0];
  if (!page) throw new Error('没有找到可注入背景的页面');

  const injectedCss = await readFile(fileURLToPath(new URL('./inject.css', import.meta.url)), 'utf8');
  await page.evaluate((css) => {
    const styleId = '__pixiv_inject_css__';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      (document.head ?? document.documentElement).appendChild(style);
    }
    style.textContent = css;
  }, injectedCss);

  const inputId = `__pixiv_background_file_input_${randomUUID()}`;
  await page.evaluate((id) => {
    for (const previous of document.querySelectorAll('[data-pixiv-background-file-input]')) {
      previous.remove();
    }
    const input = document.createElement('input');
    input.id = id;
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('data-pixiv-background-file-input', 'true');
    Object.assign(input.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(input);
  }, inputId);
  await page.locator(`#${inputId}`).setInputFiles(directory);

  // Reuse the named world so reinjection also cleans up the previous version.
  const session = await page.context().newCDPSession(page);
  const { frameTree } = await session.send('Page.getFrameTree');
  const { executionContextId } = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: '__pixiv_background__',
  });
  const pureModeResult = await session.send('Runtime.callFunctionOn', {
    executionContextId,
    functionDeclaration: installPureMode.toString(),
    awaitPromise: true,
    returnByValue: true,
  });
  if (pureModeResult.exceptionDetails) {
    throw new Error(
      pureModeResult.exceptionDetails.exception?.description ?? pureModeResult.exceptionDetails.text,
    );
  }
  const result = await session.send('Runtime.callFunctionOn', {
    executionContextId,
    functionDeclaration: installPixivBackground.toString(),
    arguments: [{ value: inputId }, { value: images }],
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  const count = result.result?.value;
  console.log(`从 ${directory} 选择了 ${typeof count === 'number' ? count : '若干'} 张图片，按窗口横竖方向筛选并每 1 分钟轮替；⌘/Ctrl + Alt + → 历史中前进，到最新记录后随机切换，⌘/Ctrl + Alt + ← 回看历史图片，↑/↓ 调整模糊，滚轮调整不透明度，F5 按住查看原图，⌘/Ctrl + Alt + C 复制相对路径，Space 显示/隐藏；⌘/Ctrl + Alt + P 开关纯享模式；程序退出后继续运行。`);
} finally {
  // For a CDP-connected browser this only disconnects; page timers keep running.
  await browser.close();
}
