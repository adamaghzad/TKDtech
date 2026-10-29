'use client';

/** Open one reusable, resizable TV window per display without replacing the operator page. */
export function openPublicTv(path: string): boolean {
  if (typeof window === 'undefined') return false;

  const availableWidth = window.screen.availWidth || 1280;
  const availableHeight = window.screen.availHeight || 720;
  const width = Math.min(1280, availableWidth);
  const height = Math.min(720, availableHeight);
  const left = Math.max(0, Math.round((availableWidth - width) / 2));
  const top = Math.max(0, Math.round((availableHeight - height) / 2));
  const windowName = `tkd-public-tv-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
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
