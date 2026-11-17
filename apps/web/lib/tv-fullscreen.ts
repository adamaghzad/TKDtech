/**
 * Shared TV fullscreen preference + Desktop (Electron) bridge.
 *
 * The operator scoreboard and the Public TV windows share the same origin, so
 * localStorage is used as the synchronization channel: writing the preference
 * fires a `storage` event in every other open TV window, which applies it.
 * On the Desktop app the bridge asks Electron to toggle window-level fullscreen
 * on every Public TV window, which works without a page user gesture.
 */

export const TV_FULLSCREEN_PREF_KEY = 'tkd_public_tv_fullscreen';

export interface TkDesktopBridge {
  setTvFullscreen?: (value: boolean) => Promise<unknown>;
}

/** Returns the Electron preload bridge when running inside the Desktop app. */
export function desktopBridge(): TkDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { tkdDesktop?: TkDesktopBridge }).tkdDesktop;
}

export function readTvFullscreenPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TV_FULLSCREEN_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTvFullscreenPref(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(TV_FULLSCREEN_PREF_KEY, '1');
    else window.localStorage.removeItem(TV_FULLSCREEN_PREF_KEY);
  } catch {
    // Ignore storage quota / privacy errors in kiosk browsers
  }
}

/**
 * Applies a fullscreen change on the TV side. Prefers the in-page Fullscreen
 * API and falls back to the Desktop window-level fullscreen (no user gesture
 * required) when the browser denies programmatic fullscreen.
 */
export async function applyTvFullscreen(value: boolean): Promise<void> {
  let applied = false;
  try {
    if (value) {
      if (document.fullscreenElement) applied = true;
      else {
        await document.documentElement.requestFullscreen();
        applied = true;
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
      applied = true;
    }
  } catch {
    // Browsers require a user gesture for programmatic fullscreen; keep the
    // sticky preference so it applies on the next interaction with the TV.
    applied = false;
  }
  if (!applied) {
    try {
      await desktopBridge()?.setTvFullscreen?.(value);
    } catch {
      // Not running inside the Desktop app, or the window is already gone.
    }
  }
}
