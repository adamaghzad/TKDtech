'use client';

/** Stable per-display window name so the operator can find the TV popup again later. */
export function publicTvWindowName(path: string): string {
  return `tkd-public-tv-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

/**
 * Apply fullscreen directly to the TV popup window using the operator's own click
 * gesture. Browsers only allow fullscreen from a user gesture, and the opener's
 * click counts for its same-origin popups — so this works instantly, without anyone
 * touching the TV screen. Returns true when a TV window was controlled.
 */
export function applyPublicTvFullscreen(path: string, fullscreen: boolean): boolean {
  if (typeof window === 'undefined') return false;
  let popup: Window | null = null;
  try {
    popup = window.open('', publicTvWindowName(path));
  } catch {
    return false;
  }
  if (!popup || popup === window) return false;
  try {
    // window.open('') never navigates an existing named window; a fresh about:blank
    // window means no TV is open under that name — close it again and do nothing.
    if (popup.location.href === 'about:blank') {
      popup.close();
      return false;
    }
    if (fullscreen) {
      void popup.document.documentElement.requestFullscreen().catch(() => {});
    } else if (popup.document.fullscreenElement) {
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
  popup.focus();
  return true;
}
