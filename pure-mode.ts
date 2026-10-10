// Serialized into an isolated page world; keep this function self-contained.
export function installPureMode() {
  type Shortcut = { code: string; primary: boolean; alt: boolean; shift: boolean };
  type Settings = { pureMode: { autoEnter: boolean; idleMs: number }; shortcuts: Record<string, Shortcut> };
  const state = window as typeof window & {
    __codexPureModeCleanup__?: () => void;
    __pixivShowStatus__?: (message: string) => void;
    __pixivInjectSettings__?: Settings;
    __pixivSubscribeSettings__?: (subscriber: (settings: Settings) => void) => () => void;
    __pixivSettingsPanelOpen__?: () => boolean;
  };

  state.__codexPureModeCleanup__?.();

  const root = document.documentElement;

  let stopped = false;
  let pureModeActive = false;
  let toggleKeysDown = new Set<string>();
  let idleDurationMs = state.__pixivInjectSettings__?.pureMode.idleMs ?? 30_000;
  let autoEnter = state.__pixivInjectSettings__?.pureMode.autoEnter ?? true;
  let toggleShortcut = state.__pixivInjectSettings__?.shortcuts.togglePureMode ?? {
    code: 'F4', primary: false, alt: false, shift: false,
  };
  let unsubscribeSettings: (() => void) | undefined;
  let idleTimer: number | undefined;
  let f4TapTimer: number | undefined;
  let reconcileTimer: number | undefined;
  let observer: MutationObserver | undefined;

  const eventOptions = { capture: true } as const;
  const activityEvents = [
    'mousemove',
    'mousedown',
    'mouseup',
    'pointermove',
    'pointerdown',
    'wheel',
    'touchstart',
    'keydown',
    'keyup',
  ] as const;

  function clearIdleTimer() {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function clearReconcileTimer() {
    window.clearTimeout(reconcileTimer);
    reconcileTimer = undefined;
  }

  function clearF4TapTimer() {
    window.clearTimeout(f4TapTimer);
    f4TapTimer = undefined;
  }

  function findConversation() {
    return document.querySelector<HTMLElement>('[data-thread-find-target="conversation"]');
  }

  function isPureModeVisible() {
    return pureModeActive && toggleKeysDown.size === 0;
  }

  function reconcileMode() {
    if (stopped || !isPureModeVisible()) return;
    const conversation = findConversation();
    if (!conversation) {
      leavePureMode();
      restartIdleTimer();
      return;
    }
  }

  function scheduleReconcile() {
    if (stopped || !isPureModeVisible() || reconcileTimer !== undefined) return;
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = undefined;
      reconcileMode();
    }, 0);
  }

  function enterPureMode() {
    if (stopped || pureModeActive || !findConversation()) return;
    pureModeActive = true;
    updatePureModeVisibility();
  }

  function leavePureMode() {
    if (stopped || !pureModeActive) return;
    pureModeActive = false;
    clearReconcileTimer();
    document.body?.classList.remove('_pure-mode_');
  }

  function updatePureModeVisibility() {
    if (stopped) return;
    if (!isPureModeVisible()) {
      clearReconcileTimer();
      document.body?.classList.remove('_pure-mode_');
      return;
    }
    document.body?.classList.add('_pure-mode_');
    reconcileMode();
  }

  function restartIdleTimer() {
    clearIdleTimer();
    if (stopped || pureModeActive || !autoEnter) return;
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined;
      if (pureModeActive) return;
      if (!findConversation()) {
        restartIdleTimer();
        return;
      }
      enterPureMode();
    }, idleDurationMs);
  }

  function onActivity() {
    if (stopped) return;
    restartIdleTimer();
  }

  function matchesToggleShortcut(event: KeyboardEvent) {
    return (
      event.code === toggleShortcut.code &&
      event.altKey === toggleShortcut.alt &&
      event.shiftKey === toggleShortcut.shift &&
      (toggleShortcut.primary
        ? event.metaKey !== event.ctrlKey
        : !event.metaKey && !event.ctrlKey) &&
      !event.isComposing
    );
  }

  function togglePureMode() {
    if (pureModeActive) {
      leavePureMode();
      restartIdleTimer();
    } else {
      clearIdleTimer();
      enterPureMode();
    }
    state.__pixivShowStatus__?.(`纯享模式${pureModeActive ? '已开启' : '已关闭'}`);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (state.__pixivSettingsPanelOpen__?.()) return;
    if (matchesToggleShortcut(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || toggleKeysDown.has(event.code)) return;

      toggleKeysDown.add(event.code);
      if (f4TapTimer !== undefined) {
        clearF4TapTimer();
        togglePureMode();
      } else {
        f4TapTimer = window.setTimeout(() => {
          f4TapTimer = undefined;
        }, 300);
        if (pureModeActive) {
          updatePureModeVisibility();
        } else {
          onActivity();
        }
      }
      return;
    }
    onActivity();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (toggleKeysDown.has(event.code)) {
      const wasTracked = toggleKeysDown.delete(event.code);
      if (wasTracked) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
      if (pureModeActive && wasTracked && toggleKeysDown.size === 0) {
        updatePureModeVisibility();
      } else if (!pureModeActive) {
        onActivity();
      }
      return;
    }
    if (state.__pixivSettingsPanelOpen__?.()) return;
    onActivity();
  }

  function cleanup() {
    stopped = true;
    unsubscribeSettings?.();
    unsubscribeSettings = undefined;
    clearIdleTimer();
    clearF4TapTimer();
    clearReconcileTimer();
    observer?.disconnect();
    observer = undefined;
    toggleKeysDown.clear();
    const activityHandler = onActivity as EventListener;
    const keyDownHandler = onKeyDown as EventListener;
    const keyUpHandler = onKeyUp as EventListener;
    for (const eventName of activityEvents) {
      const handler = eventName === 'keydown' ? keyDownHandler :
        eventName === 'keyup' ? keyUpHandler : activityHandler;
      window.removeEventListener(eventName, handler, eventOptions);
    }
    document.body?.classList.remove('_pure-mode_');
    if (state.__codexPureModeCleanup__ === cleanup) {
      delete state.__codexPureModeCleanup__;
    }
  }

  state.__codexPureModeCleanup__ = cleanup;

  const activityHandler = onActivity as EventListener;
  const keyDownHandler = onKeyDown as EventListener;
  const keyUpHandler = onKeyUp as EventListener;
  for (const eventName of activityEvents) {
    const handler = eventName === 'keydown' ? keyDownHandler :
      eventName === 'keyup' ? keyUpHandler : activityHandler;
    window.addEventListener(eventName, handler, eventOptions);
  }

  unsubscribeSettings = state.__pixivSubscribeSettings__?.((settings) => {
    const idleChanged = idleDurationMs !== settings.pureMode.idleMs;
    const autoChanged = autoEnter !== settings.pureMode.autoEnter;
    idleDurationMs = settings.pureMode.idleMs;
    autoEnter = settings.pureMode.autoEnter;
    toggleShortcut = settings.shortcuts.togglePureMode ?? toggleShortcut;
    if (idleChanged || autoChanged) {
      if (autoEnter) restartIdleTimer();
      else clearIdleTimer();
    }
  });

  if (typeof MutationObserver !== 'undefined' && root) {
    observer = new MutationObserver(scheduleReconcile);
    observer.observe(root, { childList: true, subtree: true });
  }

  restartIdleTimer();
  return true;
}
