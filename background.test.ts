import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { installPixivBackground } from './background.ts';
import { DEFAULT_INJECT_SETTINGS } from './settings.ts';

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
  initialSettings?: typeof DEFAULT_INJECT_SETTINGS,
) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const appended: Array<FakeImage | FakeElement> = [];
  const copied: string[] = [];
  const preventedEvents: string[] = [];
  const objectUrls: string[] = [];
  const revokedUrls: string[] = [];
  const timerDelays: number[] = [];
  const settingsSubscribers = new Set<(settings: typeof DEFAULT_INJECT_SETTINGS) => void>();
  let currentSettings = initialSettings;
  let shown: FakeImage | undefined;
  let decodeCalls = 0;
  const sizes: Record<string, [number, number]> = {
    'selected/wide.png': [1600, 900],
    'selected/wide2.png': [1400, 900],
    'selected/wide3.png': [1200, 800],
    'selected/tall.jpg': [700, 1000],
    'selected/tall2.jpg': [600, 1000],
  };

  class FakeElement {
    id = '';
    style: Record<string, string> = {};
    textContent = '';
    removed = false;
    children: FakeElement[] = [];

    setAttribute() {}
    appendChild(element: FakeElement) {
      this.children.push(element);
      return element;
    }
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
      timerDelays.push(delay);
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
    ...(initialSettings ? {
      __pixivInjectSettings__: initialSettings,
      __pixivSubscribeSettings__(subscriber: (settings: typeof DEFAULT_INJECT_SETTINGS) => void) {
        settingsSubscribers.add(subscriber);
        subscriber(currentSettings!);
        return () => settingsSubscribers.delete(subscriber);
      },
      __pixivSetSettings__(settings: typeof DEFAULT_INJECT_SETTINGS) {
        currentSettings = settings;
        for (const subscriber of settingsSubscribers) subscriber(settings);
      },
    } : {}),
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
  const installRaw = runInNewContext(`(${installPixivBackground.toString()})`, {
    window,
    document,
    HTMLInputElement: FakeInput,
    Image: FakeImage,
    navigator,
    URL,
    AbortController,
    console,
    Math: { min: Math.min, max: Math.max, floor: Math.floor, round: Math.round, random },
  }) as (inputId: string, metadata: Array<{ path: string; orientation?: 'landscape' | 'portrait' }>) => Promise<number>;
  const install = (
    inputId: string,
    metadata: Array<{ path: string; orientation?: 'landscape' | 'portrait' }> = files.map((file) => ({
      path: file.webkitRelativePath.replace(/^selected\//, ''),
      orientation: sizes[file.webkitRelativePath]?.[0]! >= sizes[file.webkitRelativePath]?.[1]!
        ? 'landscape' as const
        : 'portrait' as const,
    })),
  ) => installRaw(inputId, metadata);

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
    get progress() { return elements.get('__my_progress__'); },
    get progressFill() { return elements.get('__my_progress__')?.children[0]; },
    get copied() { return copied; },
    get preventedEvents() { return preventedEvents; },
    listenerCount(type: string) { return listeners.get(type)?.size ?? 0; },
    get objectUrls() { return objectUrls; },
    get revokedUrls() { return revokedUrls; },
    get timerDelays() { return timerDelays; },
    setSettings(settings: typeof DEFAULT_INJECT_SETTINGS) {
      const setSettings = (window as typeof window & {
        __pixivSetSettings__?: (next: typeof DEFAULT_INJECT_SETTINGS) => void;
      }).__pixivSetSettings__;
      assert.ok(setSettings, 'settings bridge was not initialized');
      setSettings(settings);
    },
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
    assert.deepEqual(page.objectUrls, ['blob:selected/wide.png']);
    assert.equal(page.decodeCalls, 1);
  } finally {
    page.cleanup();
  }
});

