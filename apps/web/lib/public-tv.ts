'use client';

/** Stable per-display window name so the operator can find the TV popup again later. */
export function publicTvWindowName(path: string): string {
  return `tkd-public-tv-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

/**
 * Live references to the TV popups this operator page opened. Calling
 * window.open() on an existing TV window makes Chromium exit that window's
 * fullscreen, so the stored reference is always preferred for remote control.
 */
const publicTvWindows = new Map<string, Window>();

function lookupPublicTv(name: string): Window | null {
  const stored = publicTvWindows.get(name);
  if (stored) {
    try {
      if (!stored.closed && stored.location.href !== 'about:blank') return stored;
    } catch {
      // Closed or cross-origin — fall through and drop the stale reference.
    }
    publicTvWindows.delete(name);
  }
  return null;
}

/**
 * Apply fullscreen directly to the TV popup window using the operator's own click
 * gesture. Browsers only allow fullscreen from a user gesture, and the opener's
 * click counts for its same-origin popups — so this works instantly, without anyone
 * touching the TV screen. Returns true when a TV window was controlled.
 */
export function applyPublicTvFullscreen(path: string, fullscreen: boolean): boolean {
  if (typeof window === 'undefined') return false;
  const name = publicTvWindowName(path);
  let popup = lookupPublicTv(name);
  if (!popup) {
    // Fallback (e.g. after an operator page reload): window.open('') never navigates
    // an existing named window, but it can exit that window's fullscreen — the
    // request below retries to recover from that transition.
    try {
      popup = window.open('', name);
    } catch {
      return false;
    }
    if (!popup || popup === window) return false;
    try {
      if (popup.location.href === 'about:blank') {
        popup.close();
        return false;
      }
      publicTvWindows.set(name, popup);
    } catch {
      return false;
    }
  }
  try {
    // Only act when the TV is not already in the desired state: calling
    // requestFullscreen() on another document that is already fullscreen can make
    // the browser exit fullscreen instead of treating it as a no-op.
    if (fullscreen && !popup.document.fullscreenElement) {
      const request = popup.document.documentElement.requestFullscreen();
      void request.catch(() => {
        // The fallback window.open() above may have just exited an in-progress
        // fullscreen transition; retry once it has settled so the TV still
        // lands in fullscreen.
        window.setTimeout(() => {
          try {
            if (!popup || popup.closed || popup.document.fullscreenElement) return;
            void popup.document.documentElement.requestFullscreen().catch(() => {});
          } catch {
            // TV window closed in between — nothing to do.
          }
        }, 250);
      });
    } else if (!fullscreen && popup.document.fullscreenElement) {
      void popup.document.exitFullscreen().catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/** Open one reusable, resizable TV window per display without replacing the operator page. */
export function openPublicTv(path: string): boolean {
  if (typeof window === 'undefined') return false;

  const availableWidth = window.screen.availWidth || 1280;
  const availableHeight = window.screen.availHeight || 720;
  const width = Math.min(1280, availableWidth);
  const height = Math.min(720, availableHeight);
  const left = Math.max(0, Math.round((availableWidth - width) / 2));
  const top = Math.max(0, Math.round((availableHeight - height) / 2));
  const windowName = publicTvWindowName(path);
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
    'toolbar=no',
    'menubar=no',
    'location=no',
    'status=no',
  ].join(',');

  const popup = window.open(path, windowName, features);
  if (!popup) return false;
  publicTvWindows.set(windowName, popup);
  popup.focus();
  return true;
}
