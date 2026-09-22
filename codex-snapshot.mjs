import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CDP_URL = 'http://127.0.0.1:9341';
const PORT = 8765;
const OUTPUT_DIR = join(process.cwd(), 'codex-snapshot');

const browser = await chromium.connectOverCDP(CDP_URL);

let page;

for (const context of browser.contexts()) {
  for (const p of context.pages()) {
    const title = await p.title().catch(() => '');
    const url = p.url();

    console.log(`[page] ${title} ${url}`);

    page = p;
  }

  if (page) break;
}

if (!page) {
  throw new Error('没有找到 Codex 页面');
}

console.log(`\n使用页面: ${await page.title()}`);
console.log(page.url());

// 等待页面稳定
await page.waitForLoadState('domcontentloaded').catch(() => {});

// ------------------------------------------------------------
// 1. 获取当前 DOM
// ------------------------------------------------------------

const html = await page.evaluate(() => {
  // 删除 DevTools / 调试类节点
  const clone = document.documentElement.cloneNode(true);

  return '<!DOCTYPE html>\n' + clone.outerHTML;
});

// ------------------------------------------------------------
// 2. 获取当前 CSS
// ------------------------------------------------------------

const styles = await page.evaluate(() => {
  const result = [];

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        result.push(rule.cssText);
      }
    } catch {
      // 跨域 stylesheet 无法访问 cssRules
    }
  }

  return result.join('\n\n');
});

// ------------------------------------------------------------
// 3. 把 stylesheet 替换成本地 CSS
// ------------------------------------------------------------

const finalHtml = await page.evaluate(({ styles }) => {
  const clone = document.documentElement.cloneNode(true);

  // 删除原来的 stylesheet link
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
    el.remove();
  });

  // 删除原来的 style
  clone.querySelectorAll('style').forEach(el => {
    el.remove();
  });

  const style = document.createElement('style');
  style.textContent = styles;

  clone.querySelector('head')?.appendChild(style);

  return '<!DOCTYPE html>\n' + clone.outerHTML;
}, { styles });

// ------------------------------------------------------------
// 4. 保存
// ------------------------------------------------------------

await mkdir(OUTPUT_DIR, { recursive: true });

await writeFile(
  join(OUTPUT_DIR, 'index.html'),
  finalHtml,
  'utf8',
);

await writeFile(
  join(OUTPUT_DIR, 'styles.css'),
  styles,
  'utf8',
);

console.log(`\n已生成:`);
console.log(`  ${OUTPUT_DIR}/index.html`);
console.log(`  ${OUTPUT_DIR}/styles.css`);

// ------------------------------------------------------------
// 5. 启动本地 HTTP Server
// ------------------------------------------------------------

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const content = await BunOrNodeRead(
      join(OUTPUT_DIR, 'index.html')
    );

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });

    res.end(content);
    return;
  }

  if (req.url === '/styles.css') {
    const content = await BunOrNodeRead(
      join(OUTPUT_DIR, 'styles.css')
    );

    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
    });

    res.end(content);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

async function BunOrNodeRead(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

await new Promise(resolve => {
  server.listen(PORT, '127.0.0.1', resolve);
});

const url = `http://127.0.0.1:${PORT}/`;

console.log(`\nSnapshot server: ${url}`);

// ------------------------------------------------------------
// 6. 打开普通 Chrome
// ------------------------------------------------------------

await execFileAsync('open', [
  '-a',
  'Google Chrome',
  url,
]);

console.log('已在 Chrome 中打开。');

// 不关闭 server，让网页继续访问
console.log('\n按 Ctrl+C 退出。');