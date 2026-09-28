// Serialized into an isolated page world; keep this function self-contained.
export function installPureMode() {
  const idleDurationMs = 30_000;
  const mainSelector = 'main[class*="_MainContentLeftBorder_"]';
  const mainShiftProperty = '--codex-pure-mode-main-shift';
  const state = window as typeof window & {
    __codexPureModeCleanup__?: () => void;
    __pixivShowStatus__?: (message: string) => void;
  };

  state.__codexPureModeCleanup__?.();

  const root = document.documentElement;

  let stopped = false;
  let pureModeActive = false;
  let idleTimer: number | undefined;
  let reconcileTimer: number | undefined;
  let shortcutKeyUps = new Set<string>();
  let shiftedMain: HTMLElement | undefined;
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

  function findMain() {
    return document.querySelector<HTMLElement>(mainSelector);
  }

  function clearMainShift() {
    document.body?.style.removeProperty(mainShiftProperty);
    shiftedMain = undefined;
  }

  function updateMainShift() {
    if (stopped || !pureModeActive) return;
    const main = findMain();
    if (!main) {
      clearMainShift();
      return;
    }
    const rect = main.getBoundingClientRect();
    const appliedShift = shiftedMain === main ?
      Number.parseFloat(document.body?.style.getPropertyValue(mainShiftProperty) ?? '') : 0;
    const currentShift = Number.isFinite(appliedShift) ? appliedShift : 0;
    const unshiftedCenter = rect.left + rect.width / 2 - currentShift;
    const shift = window.innerWidth / 2 - unshiftedCenter;
    if (!Number.isFinite(shift)) {
      document.body?.style.removeProperty(mainShiftProperty);
      shiftedMain = undefined;
      return;
    }
    document.body?.style.setProperty(mainShiftProperty, `${shift}px`);
    shiftedMain = main;
  }

  function reconcileMode() {
    if (stopped || !pureModeActive) return;
    const conversation = findConversation();
    if (!conversation) {
      leavePureMode();
      restartIdleTimer();
      return;
    }

    updateMainShift();
  }

  function scheduleReconcile() {
    if (stopped || !pureModeActive || reconcileTimer !== undefined) return;
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = undefined;
      reconcileMode();
    }, 0);
  }

  function enterPureMode() {
    if (stopped || pureModeActive || !findConversation()) return;
    pureModeActive = true;
    document.body?.classList.add('_pure-mode_');
    reconcileMode();
  }

  function leavePureMode() {
    if (stopped || !pureModeActive) return;
    pureModeActive = false;
    clearReconcileTimer();
    clearMainShift();
    document.body?.classList.remove('_pure-mode_');
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

  function onResize() {
    updateMainShift();
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

  function onKeyDown(event: KeyboardEvent) {
    if (event.code === 'Escape' && pureModeActive && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      leavePureMode();
      restartIdleTimer();
      return;
    }
    if (isToggleShortcut(event)) {
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
    onActivity();
  }

  function cleanup() {
    stopped = true;
    clearIdleTimer();
    clearReconcileTimer();
    observer?.disconnect();
    observer = undefined;
    shortcutKeyUps.clear();
    const activityHandler = onActivity as EventListener;
    const keyDownHandler = onKeyDown as EventListener;
    const keyUpHandler = onKeyUp as EventListener;
    const resizeHandler = onResize as EventListener;
    for (const eventName of activityEvents) {
      const handler = eventName === 'keydown' ? keyDownHandler :
        eventName === 'keyup' ? keyUpHandler : activityHandler;
      window.removeEventListener(eventName, handler, eventOptions);
    }
    window.removeEventListener('resize', resizeHandler);
    document.body?.classList.remove('_pure-mode_');
    clearMainShift();
    if (state.__codexPureModeCleanup__ === cleanup) {
      delete state.__codexPureModeCleanup__;
    }
  }

  state.__codexPureModeCleanup__ = cleanup;

  const activityHandler = onActivity as EventListener;
  const keyDownHandler = onKeyDown as EventListener;
  const keyUpHandler = onKeyUp as EventListener;
  const resizeHandler = onResize as EventListener;
  for (const eventName of activityEvents) {
    const handler = eventName === 'keydown' ? keyDownHandler :
      eventName === 'keyup' ? keyUpHandler : activityHandler;
    window.addEventListener(eventName, handler, eventOptions);
  }
  window.addEventListener('resize', resizeHandler);

  if (typeof MutationObserver !== 'undefined' && root) {
    observer = new MutationObserver(scheduleReconcile);
    observer.observe(root, { childList: true, subtree: true });
  }

  restartIdleTimer();
  return true;
}
