import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9341');
const page = browser.contexts()[0].pages()[0];

const png = fs.readFileSync('bg2.jpeg');
const dataUrl = `data:image/jpeg;base64,${png.toString('base64')}`;

await page.evaluate((src) => {
  document.getElementById('__my_overlay__')?.remove();

  const img = document.createElement('img');
  img.id = '__my_overlay__';
  img.src = src;

  Object.assign(img.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    objectFit: 'cover',
    objectPosition: 'center',
    opacity: '0.2',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  document.documentElement.appendChild(img);
}, dataUrl);