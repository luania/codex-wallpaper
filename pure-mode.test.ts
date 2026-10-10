import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { installPureMode } from './pure-mode.ts';
import { DEFAULT_INJECT_SETTINGS } from './settings.ts';

type Listener = (...args: any[]) => void;

class FakeElement {
  id = '';
  textContent = '';
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  private readonly attributes = new Map<string, string>();
  readonly style = {
    properties: new Map<string, string>(),
    setProperty: (name: string, value: string) => this.style.properties.set(name, value),
    removeProperty: (name: string) => this.style.properties.delete(name),
    getPropertyValue: (name: string) => this.style.properties.get(name) ?? '',
  };
  readonly classList = {
    add: (...tokens: string[]) => {
      const classes = new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
      for (const token of tokens) classes.add(token);
      this.setAttribute('class', [...classes].join(' '));
    },
    remove: (...tokens: string[]) => {
      const classes = new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
      for (const token of tokens) classes.delete(token);
      this.setAttribute('class', [...classes].join(' '));
    },
    contains: (token: string) => (this.getAttribute('class') ?? '').split(/\s+/).includes(token),
  };
  readonly tagName: string;

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  appendChild(element: FakeElement) {
    element.parentElement = this;
    this.children.push(element);
    return element;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasClass(token: string) {
    return this.classList.contains(token);
  }
}

class FakeStyle extends FakeElement {
  constructor() {
    super('style');
  }
}

class FakeMutationObserver {
  static current: FakeMutationObserver | undefined;
  private callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeMutationObserver.current = this;
  }

  observe() {}
  disconnect() {}
  trigger() {
    this.callback();
  }
}

function createPage(initialSettings?: typeof DEFAULT_INJECT_SETTINGS) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, { callback: () => void; due: number }>();
  const statusMessages: string[] = [];
  let nextTimerId = 1;
  let now = 0;
  let currentSettings = initialSettings;
  const settingsSubscribers = new Set<(settings: typeof DEFAULT_INJECT_SETTINGS) => void>();

  const html = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const appRoot = new FakeElement('div');
  appRoot.id = 'root';
  const layout = new FakeElement('div');
  const sidebar = new FakeElement('aside');
  const main = new FakeElement('main');
  main.setAttribute('class', '_MainContentLeftBorder_test_');
  const conversation = new FakeElement('div');
  conversation.setAttribute('data-thread-find-target', 'conversation');
  const composer = new FakeElement('div');
  const toast = new FakeElement('div');
  const status = new FakeElement('div');
  status.id = '__my_status__';
  const progress = new FakeElement('div');
  progress.id = '__my_progress__';
  body.appendChild(appRoot);
  body.appendChild(toast);
  appRoot.appendChild(layout);
  layout.appendChild(sidebar);
  layout.appendChild(main);
  main.appendChild(conversation);
  main.appendChild(composer);
  html.appendChild(head);
  html.appendChild(body);
  html.appendChild(status);
  html.appendChild(progress);

  const document = {
    documentElement: html,
    head,
    body,
    createElement(tagName: string) {
      return tagName === 'style' ? new FakeStyle() : new FakeElement(tagName);
    },
    querySelector(selector: string) {
      if (selector === '[data-thread-find-target="conversation"]') return bodyQueryConversation();
      if (selector === 'main[class*="_MainContentLeftBorder_"]') return main;
      return null;
    },
    getElementById(id: string) {
      function find(element: FakeElement): FakeElement | null {
        if (element.id === id) return element;
        for (const child of element.children) {
          const match = find(child);
          if (match) return match;
        }
        return null;
      }
      return find(html);
    },
  };

  let currentConversation = conversation;
  function bodyQueryConversation() {
    return currentConversation.parentElement ? currentConversation : null;
  }

  const window = {
    innerWidth: 1440,
    setTimeout(callback: () => void, delay: number) {
      const id = nextTimerId++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id?: number) {
      if (id !== undefined) timers.delete(id);
    },
    __pixivShowStatus__(message: string) {
      statusMessages.push(message);
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

  const installRaw = runInNewContext(`(${installPureMode.toString()})`, {
    window,
    document,
    HTMLElement: FakeElement,
    MutationObserver: FakeMutationObserver,
  }) as () => boolean;

  return {
    install: installRaw,
    html,
    body,
    sidebar,
    main,
    conversation,
    composer,
    toast,
    statusMessages,
    emit(type: string, event: unknown = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort(([, a], [, b]) => a.due - b.due)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.due;
        timer.callback();
      }
      now = target;
    },
    replaceConversation() {
      const replacement = new FakeElement('div');
      replacement.setAttribute('data-thread-find-target', 'conversation');
      currentConversation.remove();
      main.appendChild(replacement);
      currentConversation = replacement;
      FakeMutationObserver.current?.trigger();
      return replacement;
    },
    setSettings(settings: typeof DEFAULT_INJECT_SETTINGS) {
      const setSettings = (window as typeof window & {
        __pixivSetSettings__?: (next: typeof DEFAULT_INJECT_SETTINGS) => void;
      }).__pixivSetSettings__;
      assert.ok(setSettings);
      setSettings(settings);
    },
    cleanup() {
      (window as typeof window & { __codexPureModeCleanup__?: () => void }).__codexPureModeCleanup__?.();
    },
  };
}

