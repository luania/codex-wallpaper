import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { installPureMode } from './pure-mode.ts';

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
  private rect = { left: 0, width: 0 };
  private rectShift = () => 0;
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

  setRect(rect: { left: number; width: number }) {
    this.rect = rect;
  }

  setRectShiftReader(reader: () => number) {
    this.rectShift = reader;
  }

  getBoundingClientRect() {
    const shift = this.rectShift();
    return {
      left: this.rect.left + (Number.isFinite(shift) ? shift : 0),
      width: this.rect.width,
    };
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

function createPage() {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, { callback: () => void; due: number }>();
  const statusMessages: string[] = [];
  let nextTimerId = 1;
  let now = 0;

  const html = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const appRoot = new FakeElement('div');
  appRoot.id = 'root';
  const layout = new FakeElement('div');
  const sidebar = new FakeElement('aside');
  const main = new FakeElement('main');
  main.setAttribute('class', '_MainContentLeftBorder_test_');
  main.setRect({ left: 260, width: 1180 });
  main.setRectShiftReader(() => Number.parseFloat(body.style.getPropertyValue('--codex-pure-mode-main-shift')) || 0);
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
    setMainRect(rect: { left: number; width: number }) {
      main.setRect(rect);
    },
    setInnerWidth(width: number) {
      window.innerWidth = width;
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
    cleanup() {
      (window as typeof window & { __codexPureModeCleanup__?: () => void }).__codexPureModeCleanup__?.();
    },
  };
}

test('enters pure mode with a body class and keeps node attributes untouched', () => {
  const page = createPage();
  assert.equal(page.install(), true);
  page.advance(30_000);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '-130px');
  assert.equal(page.main.hasAttribute('data-codex-pure-mode-hidden'), false);
  page.cleanup();
});

test('recalculates the main area shift when the viewport or layout changes', () => {
  const page = createPage();
  page.install();
  page.advance(30_000);
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '-130px');

  page.setInnerWidth(1200);
  page.setMainRect({ left: 200, width: 1000 });
  page.emit('resize');
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '-100px');

  page.setMainRect({ left: 100, width: 1000 });
  page.replaceConversation();
  page.advance(0);
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '0px');
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

test('the shortcut immediately enters and exits pure mode', () => {
  const page = createPage();
  page.install();
  const shortcut = {
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

  page.emit('keydown', shortcut);
  assert.equal(page.statusMessages.at(-1), '纯享模式已开启');
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('keydown', { ...shortcut });
  assert.equal(page.statusMessages.at(-1), '纯享模式已关闭');
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '');
  page.advance(30_000);
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('keydown', { ...shortcut });
  assert.equal(page.statusMessages.at(-1), '纯享模式已关闭');
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(29_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('mouse clicks do not wake pure mode after the shortcut is released', () => {
  const page = createPage();
  page.install();
  const shortcut = {
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

  page.emit('keydown', shortcut);
  page.emit('keyup', { code: 'KeyP' });
  page.emit('keyup', { code: 'AltRight' });
  page.emit('keyup', { code: 'MetaLeft' });
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('keydown', { code: 'KeyA' });
  page.emit('mousemove');
  page.emit('wheel');
  assert.equal(page.body.hasClass('_pure-mode_'), true);

  page.emit('click', { detail: 1 });
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.cleanup();
});

test('Escape exits pure mode and allows idle mode to start again', () => {
  const page = createPage();
  page.install();
  const shortcut = {
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

  page.emit('keydown', shortcut);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
  page.emit('keydown', {
    code: 'Escape',
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '');

  page.advance(29_999);
  assert.equal(page.body.hasClass('_pure-mode_'), false);
  page.advance(1);
  assert.equal(page.body.hasClass('_pure-mode_'), true);
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
  assert.equal(page.body.style.getPropertyValue('--codex-pure-mode-main-shift'), '');
});

test('inject.css owns pure mode visibility and positioning rules', async () => {
  const css = await readFile(new URL('./inject.css', import.meta.url), 'utf8');
  assert.match(css, /body\.\_pure-mode_ div\[data-floating-navigation-rail-list="true"\]/);
  assert.match(css, /body\.\_pure-mode_ \[class\*=\"_PageSurface_\"\]:not\(\[class\*=\"_PageSurfaceLayout_\"\]\)/);
  assert.match(css, /body\.\_pure-mode_ \.app-shell-left-panel/);
  assert.match(css, /body\.\_pure-mode_ header/);
  assert.match(css, /body\.\_pure-mode_ div\[data-request-input-activity-root="true"\] \+ div/);
  assert.doesNotMatch(css, /body\.\_pure-mode_ \[data-app-shell-page-surface\]/);
  assert.match(css, /body\.\_pure-mode_ main\[class\*=\"_MainContentLeftBorder_\"\]/);
  assert.match(css, /transform: translateX\(var\(--codex-pure-mode-main-shift, 0px\)\)/);
  assert.match(css, /body\.\_pure-mode_ \[data-composer-overlay-floating-ui="true"\]/);
  assert.match(css, /\:has\(\[data-composer-overlay-floating-ui="true"\]\)/);
  assert.match(css, /transition: opacity 200ms ease/);
});
