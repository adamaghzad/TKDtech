import { describe, expect, it } from 'vitest';
import { desktopRelease } from '../../apps/web/lib/desktop-release';
import desktopPackage from '../../desktop/package.json';

describe('desktop release links', () => {
  it('keeps the public download, checksum and notes on the same versioned release', () => {
    const tag = `desktop-v${desktopPackage.version}`;
    expect(desktopRelease.version).toBe(desktopPackage.version);
    expect(desktopRelease.downloadUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/download/${tag}/${desktopRelease.fileName}`);
    expect(desktopRelease.checksumUrl).toBe(`${desktopRelease.downloadUrl}.sha256`);
    expect(desktopRelease.releaseUrl).toBe(`https://github.com/adamaghzad/TKDtech/releases/tag/${tag}`);
    expect(desktopRelease.fileName).toBe('TKD-Scoring-Windows-x64.zip');
  });
});
