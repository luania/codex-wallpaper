// Serialized into an isolated page world: keep all runtime dependencies inside this function.
export async function installPixivBackground(
  inputId: string,
  metadata: Array<{ path: string; orientation?: 'landscape' | 'portrait' }>,
) {
  const intervalMs = 60_000;
  const loadTimeoutMs = 15_000;
  const fadeDurationMs = 1000;
  const statusDurationMs = 1_500;
  const maxHistoryEntries = 1 + 20;
  type Orientation = 'landscape' | 'portrait';
  type BackgroundImage = {
    file: File;
    path: string;
    orientation: Orientation | undefined;
    url: string | undefined;
  };
  const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg']);
  const state = window as typeof window & {
    __pixivBackgroundCleanup__?: () => void;
    __pixivShowStatus__?: (message: string) => void;
  };
  state.__pixivBackgroundCleanup__?.();
  document.getElementById('__my_overlay__')?.remove();

  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
    throw new Error('找不到已选择图片目录的 file input');
  }
  const fileInput = input;
  const metadataByPath = new Map(metadata.map((image) => [image.path, image.orientation]));
  const files = Array.from(fileInput.files ?? [])
    .filter((file) => supportedExtensions.has(`.${file.name.split('.').pop()?.toLowerCase() ?? ''}`))
    .map((file) => {
      const path = file.webkitRelativePath || file.name;
      const relativePath = path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
      return {
        file,
        path,
        url: undefined,
        orientation: metadataByPath.get(path) ?? metadataByPath.get(relativePath),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
  if (files.length === 0) {
    fileInput.remove();
    throw new Error('所选目录中没有支持的图片');
  }
  const images: BackgroundImage[] = files;

  let stopped = false;
  let timer: number | undefined;
  let foregroundVisible = true;
  let blurPx = 0;
  let overlayOpacity = 0.2;
  let overlay: HTMLImageElement | undefined;
  let overlayImage: BackgroundImage | undefined;
  let overlayPath: string | undefined;
  let status: HTMLDivElement | undefined;
  let statusTimer: number | undefined;
  let progressBar: HTMLDivElement | undefined;
  let progressFill: HTMLDivElement | undefined;
  let progressTimer: number | undefined;
  let rotationController: AbortController | undefined;
  const timeline: BackgroundImage[] = [];
  let timelineIndex = -1;
  let lastWindowOrientation = getWindowOrientation();
  const pendingLoads = new Set<() => void>();
  const fadingOverlays = new Set<HTMLImageElement>();
  const fadeTimers = new Set<number>();
  const objectUrls = new Set<string>();
  const imagesByOrientation: Record<Orientation, BackgroundImage[]> = { landscape: [], portrait: [] };
  const imageOrder = new Map(images.map((image, index) => [image, index]));
  const unknownImages = images.filter((image) => !image.orientation);

  for (const image of images) {
    if (image.orientation) imagesByOrientation[image.orientation].push(image);
  }

  function cleanup() {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('resize', onResize);
    rotationController?.abort();
    window.clearTimeout(statusTimer);
    statusTimer = undefined;
    window.clearTimeout(progressTimer);
    progressTimer = undefined;
    for (const cancel of pendingLoads) cancel();
    for (const fadingOverlay of fadingOverlays) fadingOverlay.remove();
    fadingOverlays.clear();
    for (const fadeTimer of fadeTimers) window.clearTimeout(fadeTimer);
    fadeTimers.clear();
    overlay?.remove();
    status?.remove();
    progressBar?.remove();
    status = undefined;
    progressBar = undefined;
    progressFill = undefined;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    fileInput.remove();
    if (state.__pixivShowStatus__ === showStatus) {
      delete state.__pixivShowStatus__;
    }
    if (state.__pixivBackgroundCleanup__ === cleanup) {
      delete state.__pixivBackgroundCleanup__;
    }
  }
  state.__pixivBackgroundCleanup__ = cleanup;

  function releaseImageUrl(image: BackgroundImage) {
    if (!image.url) return;
    URL.revokeObjectURL(image.url);
    objectUrls.delete(image.url);
    image.url = undefined;
  }

  function removeFromPool(pool: BackgroundImage[], image: BackgroundImage) {
    const index = pool.indexOf(image);
    if (index >= 0) pool.splice(index, 1);
  }

  function removeImageFromPools(image: BackgroundImage) {
    removeFromPool(imagesByOrientation.landscape, image);
    removeFromPool(imagesByOrientation.portrait, image);
    removeFromPool(unknownImages, image);
  }

  function setImageOrientation(image: BackgroundImage, orientation: Orientation) {
    removeImageFromPools(image);
    image.orientation = orientation;
    const pool = imagesByOrientation[orientation];
    const index = imageOrder.get(image)!;
    const insertAt = pool.findIndex((candidate) => imageOrder.get(candidate)! > index);
    if (insertAt < 0) pool.push(image);
    else pool.splice(insertAt, 0, image);
  }

  function candidatesForWindow(): BackgroundImage[] {
    const orientation = getWindowOrientation();
    const preferred = imagesByOrientation[orientation];
    const fallback = imagesByOrientation[orientation === 'landscape' ? 'portrait' : 'landscape'];
    if (preferred.length > 0) return unknownImages.length > 0
      ? [...preferred, ...unknownImages]
      : preferred;
    if (unknownImages.length > 0) return [...unknownImages, ...fallback];
    return fallback;
  }

  function getImageUrl(image: BackgroundImage) {
    if (!image.url) {
      image.url = URL.createObjectURL(image.file);
      objectUrls.add(image.url);
    }
    return image.url;
  }

  function getWindowOrientation(): Orientation {
    return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  }

  function imageOrientation(image: HTMLImageElement): Orientation {
    return image.naturalWidth >= image.naturalHeight ? 'landscape' : 'portrait';
  }

  function showStatus(message: string) {
    if (!status) return;
    window.clearTimeout(statusTimer);
    statusTimer = undefined;
    status.textContent = message;
    status.style.opacity = '1';
    statusTimer = window.setTimeout(() => {
      statusTimer = undefined;
      if (status) status.style.opacity = '0';
    }, statusDurationMs);
  }
  state.__pixivShowStatus__ = showStatus;

  function copyWithTextarea(text: string): Promise<void> {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    Object.assign(input.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(input);
    input.select();
    let copied = false;
    try {
      copied = document.execCommand?.('copy') ?? false;
    } finally {
      input.remove();
    }
    return copied ? Promise.resolve() : Promise.reject(new Error('剪贴板不可用'));
  }

  function copyText(text: string): Promise<void> {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard?.writeText) return clipboard.writeText(text).catch(() => copyWithTextarea(text));
    return copyWithTextarea(text);
  }

  function copyCurrentImagePath() {
    if (!overlayPath) {
      showStatus('暂无图片路径');
      return;
    }
    void copyText(overlayPath).then(
      () => showStatus('已复制'),
      () => showStatus('复制失败'),
    );
  }

  function discardForwardHistory() {
    if (timelineIndex < 0 || timelineIndex >= timeline.length - 1) return;
    timeline.splice(timelineIndex + 1);
  }

  function recordDisplayedImage(image: BackgroundImage) {
    discardForwardHistory();
    timeline.push(image);
    if (timeline.length > maxHistoryEntries) timeline.shift();
    timelineIndex = timeline.length - 1;
  }

  function findPreviousHistoryIndex() {
    const candidates = new Set(candidatesForWindow());
    for (let index = timelineIndex - 1; index >= 0; index--) {
      const image = timeline[index];
      if (image && candidates.has(image)) return index;
    }
    return -1;
  }

  function findNextHistoryIndex() {
    const candidates = new Set(candidatesForWindow());
    for (let index = timelineIndex + 1; index < timeline.length; index++) {
      const image = timeline[index];
      if (image && candidates.has(image)) return index;
    }
    return -1;
  }

  function loadImage(source: BackgroundImage, signal?: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const cancel = () => finish(new Error('图片加载已取消'));
      const timeout = window.setTimeout(() => finish(new Error('图片加载超时（15 秒）')), loadTimeoutMs);

      function finish(error?: unknown) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        pendingLoads.delete(cancel);
        signal?.removeEventListener('abort', cancel);
        if (error) {
          image.removeAttribute('src');
          releaseImageUrl(source);
          reject(error);
        } else {
          resolve(image);
        }
      }

      pendingLoads.add(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      if (stopped || signal?.aborted) {
        cancel();
        return;
      }
      image.decoding = 'async';
      image.src = getImageUrl(source);
      void image.decode().then(() => {
        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
          finish(new Error('图片尺寸无效'));
        } else {
          finish();
        }
      }, (error: unknown) => finish(error));
    });
  }

  async function showImage(
    image: BackgroundImage,
    controller: AbortController,
    historyIndex?: number,
  ): Promise<'shown' | 'skipped' | 'aborted'> {
    let next: HTMLImageElement;
    try {
      next = await loadImage(image, controller.signal);
    } catch (error) {
      if (stopped || controller.signal.aborted) return 'aborted';
      console.warn('[Pixiv 背景] 跳过无法加载的图片', image.path, error);
      removeImageFromPools(image);
      return 'skipped';
    }
    if (stopped || controller.signal.aborted) {
      next.remove();
      releaseImageUrl(image);
      return 'aborted';
    }

    // Metadata is fast for normal files; verify only files whose metadata was unavailable.
    const actualOrientation = imageOrientation(next);
    if (image.orientation !== actualOrientation) setImageOrientation(image, actualOrientation);
    // Recheck the latest viewport even if its resize event has not been delivered yet.
    if (!candidatesForWindow().includes(image)) {
      next.remove();
      releaseImageUrl(image);
      return 'skipped';
    }

    next.id = '__my_overlay__';
    next.alt = '';
    next.setAttribute('aria-hidden', 'true');
    Object.assign(next.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      objectFit: 'cover',
      objectPosition: 'center',
      opacity: String(overlayOpacity),
      filter: `blur(${blurPx}px)`,
      transition: `opacity ${fadeDurationMs}ms ease`,
      mixBlendMode: 'screen',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });
    next.style.display = foregroundVisible ? '' : 'none';
    next.style.opacity = '0';
    document.documentElement.appendChild(next);
    const previous = overlay;
    const previousImage = overlayImage;
    overlay = next;
    overlayImage = image;
    overlayPath = image.path;
    if (historyIndex === undefined) recordDisplayedImage(image);
    else timelineIndex = historyIndex;
    window.requestAnimationFrame(() => {
      if (stopped) return;
      next.style.opacity = String(overlayOpacity);
      if (!previous) return;
      fadingOverlays.add(previous);
      previous.style.transition = `opacity ${fadeDurationMs}ms ease`;
      previous.style.opacity = '0';
      const fadeTimer = window.setTimeout(() => {
        previous.remove();
        if (previousImage && previousImage !== overlayImage) releaseImageUrl(previousImage);
        fadingOverlays.delete(previous);
        fadeTimers.delete(fadeTimer);
      }, fadeDurationMs);
      fadeTimers.add(fadeTimer);
    });
    return 'shown';
  }

  async function showNext(controller: AbortController) {
    while (!stopped && !controller.signal.aborted) {
      const candidates = candidatesForWindow();
      if (candidates.length === 0) {
        throw new Error('所有背景图片均无法加载或无法确定尺寸');
      }
      if (candidates.length === 1 && candidates[0] === overlayImage) return;

      const alternatives = candidates.filter((image) => image !== overlayImage);
      const image = alternatives[Math.floor(Math.random() * alternatives.length)]!;
      const result = await showImage(image, controller);
      if (result === 'shown' || result === 'aborted') return;
    }
  }

  async function showPrevious(controller: AbortController) {
    while (!stopped && !controller.signal.aborted) {
      const index = findPreviousHistoryIndex();
      if (index < 0) {
        showStatus('没有更多历史图片');
        return;
      }
      const result = await showImage(timeline[index]!, controller, index);
      if (result === 'shown' || result === 'aborted') return;
      timeline.splice(index, 1);
      if (timelineIndex >= index) timelineIndex--;
    }
  }

  async function showNextHistory(controller: AbortController) {
    while (!stopped && !controller.signal.aborted) {
      const index = findNextHistoryIndex();
      if (index < 0) {
        showStatus('已经是最新图片');
        return;
      }
      const result = await showImage(timeline[index]!, controller, index);
      if (result === 'shown' || result === 'aborted') return;
      timeline.splice(index, 1);
    }
  }

  function restartTimer() {
    window.clearTimeout(timer);
    timer = undefined;
    window.clearTimeout(progressTimer);
    progressTimer = undefined;
    const canRotate = !stopped && candidatesForWindow().length >= 2;
    if (progressFill) progressFill.style.width = '0%';
    if (progressBar) progressBar.style.display = canRotate ? '' : 'none';
    if (!canRotate) return;

    const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
    const startedAt = now();
    function updateProgress() {
      progressTimer = undefined;
      if (stopped || !progressFill) return;
      // Derive progress from elapsed time so delayed callbacks catch up without drift.
      const elapsed = Math.min(intervalMs, Math.max(0, now() - startedAt));
      progressFill.style.width = `${elapsed / intervalMs * 100}%`;
      if (elapsed < intervalMs) {
        progressTimer = window.setTimeout(updateProgress, Math.min(50, intervalMs - elapsed));
      }
    }
    progressTimer = window.setTimeout(updateProgress, 50);
    timer = window.setTimeout(() => {
      timer = undefined;
      if (progressFill) progressFill.style.width = '100%';
      void rotate().catch((error) => console.error('[Pixiv 背景]', error));
    }, intervalMs);
  }

  function rotate(): Promise<void> {
    if (stopped) return Promise.resolve();
    discardForwardHistory();
    window.clearTimeout(timer);
    timer = undefined;
    window.clearTimeout(progressTimer);
    progressTimer = undefined;
    rotationController?.abort();
    const controller = new AbortController();
    rotationController = controller;
    const rotation = showNext(controller).finally(() => {
      if (rotationController === controller) {
        rotationController = undefined;
        restartTimer();
      }
    });
    return rotation;
  }

  function goToPrevious(): Promise<void> {
    if (stopped || rotationController) return Promise.resolve();
    window.clearTimeout(timer);
    timer = undefined;
    window.clearTimeout(progressTimer);
    progressTimer = undefined;
    const controller = new AbortController();
    rotationController = controller;
    const rotation = showPrevious(controller).finally(() => {
      if (rotationController === controller) {
        rotationController = undefined;
        restartTimer();
      }
    });
    return rotation;
  }

  function goToNext(): Promise<void> {
    if (stopped || rotationController) return Promise.resolve();
    if (timelineIndex >= timeline.length - 1) {
      if (candidatesForWindow().length < 2) return Promise.resolve();
      return rotate();
    }
    window.clearTimeout(timer);
    timer = undefined;
    window.clearTimeout(progressTimer);
    progressTimer = undefined;
    const controller = new AbortController();
    rotationController = controller;
    const rotation = showNextHistory(controller).finally(() => {
      if (rotationController === controller) {
        rotationController = undefined;
        restartTimer();
      }
    });
    return rotation;
  }

  function onResize() {
    const orientation = getWindowOrientation();
    if (stopped || orientation === lastWindowOrientation) return;
    lastWindowOrientation = orientation;
    // Cancel an in-flight switch immediately instead of waiting for its decode/timeout.
    void rotate().catch((error) => console.error('[Pixiv 背景]', error));
  }

  function onWheel(event: WheelEvent) {
    if (
      stopped || !event.altKey || event.metaKey === event.ctrlKey ||
      event.shiftKey || event.deltaY === 0
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    overlayOpacity = Math.min(1, Math.max(0, overlayOpacity + (event.deltaY < 0 ? 0.01 : -0.01)));
    if (overlay) overlay.style.opacity = String(overlayOpacity);
    showStatus(`不透明度 ${Math.round(overlayOpacity * 100)}%`);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (stopped || !event.altKey || event.metaKey === event.ctrlKey || event.shiftKey || event.isComposing) return;
    if (event.code === 'KeyC') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) copyCurrentImagePath();
      return;
    }
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      blurPx = Math.max(0, blurPx + (event.code === 'ArrowUp' ? 1 : -1));
      if (overlay) overlay.style.filter = `blur(${blurPx}px)`;
      showStatus(`模糊 ${blurPx}px`);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        foregroundVisible = !foregroundVisible;
        if (overlay) overlay.style.display = foregroundVisible ? '' : 'none';
      }
      return;
    }
    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void goToPrevious().catch((error) => console.error('[Pixiv 背景]', error));
      return;
    }
    if (event.code !== 'ArrowRight') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || rotationController) return;
    void goToNext().catch((error) => console.error('[Pixiv 背景]', error));
  }

  try {
    status = document.createElement('div');
    status.id = '__my_status__';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483640',
      maxWidth: 'calc(100vw - 32px)',
      padding: '8px 12px',
      borderRadius: '8px',
      background: 'rgba(0, 0, 0, 0.72)',
      color: '#fff',
      font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 160ms ease',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(status);
    progressBar = document.createElement('div');
    progressBar.id = '__my_progress__';
    progressBar.setAttribute('aria-hidden', 'true');
    Object.assign(progressBar.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '100vw',
      height: '5px',
      zIndex: '2147483647',
      overflow: 'hidden',
      pointerEvents: 'none',
      display: 'none',
    });
    progressFill = document.createElement('div');
    Object.assign(progressFill.style, {
      width: '0%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.3)',
      transition: 'none',
    });
    progressBar.appendChild(progressFill);
    document.documentElement.appendChild(progressBar);
    if (stopped) return;
    if (candidatesForWindow().length === 0) {
      throw new Error('所有背景图片均无法加载或无法确定尺寸');
    }
    lastWindowOrientation = getWindowOrientation();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('resize', onResize);
    await rotate();
    return images.length;
  } catch (error) {
    cleanup();
    throw error;
  }
}
