import type { InjectSettings } from './settings.ts';

// Serialized into the isolated page world; keep this function self-contained.
export function installSettingsPanel(initialSettings: InjectSettings, storageKey: string) {
  type Shortcut = { code: string; primary: boolean; alt: boolean; shift: boolean };
  type Settings = {
    rotation: { enabled: boolean; intervalMs: number; fadeDurationMs: number };
    appearance: {
      blurPx: number;
      opacity: number;
      visible: boolean;
      mixBlendMode: string;
      objectFit: string;
    };
    pureMode: { autoEnter: boolean; idleMs: number };
    shortcuts: Record<string, Shortcut>;
  };
  type Subscriber = (settings: Settings) => void;
  const state = window as typeof window & {
    __pixivInjectSettings__?: Settings;
    __pixivSubscribeSettings__?: (subscriber: Subscriber) => () => void;
    __pixivSetSettings__?: (settings: Settings) => void;
    __pixivSettingsCleanup__?: () => void;
    __pixivOpenSettings__?: () => void;
    __pixivSettingsPanelOpen__?: () => boolean;
  };
  state.__pixivSettingsCleanup__?.();
  document.getElementById('__pixiv_settings_panel__')?.remove();

  const defaults = JSON.parse(JSON.stringify(initialSettings)) as Settings;
  const clone = (settings: Settings) => JSON.parse(JSON.stringify(settings)) as Settings;
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  const mixBlendModes = [
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
    'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
    'saturation', 'color', 'luminosity',
  ] as const;
  const objectFits = ['fill', 'contain', 'cover', 'none', 'scale-down'] as const;
  const enumValue = (value: unknown, fallback: string, allowed: readonly string[]) =>
    typeof value === 'string' && allowed.includes(value) ? value : fallback;
  const normalizeShortcut = (value: unknown, fallback: Shortcut): Shortcut => {
    if (!isRecord(value) || typeof value.code !== 'string' || value.code.length === 0) return { ...fallback };
    return {
      code: value.code.slice(0, 64),
      primary: bool(value.primary, fallback.primary),
      alt: bool(value.alt, fallback.alt),
      shift: bool(value.shift, fallback.shift),
    };
  };
  const normalize = (value: unknown): Settings => {
    const source = isRecord(value) ? value : {};
    const rotation = isRecord(source.rotation) ? source.rotation : {};
    const appearance = isRecord(source.appearance) ? source.appearance : {};
    const pureMode = isRecord(source.pureMode) ? source.pureMode : {};
    const shortcuts = isRecord(source.shortcuts) ? source.shortcuts : {};
    const result: Settings = {
      rotation: {
        enabled: bool(rotation.enabled, defaults.rotation.enabled),
        intervalMs: number(rotation.intervalMs, defaults.rotation.intervalMs, 10_000, 3_600_000),
        fadeDurationMs: number(rotation.fadeDurationMs, defaults.rotation.fadeDurationMs, 0, 5_000),
      },
      appearance: {
        blurPx: number(appearance.blurPx, defaults.appearance.blurPx, 0, 500),
        opacity: number(appearance.opacity, defaults.appearance.opacity, 0, 1),
        visible: bool(appearance.visible, defaults.appearance.visible),
        mixBlendMode: enumValue(appearance.mixBlendMode, defaults.appearance.mixBlendMode, mixBlendModes),
        objectFit: enumValue(appearance.objectFit, defaults.appearance.objectFit, objectFits),
      },
      pureMode: {
        autoEnter: bool(pureMode.autoEnter, defaults.pureMode.autoEnter),
        idleMs: number(pureMode.idleMs, defaults.pureMode.idleMs, 5_000, 600_000),
      },
      shortcuts: {},
    };
    for (const [action, fallback] of Object.entries(defaults.shortcuts)) {
      const shortcut = normalizeShortcut(shortcuts[action], fallback);
      // Migrate the old opacity defaults, which were stored as keyboard aliases.
      if (action === 'opacityUp' && shortcut.code === 'PageUp' &&
        shortcut.primary === fallback.primary && shortcut.alt === fallback.alt && shortcut.shift === fallback.shift) {
        shortcut.code = fallback.code;
      }
      if (action === 'opacityDown' && shortcut.code === 'PageDown' &&
        shortcut.primary === fallback.primary && shortcut.alt === fallback.alt && shortcut.shift === fallback.shift) {
        shortcut.code = fallback.code;
      }
      result.shortcuts[action] = shortcut;
    }
    return result;
  };

  let settings = defaults;
  try {
    const stored = window.localStorage?.getItem(storageKey);
    if (stored) settings = normalize(JSON.parse(stored));
  } catch {
    settings = defaults;
  }
  const subscribers = new Set<Subscriber>();
  const save = () => {
    try { window.localStorage?.setItem(storageKey, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  };
  const publish = () => {
    state.__pixivInjectSettings__ = settings;
    save();
    for (const subscriber of subscribers) subscriber(settings);
  };
  state.__pixivInjectSettings__ = settings;
  state.__pixivSubscribeSettings__ = (subscriber) => {
    subscribers.add(subscriber);
    subscriber(settings);
    return () => subscribers.delete(subscriber);
  };
  state.__pixivSetSettings__ = (next) => {
    settings = normalize(next);
    publish();
  };

  let panel: HTMLDivElement | undefined;
  let recordingAction: string | undefined;
  let message: HTMLDivElement | undefined;
  let messageText = '';
  let messageError = false;
  let messageTimer: number | undefined;
  let opener: HTMLElement | null = null;
  let open = false;
  const cleanup = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onWheel, true);
    window.clearTimeout(messageTimer);
    messageTimer = undefined;
    delete state.__pixivSubscribeSettings__;
    subscribers.clear();
    delete state.__pixivSetSettings__;
    panel?.remove();
    panel = undefined;
    if (state.__pixivSettingsCleanup__ === cleanup) delete state.__pixivSettingsCleanup__;
    if (state.__pixivOpenSettings__) delete state.__pixivOpenSettings__;
    if (state.__pixivSettingsPanelOpen__) delete state.__pixivSettingsPanelOpen__;
  };
  state.__pixivSettingsCleanup__ = cleanup;

  const shortcutLabel = (shortcut: Shortcut) => {
    const parts: string[] = [];
    if (shortcut.primary) parts.push('⌘/Ctrl');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.shift) parts.push('Shift');
    const code = shortcut.code === 'WheelUp' ? '滚轮 ↑' :
      shortcut.code === 'WheelDown' ? '滚轮 ↓' :
        shortcut.code.replace(/^Key/, '').replace(/^Arrow/, '');
    parts.push(code);
    return parts.join(' + ');
  };
  const shortcutMatches = (event: KeyboardEvent, shortcut: Shortcut) =>
    event.code === shortcut.code && event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift && (shortcut.primary
      ? event.metaKey !== event.ctrlKey
      : !event.metaKey && !event.ctrlKey);
  const showMessage = (text: string, error = false) => {
    messageText = text;
    messageError = error;
    if (message) {
      message.textContent = messageText;
      message.dataset.error = messageError ? 'true' : 'false';
      message.style.opacity = '1';
    }
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
      messageText = '';
      messageTimer = undefined;
      if (message) message.style.opacity = '0';
    }, 2200);
  };
  const update = (change: (next: Settings) => void, refresh = false) => {
    const next = clone(settings);
    change(next);
    settings = normalize(next);
    publish();
    if (refresh) render();
  };
  const input = (type: string, value: string, onChange: (value: string) => void) => {
    const element = document.createElement('input');
    element.type = type;
    element.value = value;
    element.addEventListener('change', () => onChange(element.value));
    return element;
  };
  const row = (label: string, control: HTMLElement) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'pixiv-settings-row';
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(text, control);
    return wrapper;
  };
  const toggleControl = (checked: boolean, onChange: (value: boolean) => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'pixiv-settings-toggle';
    element.setAttribute('aria-pressed', checked ? 'true' : 'false');
    element.textContent = checked ? '已开启' : '已关闭';
    element.onclick = () => onChange(!checked);
    return element;
  };
  const numericInput = (
    value: number,
    minimum: number,
    maximum: number,
    step: number,
    scale: number,
    change: (next: Settings, value: number) => void,
    read: (settings: Settings) => number,
  ) => {
    const element = input('number', String(value), (raw) => {
      if (raw.trim() === '' || !Number.isFinite(Number(raw))) return;
      update((next) => change(next, Number(raw) * scale));
      element.value = String(read(settings));
    }) as HTMLInputElement;
    element.min = String(minimum);
    element.max = String(maximum);
    element.step = String(step);
    element.addEventListener('input', () => {
      if (element.value.trim() !== '') {
        const raw = element.value;
        if (Number.isFinite(Number(raw))) {
          update((next) => change(next, Number(raw) * scale));
        }
      }
    });
    element.addEventListener('change', () => {
      if (element.value.trim() === '' || !Number.isFinite(Number(element.value))) {
        element.value = String(read(settings));
      } else {
        element.value = String(read(settings));
      }
    });
    return element;
  };
  const selectInput = (
    value: string,
    options: readonly string[],
    change: (next: Settings, value: string) => void,
    read: (settings: Settings) => string,
  ) => {
    const element = document.createElement('select');
    for (const optionValue of options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      element.appendChild(option);
    }
    element.value = value;
    element.addEventListener('change', () => {
      update((next) => change(next, element.value));
      element.value = read(settings);
    });
    return element;
  };
  const section = (title: string) => {
    const element = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    element.appendChild(heading);
    return element;
  };
  const addField = (parent: HTMLElement, label: string, control: HTMLElement) => parent.appendChild(row(label, control));

  function render() {
    if (!panel) return;
    panel.replaceChildren();
    const header = document.createElement('div');
    header.className = 'pixiv-settings-header';
    const title = document.createElement('h2');
    title.textContent = '注入设置';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '关闭'; close.onclick = () => setOpen(false);
    header.append(title, close); panel.appendChild(header);

    const rotation = section('轮替与显示');
    addField(rotation, '自动轮替', toggleControl(settings.rotation.enabled, (value) => update((next) => {
      next.rotation.enabled = value;
    }, true)));
    const interval = numericInput(
      Math.round(settings.rotation.intervalMs / 1000), 10, 3600, 1, 1000,
      (next, value) => { next.rotation.intervalMs = value; },
      (current) => Math.round(current.rotation.intervalMs / 1000),
    );
    addField(rotation, '轮替间隔（秒）', interval);
    const fade = numericInput(
      settings.rotation.fadeDurationMs, 0, 5000, 100, 1,
      (next, value) => { next.rotation.fadeDurationMs = value; },
      (current) => current.rotation.fadeDurationMs,
    );
    addField(rotation, '淡入淡出（毫秒）', fade);
    const blur = numericInput(
      settings.appearance.blurPx, 0, 500, 1, 1,
      (next, value) => { next.appearance.blurPx = value; },
      (current) => current.appearance.blurPx,
    );
    addField(rotation, '模糊（像素）', blur);
    const opacity = numericInput(
      Math.round(settings.appearance.opacity * 100), 0, 100, 1, 0.01,
      (next, value) => { next.appearance.opacity = value; },
      (current) => Math.round(current.appearance.opacity * 100),
    );
    addField(rotation, '不透明度（百分比）', opacity);
    addField(rotation, '显示前景图', toggleControl(settings.appearance.visible, (value) => update((next) => {
      next.appearance.visible = value;
    }, true)));
    addField(rotation, '混合模式', selectInput(
      settings.appearance.mixBlendMode,
      mixBlendModes,
      (next, value) => { next.appearance.mixBlendMode = value; },
      (current) => current.appearance.mixBlendMode,
    ));
    addField(rotation, '图片填充', selectInput(
      settings.appearance.objectFit,
      objectFits,
      (next, value) => { next.appearance.objectFit = value; },
      (current) => current.appearance.objectFit,
    ));
    panel.appendChild(rotation);

    const pure = section('纯享模式');
    addField(pure, '空闲自动进入', toggleControl(settings.pureMode.autoEnter, (value) => update((next) => {
      next.pureMode.autoEnter = value;
    }, true)));
    const idle = numericInput(
      Math.round(settings.pureMode.idleMs / 1000), 5, 600, 1, 1000,
      (next, value) => { next.pureMode.idleMs = value; },
      (current) => Math.round(current.pureMode.idleMs / 1000),
    );
    addField(pure, '空闲时间（秒）', idle); panel.appendChild(pure);

    const keys = section('快捷键');
    const labels: Record<string, string> = {
      openSettings: '打开设置', next: '下一张', previous: '上一张', toggleVisible: '显示/隐藏',
      blurUp: '增加模糊', blurDown: '减少模糊', opacityUp: '增加不透明度', opacityDown: '减少不透明度',
      copyPath: '复制路径', previewOriginal: '查看原图', togglePureMode: '切换纯享模式',
    };
    for (const [action, label] of Object.entries(labels)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'pixiv-settings-shortcut';
      button.textContent = recordingAction === action ? '请按键…' : shortcutLabel(settings.shortcuts[action]!);
      button.onclick = () => { recordingAction = action; render(); showMessage(`正在录入：${label}`); };
      addField(keys, label, button);
    }
    panel.appendChild(keys);
    const footer = document.createElement('div'); footer.className = 'pixiv-settings-footer';
    message = document.createElement('div'); message.className = 'pixiv-settings-message';
    message.textContent = messageText;
    message.dataset.error = messageError ? 'true' : 'false';
    message.style.opacity = messageText ? '1' : '0';
    footer.appendChild(message);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '恢复默认'; reset.onclick = () => { settings = clone(defaults); publish(); render(); showMessage('已恢复默认设置'); };
    footer.appendChild(reset); panel.appendChild(footer);
  }

  function setOpen(value: boolean) {
    if (value === open) return;
    if (value) opener = document.activeElement as HTMLElement | null;
    open = value;
    if (!panel) return;
    panel.style.display = open ? 'block' : 'none';
    if (open) { recordingAction = undefined; render(); panel.querySelector<HTMLElement>('button')?.focus(); }
    else opener?.focus();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (recordingAction && panel && open) {
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        recordingAction = undefined; render(); showMessage('已取消快捷键录入');
        return;
      }
      if (event.isComposing || ['Meta', 'Control', 'Alt', 'Shift'].includes(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.metaKey && event.ctrlKey) { showMessage('Primary 修饰键请只按 ⌘ 或 Ctrl', true); return; }
      const shortcut: Shortcut = {
        code: event.code, primary: event.metaKey || event.ctrlKey, alt: event.altKey, shift: event.shiftKey,
      };
      const conflict = Object.entries(settings.shortcuts).find(([action, value]) => action !== recordingAction &&
        value.code === shortcut.code && value.primary === shortcut.primary && value.alt === shortcut.alt && value.shift === shortcut.shift);
      if (conflict) { showMessage(`与“${conflict[0]}”冲突`, true); return; }
      const action = recordingAction;
      recordingAction = undefined;
      update((next) => { next.shortcuts[action] = shortcut; }, true);
      showMessage('快捷键已更新');
      return;
    }
    if (event.code === 'Escape' && open) { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); return; }
    if (shortcutMatches(event, settings.shortcuts.openSettings!)) {
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(!open);
    }
  }

  function onWheel(event: WheelEvent) {
    if (!recordingAction || !open || (recordingAction !== 'opacityUp' && recordingAction !== 'opacityDown')) return;
    if (event.deltaY === 0 || event.shiftKey || event.metaKey === event.ctrlKey || !event.altKey) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const action = recordingAction;
    recordingAction = undefined;
    update((next) => {
      next.shortcuts[action] = {
        code: event.deltaY < 0 ? 'WheelUp' : 'WheelDown',
        primary: true,
        alt: true,
        shift: false,
      };
    }, true);
    showMessage('快捷键已更新');
  }

  panel = document.createElement('div');
  panel.id = '__pixiv_settings_panel__';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '注入设置');
  panel.setAttribute('aria-modal', 'true');
  panel.className = 'pixiv-settings-panel';
  panel.style.display = 'none';
  document.documentElement.appendChild(panel);
  render(); setOpen(false);
  state.__pixivOpenSettings__ = () => setOpen(!open);
  state.__pixivSettingsPanelOpen__ = () => open;
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('wheel', onWheel, true);
  return settings;
}
