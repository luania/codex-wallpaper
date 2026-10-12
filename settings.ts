export type InjectShortcut = {
  code: string;
  primary: boolean;
  alt: boolean;
  shift: boolean;
};

export type InjectMixBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type InjectObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

export type InjectSettings = {
  rotation: {
    enabled: boolean;
    intervalMs: number;
    fadeDurationMs: number;
  };
  appearance: {
    blurPx: number;
    opacity: number;
    visible: boolean;
    mixBlendMode: InjectMixBlendMode;
    objectFit: InjectObjectFit;
  };
  pureMode: {
    autoEnter: boolean;
    idleMs: number;
  };
  shortcuts: Record<string, InjectShortcut>;
};

export const INJECT_SETTINGS_STORAGE_KEY = '__pixiv_inject_settings_v1__';

export type InjectSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const DEFAULT_INJECT_SETTINGS: InjectSettings = {
  rotation: {
    enabled: true,
    intervalMs: 5 * 60_000,
    fadeDurationMs: 1_000,
  },
  appearance: {
    blurPx: 0,
    opacity: 0.33,
    visible: true,
    mixBlendMode: 'screen',
    objectFit: 'cover',
  },
  pureMode: {
    autoEnter: true,
    idleMs: 30_000,
  },
  shortcuts: {
    openSettings: { code: 'Comma', primary: true, alt: true, shift: false },
    next: { code: 'ArrowRight', primary: true, alt: true, shift: false },
    previous: { code: 'ArrowLeft', primary: true, alt: true, shift: false },
    toggleVisible: { code: 'Space', primary: true, alt: true, shift: false },
    blurUp: { code: 'ArrowUp', primary: true, alt: true, shift: false },
    blurDown: { code: 'ArrowDown', primary: true, alt: true, shift: false },
    opacityUp: { code: 'WheelUp', primary: true, alt: true, shift: false },
    opacityDown: { code: 'WheelDown', primary: true, alt: true, shift: false },
    copyPath: { code: 'KeyC', primary: true, alt: true, shift: false },
    previewOriginal: { code: 'F5', primary: false, alt: false, shift: false },
    togglePureMode: { code: 'F4', primary: false, alt: false, shift: false },
  },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

const MIX_BLEND_MODES: readonly InjectMixBlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity',
];
const OBJECT_FITS: readonly InjectObjectFit[] = ['fill', 'contain', 'cover', 'none', 'scale-down'];

function normalizeShortcut(value: unknown, fallback: InjectShortcut): InjectShortcut {
  if (!isRecord(value) || typeof value.code !== 'string' || value.code.length === 0) {
    return { ...fallback };
  }
  return {
    code: value.code.slice(0, 64),
    primary: readBoolean(value.primary, fallback.primary),
    alt: readBoolean(value.alt, fallback.alt),
    shift: readBoolean(value.shift, fallback.shift),
  };
}

export function normalizeInjectSettings(value: unknown): InjectSettings {
  const source = isRecord(value) ? value : {};
  const rotation = isRecord(source.rotation) ? source.rotation : {};
  const appearance = isRecord(source.appearance) ? source.appearance : {};
  const pureMode = isRecord(source.pureMode) ? source.pureMode : {};
  const shortcuts = isRecord(source.shortcuts) ? source.shortcuts : {};

  const normalized: InjectSettings = {
    rotation: {
      enabled: readBoolean(rotation.enabled, DEFAULT_INJECT_SETTINGS.rotation.enabled),
      intervalMs: readNumber(rotation.intervalMs, DEFAULT_INJECT_SETTINGS.rotation.intervalMs, 10_000, 3_600_000),
      fadeDurationMs: readNumber(rotation.fadeDurationMs, DEFAULT_INJECT_SETTINGS.rotation.fadeDurationMs, 0, 5_000),
    },
    appearance: {
      blurPx: readNumber(appearance.blurPx, DEFAULT_INJECT_SETTINGS.appearance.blurPx, 0, 500),
      opacity: readNumber(appearance.opacity, DEFAULT_INJECT_SETTINGS.appearance.opacity, 0, 1),
      visible: readBoolean(appearance.visible, DEFAULT_INJECT_SETTINGS.appearance.visible),
      mixBlendMode: readEnum(appearance.mixBlendMode, MIX_BLEND_MODES, DEFAULT_INJECT_SETTINGS.appearance.mixBlendMode),
      objectFit: readEnum(appearance.objectFit, OBJECT_FITS, DEFAULT_INJECT_SETTINGS.appearance.objectFit),
    },
    pureMode: {
      autoEnter: readBoolean(pureMode.autoEnter, DEFAULT_INJECT_SETTINGS.pureMode.autoEnter),
      idleMs: readNumber(pureMode.idleMs, DEFAULT_INJECT_SETTINGS.pureMode.idleMs, 5_000, 600_000),
    },
    shortcuts: {},
  };

  for (const [action, fallback] of Object.entries(DEFAULT_INJECT_SETTINGS.shortcuts)) {
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
    normalized.shortcuts[action] = shortcut;
  }
  return normalized;
}

export function loadInjectSettings(storage: InjectSettingsStorage): InjectSettings {
  try {
    const value = storage.getItem(INJECT_SETTINGS_STORAGE_KEY);
    return value ? normalizeInjectSettings(JSON.parse(value)) : normalizeInjectSettings(DEFAULT_INJECT_SETTINGS);
  } catch {
    return normalizeInjectSettings(DEFAULT_INJECT_SETTINGS);
  }
}

export function saveInjectSettings(storage: InjectSettingsStorage, value: unknown): InjectSettings {
  const settings = normalizeInjectSettings(value);
  try {
    storage.setItem(INJECT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return settings;
}
