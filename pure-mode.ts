// Serialized into an isolated page world; keep this function self-contained.
export function installPureMode() {
  const idleDurationMs = 30_000;
  const transitionDurationMs = 200;
  const modeAttribute = 'data-codex-pure-mode';
  const hiddenAttribute = 'data-codex-pure-mode-hidden';
  const styleId = '__codex_pure_mode_style__';
  const state = window as typeof window & {
    __codexPureModeCleanup__?: () => void;
    __pixivShowStatus__?: (message: string) => void;
  };

  state.__codexPureModeCleanup__?.();

  const root = document.documentElement;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [${hiddenAttribute}] {
      transition: opacity ${transitionDurationMs}ms ease;
    }
    html[${modeAttribute}="active"] [${hiddenAttribute}] {
      opacity: 0 !important;
    }
    html[${modeAttribute}="active"] main[class*="_MainContentLeftBorder_"] {
      border-left-color: transparent !important;
    }
  `;
  (document.head ?? root).appendChild(style);

  let stopped = false;
  let autoHideEnabled = true;
  let pureModeActive = false;
  let idleTimer: number | undefined;
  let reconcileTimer: number | undefined;
  let shortcutKeyUps = new Set<string>();
  let hiddenNodes = new Set<HTMLElement>();
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
  const clickEvents = ['click'] as const;

  function isExempt(element: Element) {
    return element.id === '__my_overlay__' || element.id === '__my_status__' || element.id === styleId;
  }

  function clearIdleTimer() {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function clearReconcileTimer() {
    window.clearTimeout(reconcileTimer);
    reconcileTimer = undefined;
  }

  function clearHiddenMarkers() {
    for (const element of hiddenNodes) {
      element.removeAttribute(hiddenAttribute);
    }
    hiddenNodes = new Set();
  }

  function findConversation() {
    return document.querySelector<HTMLElement>('[data-thread-find-target="conversation"]');
  }

  function reconcileHiddenNodes() {
    if (stopped || !pureModeActive) return;
    const conversation = findConversation();
    if (!conversation) {
      leavePureMode();
      restartIdleTimer();
      return;
    }

    const nextHiddenNodes = new Set<HTMLElement>();
    let current: HTMLElement | null = conversation;
    while (current) {
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== current && sibling instanceof HTMLElement && !isExempt(sibling)) {
          nextHiddenNodes.add(sibling);
        }
      }
      if (parent === document.body) break;
      current = parent;
    }

    for (const id of ['__my_progress__']) {
      const element = document.getElementById(id);
      if (element instanceof HTMLElement && !isExempt(element)) nextHiddenNodes.add(element);
    }

    for (const element of hiddenNodes) {
      if (nextHiddenNodes.has(element)) continue;
      element.removeAttribute(hiddenAttribute);
    }
    for (const element of nextHiddenNodes) {
      element.setAttribute(hiddenAttribute, '');
    }
    hiddenNodes = nextHiddenNodes;
  }

  function scheduleReconcile() {
    if (stopped || !pureModeActive || reconcileTimer !== undefined) return;
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = undefined;
      reconcileHiddenNodes();
    }, 0);
  }

  function enterPureMode() {
    if (stopped || pureModeActive || !findConversation()) return;
    pureModeActive = true;
    document.body?.classList.add('_pure-mode_');
    root.setAttribute(modeAttribute, 'active');
    reconcileHiddenNodes();
  }

  function leavePureMode() {
    if (stopped || !pureModeActive) return;
    pureModeActive = false;
    clearReconcileTimer();
    document.body?.classList.remove('_pure-mode_');
    root.removeAttribute(modeAttribute);
  }

  function restartIdleTimer() {
    clearIdleTimer();
    if (stopped || !autoHideEnabled || pureModeActive) return;
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined;
      if (!autoHideEnabled || pureModeActive) return;
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

  function onClick(event: MouseEvent) {
    if (stopped) return;
    if (event.detail > 0 && pureModeActive) leavePureMode();
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

  function onKeyDown(event: KeyboardEvent) {
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
        autoHideEnabled = false;
        leavePureMode();
        clearIdleTimer();
      } else {
        autoHideEnabled = true;
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
    const clickHandler = onClick as EventListener;
    for (const eventName of activityEvents) {
      const handler = eventName === 'keydown' ? keyDownHandler :
        eventName === 'keyup' ? keyUpHandler : activityHandler;
      window.removeEventListener(eventName, handler, eventOptions);
    }
    for (const eventName of clickEvents) {
      window.removeEventListener(eventName, clickHandler, eventOptions);
    }
    document.body?.classList.remove('_pure-mode_');
    root.removeAttribute(modeAttribute);
    clearHiddenMarkers();
    style.remove();
    if (state.__codexPureModeCleanup__ === cleanup) {
      delete state.__codexPureModeCleanup__;
    }
  }

  state.__codexPureModeCleanup__ = cleanup;

  const activityHandler = onActivity as EventListener;
  const keyDownHandler = onKeyDown as EventListener;
  const keyUpHandler = onKeyUp as EventListener;
  const clickHandler = onClick as EventListener;
  for (const eventName of activityEvents) {
    const handler = eventName === 'keydown' ? keyDownHandler :
      eventName === 'keyup' ? keyUpHandler : activityHandler;
    window.addEventListener(eventName, handler, eventOptions);
  }
  for (const eventName of clickEvents) {
    window.addEventListener(eventName, clickHandler, eventOptions);
  }

  if (typeof MutationObserver !== 'undefined' && root) {
    observer = new MutationObserver(scheduleReconcile);
    observer.observe(root, { childList: true, subtree: true });
  }

  restartIdleTimer();
  return true;
}