test('classifies files in the browser and follows resize orientation', async () => {
  const page = createPage(() => 0);
  await page.install('input', [
    { path: 'wide.png', orientation: 'landscape' },
    { path: 'tall.jpg' },
  ]);
  try {
    assert.equal(page.shown?.url, 'blob:selected/wide.png');
    assert.equal(page.decodeCalls, 1);
    page.window.innerWidth = 600;
    page.window.innerHeight = 1000;
    page.emit('resize');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/tall.jpg');
    assert.deepEqual(page.objectUrls, ['blob:selected/wide.png', 'blob:selected/tall.jpg']);
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

test('goes back through displayed images with the left shortcut', async () => {
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  const shortcut = (code: string, modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean }> = {}) => ({
    code,
    altKey: true,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? true,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(Number.parseFloat(page.progressFill?.style.width ?? '0') > 0);

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide.png');
    assert.equal(page.progressFill?.style.width, '0%');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.status?.textContent, '没有更多历史图片');

    page.emit('keydown', { ...shortcut('ArrowLeft'), repeat: true });
    assert.equal(page.status?.textContent, '没有更多历史图片');
  } finally {
    page.cleanup();
  }
});

test('moves forward through history before resuming random rotation', async () => {
  const page = createPage(() => 0.999999, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
    { name: 'wide3.png', type: 'image/png', webkitRelativePath: 'selected/wide3.png' },
  ]);
  await page.install('input');
  const shortcut = (code: string) => ({
    code,
    altKey: true,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    assert.equal(page.shown?.url, 'blob:selected/wide3.png');
    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide3.png');

    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide3.png');

    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide3.png');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.status?.textContent, '没有更多历史图片');

    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide2.png');

    page.emit('keydown', shortcut('ArrowRight'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.shown?.url, 'blob:selected/wide3.png');
  } finally {
    page.cleanup();
  }
});

test('keeps at most twenty historical images', async () => {
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  const shortcut = (code: string) => ({
    code,
    altKey: true,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    for (let index = 0; index < 22; index++) {
      page.emit('keydown', shortcut('ArrowRight'));
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (let index = 0; index < 20; index++) {
      page.emit('keydown', shortcut('ArrowLeft'));
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.notEqual(page.status?.textContent, '没有更多历史图片');

    page.emit('keydown', shortcut('ArrowLeft'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.status?.textContent, '没有更多历史图片');
  } finally {
    page.cleanup();
  }
});

test('shows a one-rotation progress bar after an image is displayed', async () => {
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  try {
    assert.equal(page.progress?.style.position, 'fixed');
    assert.equal(page.progress?.style.bottom, '0');
    assert.equal(page.progress?.style.display, '');
    assert.equal(page.progressFill?.style.width, '0%');

    await new Promise((resolve) => setTimeout(resolve, 100));
    const width = Number.parseFloat(page.progressFill?.style.width ?? '0');
    assert.ok(width > 0 && width < 1, `expected a partial progress width, got ${width}%`);
    assert.equal(page.progressFill?.style.transition, 'none');
  } finally {
    page.cleanup();
  }
});

test('resets the progress bar after manual and orientation changes', async () => {
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
    { name: 'tall.jpg', type: 'image/jpeg', webkitRelativePath: 'selected/tall.jpg' },
    { name: 'tall2.jpg', type: 'image/jpeg', webkitRelativePath: 'selected/tall2.jpg' },
  ]);
  await page.install('input');
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(Number.parseFloat(page.progressFill?.style.width ?? '0') > 0);

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
    for (let index = 0; index < 8; index++) await Promise.resolve();
    assert.equal(page.progressFill?.style.width, '0%');

    page.window.innerWidth = 600;
    page.window.innerHeight = 1000;
    page.emit('resize');
    for (let index = 0; index < 8; index++) await Promise.resolve();
    assert.equal(page.progressFill?.style.width, '0%');
  } finally {
    page.cleanup();
  }
});

test('hides the progress bar when only one image can rotate', async () => {
  const page = createPage(undefined, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
  ]);
  await page.install('input');
  try {
    assert.equal(page.progress?.style.display, 'none');
    assert.equal(page.progressFill?.style.width, '0%');
  } finally {
    page.cleanup();
  }
});

test('applies persisted appearance settings and restarts rotation timing when they change', async () => {
  const initial = structuredClone(DEFAULT_INJECT_SETTINGS);
  initial.rotation.intervalMs = 12_000;
  initial.rotation.fadeDurationMs = 250;
  initial.appearance.blurPx = 4;
  initial.appearance.opacity = 0.5;
  initial.appearance.visible = false;
  initial.appearance.mixBlendMode = 'multiply';
  initial.appearance.objectFit = 'contain';
  const page = createPage(() => 0, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ], initial);
  await page.install('input');
  try {
    assert.equal(page.shown?.style.filter, 'blur(4px)');
    assert.equal(page.shown?.style.opacity, '0.5');
    assert.equal(page.shown?.style.mixBlendMode, 'multiply');
    assert.equal(page.shown?.style.objectFit, 'contain');
    assert.equal(page.shown?.style.display, 'none');
    assert.equal(page.shown?.style.transition, 'opacity 250ms ease');

    const updated = structuredClone(initial);
    updated.rotation.intervalMs = 18_000;
    updated.appearance.blurPx = 8;
    updated.appearance.opacity = 0.75;
    updated.appearance.visible = true;
    updated.appearance.mixBlendMode = 'difference';
    updated.appearance.objectFit = 'none';
    page.setSettings(updated);
    assert.equal(page.shown?.style.filter, 'blur(8px)');
    assert.equal(page.shown?.style.opacity, '0.75');
    assert.equal(page.shown?.style.mixBlendMode, 'difference');
    assert.equal(page.shown?.style.objectFit, 'none');
    assert.equal(page.shown?.style.display, '');
    assert.ok(page.timerDelays.includes(18_000));

    updated.rotation.enabled = false;
    page.setSettings(updated);
    assert.equal(page.progress?.style.display, 'none');
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
    assert.equal(page.status?.textContent, '不透明度 34%');
  } finally {
    page.cleanup();
  }
});

test('shows the current image without effects while F5 is held', async () => {
  const page = createPage();
  await page.install('input');
  const event = {
    code: 'F5',
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() { page.preventedEvents.push('keydown'); },
    stopImmediatePropagation() {},
  };
  try {
    page.emit('keydown', event);
    assert.equal(page.shown?.style.filter, 'none');
    assert.equal(page.shown?.style.mixBlendMode, 'normal');
    assert.equal(page.shown?.style.opacity, '1');
    assert.deepEqual(page.preventedEvents, ['keydown']);

    page.emit('keydown', { ...event, repeat: true });
    assert.equal(page.shown?.style.filter, 'none');
    assert.deepEqual(page.preventedEvents, ['keydown', 'keydown']);
  } finally {
    page.cleanup();
  }
});

test('restores image effects after F5 is released', async () => {
  const page = createPage();
  await page.install('input');
  const f5 = {
    code: 'F5',
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  try {
    page.emit('keydown', f5);
    page.emit('keyup', f5);
    assert.equal(page.shown?.style.filter, 'blur(0px)');
    assert.equal(page.shown?.style.mixBlendMode, 'screen');
    assert.equal(page.shown?.style.opacity, '0.33');
  } finally {
    page.cleanup();
  }
});

test('keeps original image mode through image changes and restores updated values on release', async () => {
  const page = createPage(() => 0.999999, [
    { name: 'wide.png', type: 'image/png', webkitRelativePath: 'selected/wide.png' },
    { name: 'wide2.png', type: 'image/png', webkitRelativePath: 'selected/wide2.png' },
  ]);
  await page.install('input');
  const f5 = {
    code: 'F5',
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  try {
    page.emit('keydown', f5);
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
    page.emit('wheel', {
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      deltaY: -1,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
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
    assert.equal(page.shown?.style.filter, 'none');
    assert.equal(page.shown?.style.mixBlendMode, 'normal');
    assert.equal(page.shown?.style.opacity, '1');

    page.emit('keyup', f5);
    assert.equal(page.shown?.style.filter, 'blur(1px)');
    assert.equal(page.shown?.style.mixBlendMode, 'screen');
    assert.equal(page.shown?.style.opacity, '0.34');
  } finally {
    page.cleanup();
  }
});

test('ignores modified F5 and removes its keyup listener during cleanup', async () => {
  const page = createPage();
  await page.install('input');
  const modifiers = ['altKey', 'metaKey', 'ctrlKey', 'shiftKey'] as const;
  for (const modifier of modifiers) {
    page.emit('keydown', {
      code: 'F5',
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      [modifier]: true,
      preventDefault() { page.preventedEvents.push(modifier); },
      stopImmediatePropagation() {},
    });
  }
  assert.equal(page.shown?.style.filter, 'blur(0px)');
  assert.deepEqual(page.preventedEvents, []);
  assert.equal(page.listenerCount('keyup'), 1);
  page.cleanup();
  assert.equal(page.listenerCount('keyup'), 0);
  assert.deepEqual(page.preventedEvents, []);
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
  assert.deepEqual(page.revokedUrls, ['blob:selected/wide.png']);
  assert.equal(page.input.removed, true);
  assert.equal(page.progress?.removed, true);
});

test('rejects a directory without supported images', async () => {
  const page = createPage(undefined, [
    { name: 'notes.txt', type: 'text/plain', webkitRelativePath: 'selected/notes.txt' },
  ]);
  await assert.rejects(page.install('input'), /所选目录中没有支持的图片/);
  assert.equal(page.input.removed, true);
});
