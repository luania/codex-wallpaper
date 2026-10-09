// Serialized into an isolated page world; keep this function self-contained.
export function installPureMode() {
  const idleDurationMs = 30_000;
  const state = window as typeof window & {
    __codexPureModeCleanup__?: () => void;
    __pixivShowStatus__?: (message: string) => void;
  };

  state.__codexPureModeCleanup__?.();

  const root = document.documentElement;

  let stopped = false;
  let pureModeActive = false;
  let f4KeysDown = new Set<string>();
  let idleTimer: number | undefined;
  let reconcileTimer: number | undefined;
  let shortcutKeyUps = new Set<string>();
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

  function findConversation() {
    return document.querySelector<HTMLElement>('[data-thread-find-target="conversation"]');
  }

  function isPureModeVisible() {
    return pureModeActive && f4KeysDown.size === 0;
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
    if (stopped || pureModeActive) return;
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

  function isToggleShortcut(event: KeyboardEvent) {
    return (
      event.code === 'KeyP' &&
      event.altKey &&
      !event.shiftKey &&
      event.metaKey !== event.ctrlKey &&
      !event.isComposing &&
      !event.repeat
    );
  }

  function isAltKey(event: KeyboardEvent) {
    return event.code === 'AltLeft' || event.code === 'AltRight';
  }

  function isStandaloneF4Key(event: KeyboardEvent) {
    return (
      event.code === 'F4' &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.isComposing
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isStandaloneF4Key(event) && !event.repeat) {
      f4KeysDown.add(event.code);
      if (pureModeActive) {
        updatePureModeVisibility();
      } else {
        onActivity();
      }
      return;
    }
    if (isToggleShortcut(event)) {
      f4KeysDown.clear();
      shortcutKeyUps = new Set(['KeyP']);
      if (event.altKey) {
        shortcutKeyUps.add('AltLeft');
        shortcutKeyUps.add('AltRight');
      }
      if (event.metaKey) {
        shortcutKeyUps.add('MetaLeft');
        shortcutKeyUps.add('MetaRight');
      }
      if (event.ctrlKey) {
        shortcutKeyUps.add('ControlLeft');
        shortcutKeyUps.add('ControlRight');
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pureModeActive) {
        leavePureMode();
        restartIdleTimer();
      } else {
        clearIdleTimer();
        enterPureMode();
      }
      state.__pixivShowStatus__?.(`纯享模式${pureModeActive ? '已开启' : '已关闭'}`);
      return;
    }
    onActivity();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (shortcutKeyUps.has(event.code)) {
      shortcutKeyUps.delete(event.code);
      if (event.code === 'AltLeft' || event.code === 'AltRight') {
        shortcutKeyUps.delete('AltLeft');
        shortcutKeyUps.delete('AltRight');
      } else if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
        shortcutKeyUps.delete('MetaLeft');
        shortcutKeyUps.delete('MetaRight');
      } else if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
        shortcutKeyUps.delete('ControlLeft');
        shortcutKeyUps.delete('ControlRight');
      }
      return;
    }
    if (event.code === 'F4') {
      const wasTracked = f4KeysDown.delete(event.code);
      if (pureModeActive && wasTracked && f4KeysDown.size === 0) {
        updatePureModeVisibility();
      } else if (!pureModeActive) {
        onActivity();
      }
      return;
    }
    onActivity();
  }

  function cleanup() {
    stopped = true;
    clearIdleTimer();
    clearReconcileTimer();
    observer?.disconnect();
    observer = undefined;
    shortcutKeyUps.clear();
    f4KeysDown.clear();
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

  if (typeof MutationObserver !== 'undefined' && root) {
    observer = new MutationObserver(scheduleReconcile);
    observer.observe(root, { childList: true, subtree: true });
  }

  restartIdleTimer();
  return true;
}
