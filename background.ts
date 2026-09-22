// Serialized into an isolated page world: keep all runtime dependencies inside this function.
import type { LocalImage } from './local-images.ts';

export async function installPixivBackground(images: LocalImage[]) {
  const intervalMs = 60_000;
  const loadTimeoutMs = 15_000;
  const fadeDurationMs = 500;
  type Orientation = 'landscape' | 'portrait';
  const state = window as typeof window & {
    __pixivBackgroundCleanup__?: () => void;
  };
  state.__pixivBackgroundCleanup__?.();
  document.getElementById('__my_overlay__')?.remove();

  let stopped = false;
  let timer: number | undefined;
  let foregroundVisible = true;
  let blurPx = 0;
  let overlayOpacity = 0.2;
  let overlay: HTMLImageElement | undefined;
  let overlayUrl: string | undefined;
  let rotationController: AbortController | undefined;
  let lastWindowOrientation = getWindowOrientation();
  const pendingLoads = new Set<() => void>();
  const fadingOverlays = new Set<HTMLImageElement>();
  const fadeTimers = new Set<number>();
  const imagesByOrientation: Record<Orientation, string[]> = { landscape: [], portrait: [] };
  const imageOrder = new Map(images.map((image, index) => [image.url, index]));
  const unknownImages = images.filter((image) => !image.orientation).map((image) => image.url);

  for (const image of images) {
    if (image.orientation) imagesByOrientation[image.orientation].push(image.url);
  }

  function cleanup() {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('resize', onResize);
    rotationController?.abort();
    for (const cancel of pendingLoads) cancel();
    for (const fadingOverlay of fadingOverlays) fadingOverlay.remove();
    fadingOverlays.clear();
    for (const fadeTimer of fadeTimers) window.clearTimeout(fadeTimer);
    fadeTimers.clear();
    overlay?.remove();
  }
  state.__pixivBackgroundCleanup__ = cleanup;

  function getWindowOrientation(): Orientation {
    return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  }

  function imageOrientation(image: HTMLImageElement): Orientation {
    return image.naturalWidth >= image.naturalHeight ? 'landscape' : 'portrait';
  }

  function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
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
      image.src = url;
      void image.decode().then(() => {
        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
          finish(new Error('图片尺寸无效'));
        } else {
          finish();
        }
      }, (error: unknown) => finish(error));
    });
  }

  async function classifyUnknownImages() {
    const orientations: (Orientation | undefined)[] = new Array(unknownImages.length);
    let nextIndex = 0;
    async function worker() {
      while (!stopped) {
        const index = nextIndex++;
        if (index >= unknownImages.length) return;
        const url = unknownImages[index]!;
        try {
          const image = await loadImage(url);
          orientations[index] = imageOrientation(image);
        } catch (error) {
          if (!stopped) console.warn('[Pixiv 背景] 跳过无法加载或尺寸无效的图片', url, error);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, unknownImages.length) }, () => worker()));
    orientations.forEach((orientation, index) => {
      if (orientation) imagesByOrientation[orientation].push(unknownImages[index]!);
    });
    for (const orientation of ['landscape', 'portrait'] as const) {
      imagesByOrientation[orientation].sort((a, b) => imageOrder.get(a)! - imageOrder.get(b)!);
    }
  }

  function candidatesForWindow(): string[] {
    const orientation = getWindowOrientation();
    const preferred = imagesByOrientation[orientation];
    return preferred.length > 0
      ? preferred
      : imagesByOrientation[orientation === 'landscape' ? 'portrait' : 'landscape'];
  }

  async function showNext(controller: AbortController) {
    while (!stopped && !controller.signal.aborted) {
      const candidates = candidatesForWindow();
      if (candidates.length === 0) throw new Error('所有背景图片均无法加载或无法确定尺寸');
      if (candidates.length === 1 && candidates[0] === overlayUrl) return;

      const alternatives = candidates.filter((url) => url !== overlayUrl);
      const url = alternatives[Math.floor(Math.random() * alternatives.length)]!;
      let next: HTMLImageElement;
      try {
        next = await loadImage(url, controller.signal);
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        console.warn('[Pixiv 背景] 跳过无法加载的图片', url, error);
        candidates.splice(candidates.indexOf(url), 1);
        continue;
      }
      if (stopped || controller.signal.aborted) return;

      // A file can change since classification; update its pool before displaying it.
      const actualPool = imagesByOrientation[imageOrientation(next)];
      if (actualPool !== candidates) {
        candidates.splice(candidates.indexOf(url), 1);
        actualPool.push(url);
      }
      // Recheck the latest viewport even if its resize event has not been delivered yet.
      if (!candidatesForWindow().includes(url)) continue;

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
        mixBlendMode: 'soft-light',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      next.style.display = foregroundVisible ? '' : 'none';
      next.style.opacity = '0';
      document.documentElement.appendChild(next);
      const previous = overlay;
      overlay = next;
      overlayUrl = url;
      window.requestAnimationFrame(() => {
        if (stopped) return;
        next.style.opacity = String(overlayOpacity);
        if (!previous) return;
        fadingOverlays.add(previous);
        previous.style.transition = `opacity ${fadeDurationMs}ms ease`;
        previous.style.opacity = '0';
        const fadeTimer = window.setTimeout(() => {
          previous.remove();
          fadingOverlays.delete(previous);
          fadeTimers.delete(fadeTimer);
        }, fadeDurationMs);
        fadeTimers.add(fadeTimer);
      });
      return;
    }
  }

  function restartTimer() {
    window.clearTimeout(timer);
    if (stopped || candidatesForWindow().length < 2) return;
    timer = window.setTimeout(() => {
      void rotate().catch((error) => console.error('[Pixiv 背景]', error));
    }, intervalMs);
  }

  function rotate(): Promise<void> {
    if (stopped) return Promise.resolve();
    window.clearTimeout(timer);
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
  }

  function onKeyDown(event: KeyboardEvent) {
    if (stopped || !event.altKey || event.metaKey === event.ctrlKey || event.shiftKey || event.isComposing) return;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      blurPx = Math.max(0, blurPx + (event.code === 'ArrowUp' ? 1 : -1));
      if (overlay) overlay.style.filter = `blur(${blurPx}px)`;
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
    if (event.code !== 'ArrowRight' || candidatesForWindow().length < 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || rotationController) return;
    void rotate().catch((error) => console.error('[Pixiv 背景]', error));
  }

  try {
    await classifyUnknownImages();
    if (stopped) return;
    if (candidatesForWindow().length === 0) throw new Error('所有背景图片均无法加载或无法确定尺寸');
    lastWindowOrientation = getWindowOrientation();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('resize', onResize);
    await rotate();
  } catch (error) {
    cleanup();
    throw error;
  }
}
