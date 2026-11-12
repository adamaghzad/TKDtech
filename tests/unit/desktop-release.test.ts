import { describe, expect, it } from 'vitest';
import { androidRelease, desktopRelease } from '../../apps/web/lib/desktop-release';
import desktopPackage from '../../desktop/package.json';

describe('desktop and mobile release links', () => {
  it('keeps the public desktop download, checksum and notes on the same versioned release', () => {
    const tag = `desktop-v${desktopPackage.version}`;
    expect(desktopRelease.version).toBe(desktopPackage.version);
    expect(desktopRelease.downloadUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/download/${tag}/${desktopRelease.fileName}`);
    expect(desktopRelease.checksumUrl).toBe(`${desktopRelease.downloadUrl}.sha256`);
    expect(desktopRelease.releaseUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/tag/${tag}`);
    expect(desktopRelease.fileName).toBe('TKD-Scoring-Windows-x64.zip');
  });

  it('keeps the public Android mobile host download, checksum and notes consistent', () => {
    const tag = `android-v${androidRelease.version}`;
    expect(androidRelease.downloadUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/download/${tag}/${androidRelease.fileName}`);
    expect(androidRelease.checksumUrl).toBe(`${androidRelease.downloadUrl}.sha256`);
    expect(androidRelease.releaseUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/tag/${tag}`);
    expect(androidRelease.fileName).toBe('TKD-Scoring-Android-universal-validation-debug.apk');
  });
});
