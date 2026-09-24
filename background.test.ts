import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { installPixivBackground } from './background.ts';

type Listener = (...args: any[]) => void;
type FakeFile = {
  name: string;
  type: string;
  webkitRelativePath: string;
};

function createPage(
  random = Math.random,
  files: FakeFile[] = [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'tall.jpg', type: 'image/jpeg', webkitRelativePath: 'selected/tall.jpg' },
  ],
) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const appended: Array<FakeImage | FakeElement> = [];
  const copied: string[] = [];
  const objectUrls: string[] = [];
  const revokedUrls: string[] = [];
  let shown: FakeImage | undefined;
  let decodeCalls = 0;
  const sizes: Record<string, [number, number]> = {
    'selected/wide.png': [1600, 900],
    'selected/wide2.png': [1400, 900],
    'selected/tall.jpg': [700, 1000],
  };

  class FakeElement {
    id = '';
    style: Record<string, string> = {};
    textContent = '';
    removed = false;

    setAttribute() {}
    remove() {
      this.removed = true;
    }
  }

  class FakeInput extends FakeElement {
    type = 'file';
    files = files;
  }

  class FakeImage extends FakeElement {
    url = '';
    naturalWidth = 0;
    naturalHeight = 0;

    set src(value: string) {
      this.url = value;
      const size = sizes[value.slice('blob:'.length)];
      if (size) [this.naturalWidth, this.naturalHeight] = size;
    }

    async decode() {
      decodeCalls++;
    }

    removeAttribute() {}
    remove() {
      super.remove();
      if (shown === this) shown = undefined;
    }
  }

  class FakeTextarea extends FakeElement {
    value = '';

    select() {}
  }

  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    setTimeout(callback: () => void, delay: number) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer?: ReturnType<typeof setTimeout>) {
      if (timer) timers.delete(timer);
      if (timer) clearTimeout(timer);
    },
    requestAnimationFrame(callback: () => void) {
      callback();
      return 0;
    },
    addEventListener(type: string, listener: Listener) {
      let typeListeners = listeners.get(type);
      if (!typeListeners) listeners.set(type, typeListeners = new Set());
      typeListeners.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const input = new FakeInput();
  const elements = new Map<string, FakeElement>([['input', input]]);
  const document = {
    getElementById(id: string) {
      if (id === '__my_overlay__') return shown;
      return elements.get(id);
    },
    createElement(tagName: string) {
      return tagName === 'textarea' ? new FakeTextarea() : new FakeElement();
    },
    execCommand(command: string) {
      return command === 'copy';
    },
    documentElement: {
      appendChild(element: FakeImage | FakeElement) {
        appended.push(element);
        if (element.id) elements.set(element.id, element);
        if (element instanceof FakeImage) shown = element;
      },
    },
  };
  const navigator = {
    clipboard: {
      writeText(text: string) {
        copied.push(text);
        return Promise.resolve();
      },
    },
  };
  const URL = {
    createObjectURL(file: FakeFile) {
      const url = `blob:${file.webkitRelativePath}`;
      objectUrls.push(url);
      return url;
    },
    revokeObjectURL(url: string) {
      revokedUrls.push(url);
    },
  };
  const install = runInNewContext(`(${installPixivBackground.toString()})`, {
    window,
    document,
    HTMLInputElement: FakeInput,
    Image: FakeImage,
    navigator,
    URL,
    AbortController,
    console,
    Math: { min: Math.min, max: Math.max, floor: Math.floor, round: Math.round, random },
  }) as (inputId: string) => Promise<number>;

  return {
    install,
    window,
    input,
    get shown() { return shown; },
    get decodeCalls() { return decodeCalls; },
    emit(type: string, ...args: unknown[]) {
      for (const listener of listeners.get(type) ?? []) listener(...args);
    },
    get appended() { return appended; },
    get status() { return elements.get('__my_status__'); },
    get copied() { return copied; },
    get objectUrls() { return objectUrls; },
    get revokedUrls() { return revokedUrls; },
    cleanup() {
      (window as typeof window & { __pixivBackgroundCleanup__?: () => void }).__pixivBackgroundCleanup__?.();
    },
  };
}

test('reads and filters images from the selected file input', async () => {
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'notes.txt', type: 'text/plain', webkitRelativePath: 'selected/notes.txt' },
    { name: 'tall.jpg', type: 'image/jpeg', webkitRelativePath: 'selected/tall.jpg' },
  ]);
  await page.install('input');
  try {
    assert.equal(page.shown?.url, 'blob:selected/wide.png');
    assert.deepEqual(page.objectUrls, ['blob:selected/tall.jpg', 'blob:selected/wide.png']);
    assert.equal(page.decodeCalls, 3);
  } finally {
    page.cleanup();
  }
});

test('classifies files in the browser and follows resize orientation', async () => {
  const page = createPage();
  await page.install('input');
  try {
    assert.equal(page.shown?.url, 'blob:selected/wide.png');
    assert.equal(page.decodeCalls, 3);
    page.window.innerWidth = 600;
    page.window.innerHeight = 1000;
    page.emit('resize');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/tall.jpg');
  } finally {
    page.cleanup();
  }
});

test('chooses the first injected image randomly from matching candidates', async () => {
  const page = createPage(() => 0.999999, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  try {
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');
  } finally {
    page.cleanup();
  }
});

test('crossfades the old image while the new image fades in', async () => {
  const page = createPage(() => 0.999999, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  const first = page.shown!;
  try {
    page.emit('keydown', {
      code: 'ArrowRight',
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.notEqual(page.shown, first);
    assert.equal(first.style.opacity, '0');
    assert.equal(first.removed, false);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(first.removed, true);
  } finally {
    page.cleanup();
  }
});

test('shows the current blur and opacity while adjusting them', async () => {
  const page = createPage();
  await page.install('input');
  try {
    page.emit('keydown', {
      code: 'ArrowUp',
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    assert.equal(page.status?.textContent, '模糊 1px');
    assert.equal(page.status?.style.opacity, '1');

    page.emit('wheel', {
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      deltaY: -1,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    assert.equal(page.status?.textContent, '不透明度 21%');
  } finally {
    page.cleanup();
  }
});

test('copies the current image relative path with the copy shortcut', async () => {
  const page = createPage();
  await page.install('input');
  try {
    page.emit('keydown', {
      code: 'KeyC',
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(page.copied, ['selected/wide.png']);
    assert.equal(page.status?.textContent, '已复制');
  } finally {
    page.cleanup();
  }
});

test('revokes object URLs and removes the file input during cleanup', async () => {
  const page = createPage();
  await page.install('input');
  page.cleanup();
  assert.deepEqual(page.revokedUrls, ['blob:selected/tall.jpg', 'blob:selected/wide.png']);
  assert.equal(page.input.removed, true);
});

test('rejects a directory without supported images', async () => {
  const page = createPage(undefined, [
    { name: 'notes.txt', type: 'text/plain', webkitRelativePath: 'selected/notes.txt' },
  ]);
  await assert.rejects(page.install('input'), /所选目录中没有支持的图片/);
  assert.equal(page.input.removed, true);
});
