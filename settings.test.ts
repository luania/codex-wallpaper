import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INJECT_SETTINGS,
  INJECT_SETTINGS_STORAGE_KEY,
  loadInjectSettings,
  normalizeInjectSettings,
  saveInjectSettings,
} from './settings.ts';

function createStorage(initial?: string) {
  let value = initial;
  return {
    getItem(key: string) {
      return key === INJECT_SETTINGS_STORAGE_KEY ? value ?? null : null;
    },
    setItem(key: string, next: string) {
      if (key === INJECT_SETTINGS_STORAGE_KEY) value = next;
    },
    read() {
      return value;
    },
  };
}

test('loads the documented defaults on first use', () => {
  const storage = createStorage();
  assert.deepEqual(loadInjectSettings(storage), DEFAULT_INJECT_SETTINGS);
  assert.equal(DEFAULT_INJECT_SETTINGS.rotation.intervalMs, 5 * 60_000);
  assert.equal(DEFAULT_INJECT_SETTINGS.shortcuts.opacityUp?.code, 'WheelUp');
  assert.equal(DEFAULT_INJECT_SETTINGS.shortcuts.opacityDown?.code, 'WheelDown');
  assert.equal(DEFAULT_INJECT_SETTINGS.appearance.mixBlendMode, 'screen');
  assert.equal(DEFAULT_INJECT_SETTINGS.appearance.objectFit, 'cover');
});

test('migrates the old keyboard aliases for opacity to wheel shortcuts', () => {
  const settings = loadInjectSettings(createStorage(JSON.stringify({
    shortcuts: {
      opacityUp: { code: 'PageUp', primary: true, alt: true, shift: false },
      opacityDown: { code: 'PageDown', primary: true, alt: true, shift: false },
    },
  })));
  assert.equal(settings.shortcuts.opacityUp?.code, 'WheelUp');
  assert.equal(settings.shortcuts.opacityDown?.code, 'WheelDown');
});

test('normalizes malformed, unknown, and out-of-range settings', () => {
  const settings = normalizeInjectSettings({
    rotation: { enabled: 'yes', intervalMs: -1, fadeDurationMs: 99_999 },
    appearance: {
      blurPx: Number.POSITIVE_INFINITY,
      opacity: 4,
      visible: false,
      mixBlendMode: 'unsupported',
      objectFit: 'unsupported',
    },
    pureMode: { autoEnter: false, idleMs: 1 },
    shortcuts: {
      next: { code: 'KeyN', primary: false, alt: true, shift: true },
      unknown: { code: 'KeyX' },
    },
    unknown: true,
  });

  assert.equal(settings.rotation.enabled, true);
  assert.equal(settings.rotation.intervalMs, 10_000);
  assert.equal(settings.rotation.fadeDurationMs, 5_000);
  assert.equal(settings.appearance.blurPx, 0);
  assert.equal(settings.appearance.opacity, 1);
  assert.equal(settings.appearance.visible, false);
  assert.equal(settings.appearance.mixBlendMode, 'screen');
  assert.equal(settings.appearance.objectFit, 'cover');
  assert.equal(settings.pureMode.autoEnter, false);
  assert.equal(settings.pureMode.idleMs, 5_000);
  assert.deepEqual(settings.shortcuts.next, { code: 'KeyN', primary: false, alt: true, shift: true });
  assert.equal('unknown' in settings.shortcuts, false);
});

test('saves normalized values and reads them back from the versioned key', () => {
  const storage = createStorage();
  const saved = saveInjectSettings(storage, {
    rotation: { intervalMs: 42_000 },
    appearance: { opacity: 0.5 },
  });
  assert.equal(saved.rotation.intervalMs, 42_000);
  assert.equal(JSON.parse(storage.read()!).rotation.intervalMs, 42_000);
  assert.deepEqual(loadInjectSettings(storage), saved);
});

test('falls back to defaults when persisted JSON is damaged', () => {
  const storage = createStorage('{not json');
  assert.deepEqual(loadInjectSettings(storage), DEFAULT_INJECT_SETTINGS);
});

