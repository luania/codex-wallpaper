import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { installPixivBackground } from './background.ts';

type Listener = (...args: any[]) => void;

function createPage(random = Math.random) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const appended: Array<FakeImage | FakeElement> = [];
  const copied: string[] = [];
  let shown: FakeImage | undefined;
  let decodeCalls = 0;
  const sizes: Record<string, [number, number]> = {
    wide: [1600, 900],
    wide2: [1400, 900],
    tall: [700, 1000],
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

  class FakeImage extends FakeElement {
    url = '';
    naturalWidth = 0;
    naturalHeight = 0;

    set src(value: string) {
      this.url = value;
      const size = sizes[value];
      if (size) [this.naturalWidth, this.naturalHeight] = size;
    }

    async decode() {
      decodeCalls++;
    }

    removeAttribute() {}
    remove() {
      super.remove();
      this.removed = true;
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
  const elements = new Map<string, FakeElement>();
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
      appendChild(image: FakeImage | FakeElement) {
        appended.push(image);
        if (image.id) elements.set(image.id, image);
        if (image instanceof FakeImage) shown = image;
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
  const install = runInNewContext(`(${installPixivBackground.toString()})`, {
    window,
    document,
    Image: FakeImage,
    navigator,
    AbortController,
    console,
    Math: { min: Math.min, max: Math.max, floor: Math.floor, round: Math.round, random },
  }) as (images: Array<{ url: string; orientation?: 'landscape' | 'portrait' }>) => Promise<void>;

  return {
    install,
    window,
    get shown() { return shown; },
    get decodeCalls() { return decodeCalls; },
    emit(type: string, ...args: unknown[]) {
      for (const listener of listeners.get(type) ?? []) listener(...args);
    },
    get appended() { return appended; },
    get status() { return elements.get('__my_status__'); },
    get copied() { return copied; },
    cleanup() {
      (window as typeof window & { __pixivBackgroundCleanup__?: () => void }).__pixivBackgroundCleanup__?.();
    },
  };
}

test('uses Node-provided orientation metadata without classifying every image in the page', async () => {
  const page = createPage();
  await page.install([
    { url: 'wide', orientation: 'landscape' },
    { url: 'tall', orientation: 'portrait' },
  ]);
  try {
    assert.equal(page.shown?.url, 'wide');
    assert.equal(page.decodeCalls, 1);
  } finally {
    page.cleanup();
  }
});

test('classifies only unknown records in the browser and follows resize orientation', async () => {
  const page = createPage();
  await page.install([
    { url: 'wide', orientation: 'landscape' },
    { url: 'tall' },
  ]);
  try {
    assert.equal(page.shown?.url, 'wide');
    assert.equal(page.decodeCalls, 2);
    page.window.innerWidth = 600;
    page.window.innerHeight = 1000;
    page.emit('resize');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'tall');
  } finally {
    page.cleanup();
  }
});

test('chooses the first injected image randomly from matching candidates', async () => {
  const page = createPage(() => 0.999999);
  await page.install([
    { url: 'wide', orientation: 'landscape' },
    { url: 'wide2', orientation: 'landscape' },
  ]);
  try {
    assert.equal(page.shown?.url, 'wide2');
  } finally {
    page.cleanup();
  }
});

test('crossfades the old image while the new image fades in', async () => {
  const page = createPage(() => 0.999999);
  await page.install([
    { url: 'wide', orientation: 'landscape' },
    { url: 'wide2', orientation: 'landscape' },
  ]);
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
  await page.install([{ url: 'wide', orientation: 'landscape' }]);
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

test('copies the current image address with the copy shortcut', async () => {
  const page = createPage();
  await page.install([{ url: 'wide', orientation: 'landscape' }]);
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
    assert.deepEqual(page.copied, ['wide']);
    assert.equal(page.status?.textContent, '已复制');
  } finally {
    page.cleanup();
  }
});