const f4Event = {
  code: 'F4',
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  preventDefault() {},
  stopImmediatePropagation() {},
};

function tapF4(page: ReturnType<typeof createPage>) {
  page.emit('keydown', f4Event);
  page.emit('keyup', { code: 'F4' });
}

function doubleTapF4(page: ReturnType<typeof createPage>) {
  tapF4(page);
  tapF4(page);
}

test('enters pure mode with a body class and keeps node attributes untouched', () => {
  const page = createPage();
  assert.equal(page.install(), true);
  page.advance(30_000);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(page.main.hasAttribute('data-codex-pure-mode-hidden'), false);
  page.cleanup();
});

test('honors dynamic auto-enter and idle duration settings', () => {
  const settings = structuredClone(DEFAULT_INJECT_SETTINGS);
  settings.pureMode.autoEnter = false;
  settings.pureMode.idleMs = 5_000;
  const page = createPage(settings);
  page.install();
  page.advance(10_000);
  assert.equal(page.body.hasClass('_pure-mode_'), false);

  const updated = structuredClone(settings);
  updated.pureMode.autoEnter = true;
  page.setSettings(updated);
  page.advance(4_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('uses the configured pure-mode shortcut for double-tap and hold behavior', () => {
  const settings = structuredClone(DEFAULT_INJECT_SETTINGS);
  settings.pureMode.autoEnter = false;
  settings.shortcuts.togglePureMode = { code: 'KeyM', primary: true, alt: false, shift: true };
  const page = createPage(settings);
  page.install();
  const press = () => {
    page.emit('keydown', {
      code: 'KeyM', altKey: false, metaKey: false, ctrlKey: true, shiftKey: true,
      isComposing: false, repeat: false, preventDefault() {}, stopImmediatePropagation() {},
    });
    page.emit('keyup', { code: 'KeyM', preventDefault() {}, stopImmediatePropagation() {} });
  };

  press();
  press();
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(page.statusMessages.at(-1), '纯享模式已开启');

  page.emit('keydown', {
    code: 'KeyM', altKey: false, metaKey: false, ctrlKey: true, shiftKey: true,
    isComposing: false, repeat: false, preventDefault() {}, stopImmediatePropagation() {},
  });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.emit('keyup', { code: 'KeyM', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('mouse movement does not wake pure mode and idle timer restarts when awake', () => {
  const page = createPage();
  page.install();
  page.advance(29_000);
  page.emit('mousemove');
  page.advance(29_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.emit('mousemove');
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(page.html.children.find((child) => child.tagName === 'body')?.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('double-tapping F4 immediately enters and exits pure mode', () => {
  const page = createPage();
  page.install();

  doubleTapF4(page);
  assert.equal(page.statusMessages.at(-1), '纯享模式已开启');
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  doubleTapF4(page);
  assert.equal(page.statusMessages.at(-1), '纯享模式已关闭');
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(30_000);
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  doubleTapF4(page);
  assert.equal(page.statusMessages.at(-1), '纯享模式已关闭');
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(29_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('mouse clicks do not wake pure mode after double-tapping F4', () => {
  const page = createPage();
  page.install();

  doubleTapF4(page);
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('keydown', { code: 'KeyA' });
  page.emit('mousemove');
  page.emit('wheel');
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('click', { detail: 1 });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('Escape does not exit pure mode', () => {
  const page = createPage();
  page.install();

  doubleTapF4(page);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  let prevented = false;
  let stopped = false;
  page.emit('keydown', {
    code: 'Escape',
    repeat: false,
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(prevented, false);
  assert.equal(stopped, false);
  page.cleanup();
});

test('holding F4 temporarily exits pure mode and restores it after release', () => {
  const page = createPage();
  page.install();
  doubleTapF4(page);
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  const statusCount = page.statusMessages.length;
  page.emit('keydown', { ...f4Event });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.statusMessages.length, statusCount);

  page.advance(30_000);
  assert.equal(page.body.hasClass('_pure-mode_'), false);

  page.emit('keyup', { code: 'F4' });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('repeated F4 keydown does not change temporary pure mode state', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);
  let preventedEvents = 0;
  let stoppedEvents = 0;
  const trackedEvent = {
    ...f4Event,
    preventDefault() { preventedEvents += 1; },
    stopImmediatePropagation() { stoppedEvents += 1; },
  };
  page.emit('keydown', trackedEvent);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.emit('keydown', { ...trackedEvent, repeat: true });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.emit('keyup', {
    code: 'F4',
    preventDefault() { preventedEvents += 1; },
    stopImmediatePropagation() { stoppedEvents += 1; },
  });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(preventedEvents, 3);
  assert.equal(stoppedEvents, 3);

  page.cleanup();
});

test('modified F4 does not temporarily exit pure mode', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);

  for (const modifier of ['altKey', 'metaKey', 'ctrlKey', 'shiftKey'] as const) {
    page.emit('keydown', {
      code: 'F4',
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      [modifier]: true,
    });
    assert.equal(page.body.hasClass('_pure-mode_'), true);
    page.emit('keyup', { code: 'F4' });
  }

  page.cleanup();
});

test('pure mode restores only after F4 is released', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);

  page.emit('keydown', { ...f4Event });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.emit('keydown', { ...f4Event, repeat: true });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.emit('keyup', { code: 'F4' });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('double-tapping F4 permanently closes pure mode', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);

  doubleTapF4(page);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.statusMessages.at(-1), '纯享模式已关闭');

  page.advance(29_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('a single F4 press does not toggle pure mode after the double-tap window', () => {
  const page = createPage();
  page.install();

  page.emit('keydown', { ...f4Event });
  page.emit('keyup', { code: 'F4' });
  page.advance(300);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.statusMessages.length, 0);

  page.advance(29_700);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('Alt+P no longer toggles pure mode', () => {
  const page = createPage();
  page.install();
  const event = {
    code: 'KeyP',
    altKey: true,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };

  page.emit('keydown', event);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.statusMessages.length, 0);
  page.cleanup();
});

test('reconciles mode state after the conversation is replaced', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);
  const replacement = page.replaceConversation();
  page.advance(0);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('cleanup restores the page and removes the body class', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);
  page.cleanup();
  assert.equal(page.body.hasClass('_pure-mode_'), false);
});

test('inject.css owns pure mode visibility rules', async () => {
  const css = await readFile(new URL('./inject.css', import.meta.url), 'utf8');
  assert.match(css, /body\.\_pure-mode_ div\[data-floating-navigation-rail-list="true"\]/);
  assert.match(css, /body\.\_pure-mode_ \[class\*=\"_PageSurface_\"\]:not\(\[class\*=\"_PageSurfaceLayout_\"\]\)/);
  assert.match(css, /body\.\_pure-mode_ \.app-shell-left-panel/);
  assert.match(css, /body\.\_pure-mode_ header/);
  assert.match(css, /body\.\_pure-mode_ div\[data-request-input-activity-root="true"\] \+ div/);
  assert.doesNotMatch(css, /body\.\_pure-mode_ \[data-app-shell-page-surface\]/);
  assert.match(css, /body\.\_pure-mode_ main\[class\*=\"_MainContentLeftBorder_\"\]/);
  assert.doesNotMatch(css, /translateX/);
  assert.match(css, /body\.\_pure-mode_ \[data-composer-overlay-floating-ui="true"\]/);
  assert.match(css, /\:has\(\[data-composer-overlay-floating-ui="true"\]\)/);
  assert.match(css, /transition: opacity 200ms ease/);
});
