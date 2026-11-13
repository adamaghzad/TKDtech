import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_PRESETS,
  CountryFlag,
  normalizeCountryCode,
} from '../../apps/web/components/ui/country-flag';

function walkUiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walkUiFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('offline SVG CountryFlag with exact Moroccan flag focus', () => {
  it('places Morocco (MAR) first in presets and normalizes Moroccan & international aliases', () => {
    expect(COUNTRY_PRESETS[0]).toEqual({ code: 'MAR', name: 'Morocco' });
    expect(normalizeCountryCode('MAR')).toBe('MAR');
    expect(normalizeCountryCode('MA')).toBe('MAR');
    expect(normalizeCountryCode('ma')).toBe('MAR');
    expect(normalizeCountryCode('MOR')).toBe('MAR');
    expect(normalizeCountryCode('Maroc')).toBe('MAR');
    expect(normalizeCountryCode('Morocco')).toBe('MAR');
    expect(normalizeCountryCode('')).toBe('MAR');
    expect(normalizeCountryCode(null)).toBe('MAR');
    expect(normalizeCountryCode(undefined)).toBe('MAR');

    expect(normalizeCountryCode('DZ')).toBe('ALG');
    expect(normalizeCountryCode('DZA')).toBe('ALG');
    expect(normalizeCountryCode('TN')).toBe('TUN');
    expect(normalizeCountryCode('FR')).toBe('FRA');
    expect(normalizeCountryCode('KR')).toBe('KOR');
    expect(normalizeCountryCode('SAU')).toBe('KSA');
    expect(normalizeCountryCode('PSE')).toBe('PLE');
    expect(normalizeCountryCode('XYZ')).toBe('XYZ');
  });

  it('renders exact vector Flag of Morocco (#C1272D + #006233 interlaced pentagram) with zero network URLs', () => {
    for (const code of ['MAR', 'MA', 'MOR']) {
      const html = renderToStaticMarkup(createElement(CountryFlag, { code }));
      expect(html).toContain('<svg');
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${code} flag"`);
      expect(html).toContain('#C1272D');
      expect(html).toContain('#006233');
      const withoutSvgNs = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', '');
      expect(withoutSvgNs).not.toContain('http://');
      expect(withoutSvgNs).not.toContain('https://');
    }
  });

  it('replaces broken Windows regional-indicator flagEmoji across all .tsx UI components', () => {
    const tsxFiles = [
      ...walkUiFiles('apps/web/app'),
      ...walkUiFiles('apps/web/components'),
      ...walkUiFiles('apps/web/features'),
    ];
    for (const file of tsxFiles) {
      expect(readFileSync(file, 'utf8'), `${file} still calls flagEmoji`).not.toContain('flagEmoji');
    }
  });
});
