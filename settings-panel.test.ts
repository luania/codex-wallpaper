import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { DEFAULT_INJECT_SETTINGS, INJECT_SETTINGS_STORAGE_KEY } from './settings.ts';
import { installSettingsPanel } from './settings-panel.ts';

type Listener = (event: any) => void;

class FakeElement {
  id = '';
  type = '';
  value = '';
  checked = false;
  min = '';
  max = '';
  step = '';
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  onclick: (() => void) | undefined;
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...elements: FakeElement[]) {
    for (const element of elements) this.appendChild(element);
  }

  appendChild(element: FakeElement) {
    element.parentElement = this;
    this.children.push(element);
    return element;
  }

  replaceChildren(...elements: FakeElement[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...elements);
  }

  remove() {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parentElement!.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string) {
    if (name === 'id') this.id = value;
  }

  addEventListener(type: string, listener: Listener) {
    let handlers = this.listeners.get(type);
    if (!handlers) this.listeners.set(type, handlers = new Set());
    handlers.add(listener);
  }

  dispatch(type: string, event: any = {}) {
    const next = { ...event, target: this, currentTarget: this };
    for (const listener of this.listeners.get(type) ?? []) listener(next);
    if (type === 'click') this.onclick?.();
  }

  focus() {}

  querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
    for (const child of this.children) {
      if (selector === 'button' && child.tagName === 'button') return child as T;
      if (selector === 'input' && child.tagName === 'input') return child as T;
      if (selector === '.pixiv-settings-message' && child.className === 'pixiv-settings-message') return child as T;
      const nested = child.querySelector<T>(selector);
      if (nested) return nested;
    }
    return null;
  }

  queryAll(selector: string, result: FakeElement[] = []) {
    for (const child of this.children) {
      if (selector === 'button' && child.tagName === 'button') result.push(child);
      if (selector === 'input[type="number"]' && child.tagName === 'input' && child.type === 'number') result.push(child);
      if (selector === 'select' && child.tagName === 'select') result.push(child);
      child.queryAll(selector, result);
    }
    return result;
  }
}

function createPage() {
  const html = new FakeElement('html');
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let stored: string | null = null;
  const document = {
    documentElement: html,
    activeElement: null as FakeElement | null,
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    getElementById(id: string) {
      function find(element: FakeElement): FakeElement | null {
        if (element.id === id) return element;
        for (const child of element.children) {
          const result = find(child);
          if (result) return result;
        }
        return null;
      }
      return find(html);
    },
  };
  const window = {
    localStorage: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    },
    addEventListener(type: string, listener: Listener) {
      let handlers = listeners.get(type);
      if (!handlers) listeners.set(type, handlers = new Set());
      handlers.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    setTimeout(callback: () => void) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id?: number) {
      if (id !== undefined) timers.delete(id);
    },
  };
  const install = runInNewContext(`(${installSettingsPanel.toString()})`, { window, document }) as
    (settings: typeof DEFAULT_INJECT_SETTINGS, key: string) => unknown;
  const emit = (type: string, event: any = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    document,
    window,
    install: () => install(DEFAULT_INJECT_SETTINGS, INJECT_SETTINGS_STORAGE_KEY),
    emit,
    get stored() { return stored; },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    panel: () => document.getElementById('__pixiv_settings_panel__')!,
  };
}

function keyEvent(code: string, modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) {
  return {
    code,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    altKey: modifiers.altKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    isComposing: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
}

test('opens and closes from the shortcut and Escape', () => {
  const page = createPage();
  page.install();
  assert.equal(page.panel().style.display, 'none');
  page.emit('keydown', keyEvent('Comma', { metaKey: true, altKey: true }));
  assert.equal(page.panel().style.display, 'block');
  page.emit('keydown', keyEvent('Escape'));
  assert.equal(page.panel().style.display, 'none');
});

test('updates values immediately and persists them', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { ctrlKey: true, altKey: true }));
  const interval = page.panel().queryAll('input[type="number"]')[0]!;
  interval.value = '42';
  interval.dispatch('input');
  assert.equal(JSON.parse(page.stored!)["rotation"].intervalMs, 42_000);
});

test('shows explicit states for boolean settings and updates them immediately', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { ctrlKey: true, altKey: true }));
  const toggles = () => page.panel().queryAll('button').filter((button) => button.className === 'pixiv-settings-toggle');
  const visible = toggles()[1];
  assert.equal(visible?.textContent, '已开启');
  visible?.dispatch('click');
  assert.equal(toggles()[1]?.textContent, '已关闭');
  assert.equal(JSON.parse(page.stored!).appearance.visible, false);
});

test('shows wheel shortcuts for opacity controls', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { ctrlKey: true, altKey: true }));
  const buttons = page.panel().queryAll('button');
  assert.equal(buttons.find((button) => button.textContent === '⌘/Ctrl + Alt + 滚轮 ↑')?.textContent,
    '⌘/Ctrl + Alt + 滚轮 ↑');
  assert.equal(buttons.find((button) => button.textContent === '⌘/Ctrl + Alt + 滚轮 ↓')?.textContent,
    '⌘/Ctrl + Alt + 滚轮 ↓');
});

test('updates blend mode and object fit from appearance selects', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { ctrlKey: true, altKey: true }));
  const selects = page.panel().queryAll('select');
  assert.equal(selects.length, 2);
  selects[0]!.value = 'multiply';
  selects[0]!.dispatch('change');
  selects[1]!.value = 'contain';
  selects[1]!.dispatch('change');
  const stored = JSON.parse(page.stored!);
  assert.equal(stored.appearance.mixBlendMode, 'multiply');
  assert.equal(stored.appearance.objectFit, 'contain');
});

test('records an opacity wheel shortcut from the settings panel', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { ctrlKey: true, altKey: true }));
  const opacityUp = page.panel().queryAll('button').find((button) => button.textContent === '⌘/Ctrl + Alt + 滚轮 ↑')!;
  opacityUp.dispatch('click');
  page.emit('wheel', {
    deltaY: -1,
    metaKey: true,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  assert.equal(JSON.parse(page.stored!).shortcuts.opacityUp.code, 'WheelUp');
});

test('restores and persists the default settings', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { metaKey: true, altKey: true }));
  const interval = page.panel().queryAll('input[type="number"]')[0]!;
  interval.value = '42';
  interval.dispatch('input');
  page.panel().queryAll('button').find((button) => button.textContent === '恢复默认')!.dispatch('click');
  assert.deepEqual(JSON.parse(page.stored!), DEFAULT_INJECT_SETTINGS);
});

test('rejects conflicting recorded shortcuts and accepts a unique shortcut', () => {
  const page = createPage();
  page.install();
  page.emit('keydown', keyEvent('Comma', { metaKey: true, altKey: true }));
  const buttons = page.panel().queryAll('button');
  const nextButton = buttons.find((button) => button.textContent.includes('Right'))!;
  nextButton.dispatch('click');
  page.emit('keydown', keyEvent('ArrowLeft', { metaKey: true, altKey: true }));
  assert.equal(page.stored, null);
  page.emit('keydown', keyEvent('KeyN', { ctrlKey: true, shiftKey: true }));
  assert.equal(JSON.parse(page.stored!).shortcuts.next.code, 'KeyN');
  assert.equal(JSON.parse(page.stored!).shortcuts.next.primary, true);
});

test('reinstalling removes the old panel and key listener', () => {
  const page = createPage();
  page.install();
  page.install();
  assert.equal(page.document.documentElement.children.filter((child) => child.id === '__pixiv_settings_panel__').length, 1);
  assert.equal(page.listenerCount('keydown'), 1);
});

