import React, { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface CountryFlagProps {
  code?: string | null;
  className?: string;
  title?: string;
}

export interface CountryPreset {
  code: string;
  name: string;
}

export const COUNTRY_PRESETS: readonly CountryPreset[] = [
  { code: 'MAR', name: 'Morocco' },
  { code: 'TUN', name: 'Tunisia' },
  { code: 'ALG', name: 'Algeria' },
  { code: 'EGY', name: 'Egypt' },
  { code: 'FRA', name: 'France' },
  { code: 'ESP', name: 'Spain' },
  { code: 'KOR', name: 'South Korea' },
  { code: 'SEN', name: 'Senegal' },
  { code: 'CIV', name: "Côte d'Ivoire" },
  { code: 'JOR', name: 'Jordan' },
  { code: 'KSA', name: 'Saudi Arabia' },
  { code: 'UAE', name: 'United Arab Emirates' },
  { code: 'PLE', name: 'Palestine' },
  { code: 'QAT', name: 'Qatar' },
  { code: 'TUR', name: 'Turkey' },
  { code: 'ITA', name: 'Italy' },
  { code: 'GBR', name: 'Great Britain' },
  { code: 'GER', name: 'Germany' },
  { code: 'BEL', name: 'Belgium' },
  { code: 'NED', name: 'Netherlands' },
  { code: 'POR', name: 'Portugal' },
  { code: 'USA', name: 'United States' },
  { code: 'CAN', name: 'Canada' },
  { code: 'BRA', name: 'Brazil' },
  { code: 'IRI', name: 'Iran' },
  { code: 'UZB', name: 'Uzbekistan' },
  { code: 'CHN', name: 'China' },
  { code: 'JPN', name: 'Japan' },
] as const;

const CODE_ALIASES: Record<string, string> = {
  // Morocco aliases (ISO-2, IOC, ISO-3, French/English)
  MA: 'MAR',
  MAR: 'MAR',
  MOR: 'MAR',
  MAROC: 'MAR',
  MOROCCO: 'MAR',
  // Maghreb & Arab world
  DZ: 'ALG',
  DZA: 'ALG',
  ALG: 'ALG',
  TN: 'TUN',
  TUN: 'TUN',
  EG: 'EGY',
  EGY: 'EGY',
  LY: 'LBY',
  LBY: 'LBY',
  MR: 'MTN',
  MRT: 'MTN',
  MTN: 'MTN',
  PS: 'PLE',
  PSE: 'PLE',
  PLE: 'PLE',
  JO: 'JOR',
  JOR: 'JOR',
  SA: 'KSA',
  SAU: 'KSA',
  KSA: 'KSA',
  AE: 'UAE',
  ARE: 'UAE',
  UAE: 'UAE',
  QA: 'QAT',
  QAT: 'QAT',
  KW: 'KUW',
  KWT: 'KUW',
  KUW: 'KUW',
  BH: 'BHR',
  BHR: 'BHR',
  OM: 'OMN',
  OMN: 'OMN',
  LB: 'LBN',
  LIB: 'LBN',
  LBN: 'LBN',
  SY: 'SYR',
  SYR: 'SYR',
  IQ: 'IRQ',
  IRQ: 'IRQ',
  YE: 'YEM',
  YEM: 'YEM',
  // Sub-Saharan Africa
  SN: 'SEN',
  SEN: 'SEN',
  CI: 'CIV',
  CIV: 'CIV',
  ML: 'MLI',
  MLI: 'MLI',
  GN: 'GUI',
  GIN: 'GUI',
  GUI: 'GUI',
  NE: 'NIG',
  NER: 'NIG',
  NIG: 'NIG',
  NG: 'NGA',
  NGA: 'NGA',
  CM: 'CMR',
  CMR: 'CMR',
  GA: 'GAB',
  GAB: 'GAB',
  KE: 'KEN',
  KEN: 'KEN',
  ZA: 'RSA',
  ZAF: 'RSA',
  RSA: 'RSA',
  // Europe
  FR: 'FRA',
  FRA: 'FRA',
  ES: 'ESP',
  ESP: 'ESP',
  PT: 'POR',
  PRT: 'POR',
  POR: 'POR',
  IT: 'ITA',
  ITA: 'ITA',
  DE: 'GER',
  DEU: 'GER',
  GER: 'GER',
  BE: 'BEL',
  BEL: 'BEL',
  NL: 'NED',
  NLD: 'NED',
  NED: 'NED',
  GB: 'GBR',
  UK: 'GBR',
  GBR: 'GBR',
  CH: 'SUI',
  CHE: 'SUI',
  SUI: 'SUI',
  FI: 'FIN',
  FIN: 'FIN',
  NO: 'NOR',
  NOR: 'NOR',
  SE: 'SWE',
  SWE: 'SWE',
  PL: 'POL',
  POL: 'POL',
  HR: 'CRO',
  HRV: 'CRO',
  CRO: 'CRO',
  RS: 'SRB',
  SRB: 'SRB',
  TR: 'TUR',
  TUR: 'TUR',
  AZ: 'AZE',
  AZE: 'AZE',
  // Asia & Oceania
  KR: 'KOR',
  KOR: 'KOR',
  CN: 'CHN',
  CHN: 'CHN',
  JP: 'JPN',
  JPN: 'JPN',
  TW: 'TPE',
  TWN: 'TPE',
  TPE: 'TPE',
  IR: 'IRI',
  IRN: 'IRI',
  IRI: 'IRI',
  UZ: 'UZB',
  UZB: 'UZB',
  KZ: 'KAZ',
  KAZ: 'KAZ',
  TH: 'THA',
  THA: 'THA',
  AU: 'AUS',
  AUS: 'AUS',
  // Americas
  US: 'USA',
  USA: 'USA',
  CA: 'CAN',
  CAN: 'CAN',
  MX: 'MEX',
  MEX: 'MEX',
  BR: 'BRA',
  BRA: 'BRA',
  AR: 'ARG',
  ARG: 'ARG',
  CO: 'COL',
  COL: 'COL',
  CU: 'CUB',
  CUB: 'CUB',
};

export function normalizeCountryCode(code?: string | null, fallback = 'MAR'): string {
  const cleaned = (code ?? '').trim().toUpperCase();
  if (!cleaned) return fallback;
  const mapped = CODE_ALIASES[cleaned];
  if (mapped) return mapped;
  if (/^[A-Z]{3}$/.test(cleaned)) return cleaned;
  return fallback;
}

function starPoints(
  cx: number,
  cy: number,
  rOut: number,
  rIn?: number,
  points = 5,
  rotDeg = -90,
): string {
  const inner =
    rIn ??
    (points === 5
      ? (rOut * Math.sin(Math.PI / 10)) / Math.sin((3 * Math.PI) / 10)
      : rOut * 0.43);
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? rOut : inner;
    const rad = ((rotDeg + (i * 180) / points) * Math.PI) / 180;
    coords.push(`${(cx + r * Math.cos(rad)).toFixed(1)},${(cy + r * Math.sin(rad)).toFixed(1)}`);
  }
  return coords.join(' ');
}

/**
 * Exact Royal Flag of the Kingdom of Morocco (Dahir of 17 November 1915):
 * - 3:2 crimson field (#C1272D)
 * - Centered emerald green (#006233) 5-pointed interlaced pentagram (R = 150, 1/3 of length)
 * - Authentic over-and-under Seal of Solomon weave borders
 */
const MOROCCO_STAR_RIBBONS =
  'M450.00,138.00L545.22,431.06L510.98,383.94L450.00,196.25Z' +
  'M604.07,249.94L354.78,431.06L389.02,383.94L548.67,267.94Z' +
  'M545.22,431.06L295.93,249.94L351.33,267.94L510.98,383.94Z' +
  'M354.78,431.06L450.00,138.00L450.00,196.25L389.02,383.94Z' +
  'M295.93,249.94L604.07,249.94L548.67,267.94L351.33,267.94Z';

const MOROCCO_STAR_WEAVE =
  'M413.63,249.94L450.00,138.00L503.00,301.12M432.56,249.94L450.00,196.25L487.69,312.25' +
  'M486.37,249.94L604.07,249.94L465.31,350.75M492.22,267.94L548.67,267.94L450.00,339.63' +
  'M508.85,319.12L545.22,431.06L406.46,330.25M493.54,330.25L510.98,383.94L412.31,312.25' +
  'M450.00,361.88L354.78,431.06L407.78,267.94M434.69,350.75L389.02,383.94L426.71,267.94' +
  'M391.15,319.12L295.93,249.94L467.44,249.94M397.00,301.12L351.33,267.94L473.29,267.94';

function hStripes(c1: string, c2: string, c3: string): ReactNode {
  return (
    <>
      <rect width="900" height="200" fill={c1} />
      <rect y="200" width="900" height="200" fill={c2} />
      <rect y="400" width="900" height="200" fill={c3} />
    </>
  );
}

function vStripes(c1: string, c2: string, c3: string): ReactNode {
  return (
    <>
      <rect width="300" height="600" fill={c1} />
      <rect x="300" width="300" height="600" fill={c2} />
      <rect x="600" width="300" height="600" fill={c3} />
    </>
  );
}

function renderFlagArtwork(code: string, rawLabel: string): ReactNode {
  switch (code) {
    case 'MAR':
      return (
        <>
          <rect width="900" height="600" fill="#C1272D" />
          <path d={MOROCCO_STAR_RIBBONS} fill="#006233" />
          <path
            d={MOROCCO_STAR_WEAVE}
            fill="none"
            stroke="#000000"
            strokeWidth="2.4"
            strokeLinejoin="miter"
            strokeMiterlimit="10"
          />
        </>
      );

    case 'ALG':
      return (
        <>
          <rect width="450" height="600" fill="#006233" />
          <rect x="450" width="450" height="600" fill="#FFFFFF" />
          <path
            d="M577.96,221.73 A150,150 0 1,0 577.96,378.27 A120,120 0 1,1 577.96,221.73 Z"
            fill="#D21034"
          />
          <polygon points={starPoints(496, 300, 66, undefined, 5, -72)} fill="#D21034" />
        </>
      );

    case 'TUN':
      return (
        <>
          <rect width="900" height="600" fill="#E70013" />
          <circle cx="450" cy="300" r="150" fill="#FFFFFF" />
          <path
            d="M539.07,232.09 A112,112 0 1,0 539.07,367.91 A90,90 0 1,1 539.07,232.09 Z"
            fill="#E70013"
          />
          <polygon points={starPoints(472, 300, 58, undefined, 5, -72)} fill="#E70013" />
        </>
      );

    case 'EGY':
      return (
        <>
          {hStripes('#CE1126', '#FFFFFF', '#000000')}
          <g fill="#C09300">
            <path d="M450,224 L468,248 L496,242 L488,326 L450,352 L412,326 L404,242 L432,248 Z" />
            <rect x="406" y="346" width="88" height="18" rx="4" />
          </g>
          <rect x="434" y="264" width="32" height="48" rx="4" fill="#FFFFFF" stroke="#C09300" strokeWidth="4" />
        </>
      );

    case 'LBY':
      return (
        <>
          <rect width="900" height="150" fill="#E70013" />
          <rect y="150" width="900" height="300" fill="#000000" />
          <rect y="450" width="900" height="150" fill="#239E46" />
          <path
            d="M498.5,246.5 A75,75 0 1,0 498.5,353.5 A62,62 0 1,1 498.5,246.5 Z"
            fill="#FFFFFF"
          />
          <polygon points={starPoints(520, 300, 36, undefined, 5, -72)} fill="#FFFFFF" />
        </>
      );

    case 'MTN':
      return (
        <>
          <rect width="900" height="600" fill="#00A95C" />
          <rect width="900" height="90" fill="#D01C1F" />
          <rect y="510" width="900" height="90" fill="#D01C1F" />
          <g transform="translate(450 285) rotate(-90) translate(-450 -300)">
            <path
              d="M558,215 A135,135 0 1,0 558,385 A112,112 0 1,1 558,215 Z"
              fill="#FFD700"
            />
          </g>
          <polygon points={starPoints(450, 240, 46)} fill="#FFD700" />
        </>
      );

    case 'PLE':
      return (
        <>
          {hStripes('#000000', '#FFFFFF', '#007A3D')}
          <polygon points="0,0 420,300 0,600" fill="#CE1126" />
        </>
      );

    case 'JOR':
      return (
        <>
          {hStripes('#000000', '#FFFFFF', '#007A3D')}
          <polygon points="0,0 420,300 0,600" fill="#CE1126" />
          <polygon points={starPoints(138, 300, 42, 18.5, 7, -90)} fill="#FFFFFF" />
        </>
      );

    case 'KSA':
      return (
        <>
          <rect width="900" height="600" fill="#006C35" />
          {/* Stylized white Shahada calligraphic band + horizontal sword */}
          <g fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round">
            <path d="M245,255 H655 M270,215 V268 M330,195 V268 M395,205 V268 M455,190 V268 M520,205 V268 M585,195 V268 M635,212 V268" strokeWidth="18" />
            <path d="M260,235 Q310,185 360,235 T470,235 T590,235" strokeWidth="14" />
          </g>
          <path d="M275,375 H585 L625,367 L585,359 H275 Z" fill="#FFFFFF" />
          <rect x="575" y="346" width="16" height="44" rx="4" fill="#FFFFFF" />
          <rect x="588" y="359" width="52" height="16" rx="6" fill="#FFFFFF" />
        </>
      );

    case 'UAE':
      return (
        <>
          {hStripes('#00732F', '#FFFFFF', '#000000')}
          <rect width="240" height="600" fill="#FF0000" />
        </>
      );

    case 'QAT':
      return (
        <>
          <rect width="900" height="600" fill="#8A1538" />
          <polygon
            points="0,0 250,0 322,33.3 250,66.7 322,100 250,133.3 322,166.7 250,200 322,233.3 250,266.7 322,300 250,333.3 322,366.7 250,400 322,433.3 250,466.7 322,500 250,533.3 322,566.7 250,600 0,600"
            fill="#FFFFFF"
          />
        </>
      );

    case 'BHR':
      return (
        <>
          <rect width="900" height="600" fill="#CE1126" />
          <polygon
            points="0,0 225,0 345,60 225,120 345,180 225,240 345,300 225,360 345,420 225,480 345,540 225,600 0,600"
            fill="#FFFFFF"
          />
        </>
      );

    case 'KUW':
      return (
        <>
          {hStripes('#007A3D', '#FFFFFF', '#CE1126')}
          <polygon points="0,0 245,200 245,400 0,600" fill="#000000" />
        </>
      );

    case 'OMN':
      return (
        <>
          {hStripes('#FFFFFF', '#DB161B', '#008000')}
          <rect width="260" height="600" fill="#DB161B" />
          <g stroke="#FFFFFF" strokeWidth="14" strokeLinecap="round" fill="none">
            <path d="M90,90 L170,170 M170,90 L90,170" />
            <circle cx="130" cy="130" r="22" fill="#DB161B" />
          </g>
        </>
      );

    case 'LBN':
      return (
        <>
          <rect width="900" height="150" fill="#ED1C24" />
          <rect y="150" width="900" height="300" fill="#FFFFFF" />
          <rect y="450" width="900" height="150" fill="#ED1C24" />
          <polygon
            points="450,175 375,285 410,285 355,375 428,375 428,425 472,425 472,375 545,375 490,285 525,285"
            fill="#00A651"
          />
        </>
      );

    case 'SYR':
      return (
        <>
          {hStripes('#CE1126', '#FFFFFF', '#000000')}
          <polygon points={starPoints(320, 300, 48)} fill="#007A3D" />
          <polygon points={starPoints(580, 300, 48)} fill="#007A3D" />
        </>
      );

    case 'IRQ':
      return (
        <>
          {hStripes('#CE1126', '#FFFFFF', '#000000')}
          <g fill="#007A3D">
            <rect x="300" y="276" width="85" height="48" rx="8" />
            <rect x="415" y="266" width="95" height="58" rx="8" />
            <rect x="535" y="276" width="65" height="48" rx="8" />
          </g>
        </>
      );

    case 'YEM':
      return hStripes('#CE1126', '#FFFFFF', '#000000');

    case 'SEN':
      return (
        <>
          {vStripes('#00853F', '#FDEF42', '#E31B23')}
          <polygon points={starPoints(450, 300, 72)} fill="#00853F" />
        </>
      );

    case 'CIV':
      return vStripes('#F77F00', '#FFFFFF', '#009E60');

    case 'MLI':
      return vStripes('#14B53A', '#FCD116', '#CE1126');

    case 'GUI':
      return vStripes('#CE1126', '#FCD116', '#009460');

    case 'CMR':
      return (
        <>
          {vStripes('#007A5E', '#CE1126', '#FCD116')}
          <polygon points={starPoints(450, 300, 72)} fill="#FCD116" />
        </>
      );

    case 'NGA':
      return vStripes('#008751', '#FFFFFF', '#008751');

    case 'NIG':
      return (
        <>
          {hStripes('#E05206', '#FFFFFF', '#0DB02B')}
          <circle cx="450" cy="300" r="72" fill="#E05206" />
        </>
      );

    case 'GAB':
      return hStripes('#009E60', '#FCD116', '#3A75C4');

    case 'KEN':
      return (
        <>
          <rect width="900" height="600" fill="#FFFFFF" />
          <rect width="900" height="170" fill="#000000" />
          <rect y="215" width="900" height="170" fill="#BB0000" />
          <rect y="430" width="900" height="170" fill="#006600" />
          <line x1="395" y1="125" x2="505" y2="475" stroke="#FFFFFF" strokeWidth="14" />
          <line x1="505" y1="125" x2="395" y2="475" stroke="#FFFFFF" strokeWidth="14" />
          <ellipse cx="450" cy="300" rx="64" ry="135" fill="#BB0000" stroke="#000000" strokeWidth="10" />
          <ellipse cx="450" cy="300" rx="16" ry="52" fill="#FFFFFF" />
        </>
      );

    case 'RSA':
      return (
        <>
          <rect width="900" height="300" fill="#E03C31" />
          <rect y="300" width="900" height="300" fill="#001489" />
          <path d="M0,0 L360,300 L0,600" fill="#000000" />
          <path
            d="M0,0 L110,0 L435,240 L900,240 L900,360 L435,360 L110,600 L0,600 L0,520 L300,300 L0,80 Z"
            fill="#007749"
            stroke="#FFFFFF"
            strokeWidth="28"
          />
          <path d="M0,95 L275,300 L0,505 Z" fill="#000000" stroke="#FFB81C" strokeWidth="26" />
          <path d="M90,0 L430,250 L900,250 L900,350 L430,350 L90,600 L0,600 L0,530 L315,300 L0,70 L0,0 Z" fill="#007749" />
        </>
      );

    case 'KOR':
      return (
        <>
          <rect width="900" height="600" fill="#FFFFFF" />
          {/* Exact Taeguk rotated 33.69° along 3:2 diagonal */}
          <g transform="translate(450 300) rotate(33.69)">
            <circle r="150" fill="#0047A0" />
            <path d="M-150,0 A150,150 0 0,1 150,0 Z" fill="#CD2E3A" />
            <circle cx="-75" cy="0" r="75" fill="#CD2E3A" />
            <circle cx="75" cy="0" r="75" fill="#0047A0" />
          </g>
          {/* Four trigrams: Geon (TL), Gam (TR), Ri (BL), Gon (BR) */}
          <g fill="#000000">
            <g transform="translate(225 150) rotate(-56.31)">
              <rect x="-66" y="-42" width="132" height="20" />
              <rect x="-66" y="-10" width="132" height="20" />
              <rect x="-66" y="22" width="132" height="20" />
            </g>
            <g transform="translate(675 150) rotate(56.31)">
              <rect x="-66" y="-42" width="60" height="20" />
              <rect x="6" y="-42" width="60" height="20" />
              <rect x="-66" y="-10" width="132" height="20" />
              <rect x="-66" y="22" width="60" height="20" />
              <rect x="6" y="22" width="60" height="20" />
            </g>
            <g transform="translate(225 450) rotate(56.31)">
              <rect x="-66" y="-42" width="132" height="20" />
              <rect x="-66" y="-10" width="60" height="20" />
              <rect x="6" y="-10" width="60" height="20" />
              <rect x="-66" y="22" width="132" height="20" />
            </g>
            <g transform="translate(675 450) rotate(-56.31)">
              <rect x="-66" y="-42" width="60" height="20" />
              <rect x="6" y="-42" width="60" height="20" />
              <rect x="-66" y="-10" width="60" height="20" />
              <rect x="6" y="-10" width="60" height="20" />
              <rect x="-66" y="22" width="60" height="20" />
              <rect x="6" y="22" width="60" height="20" />
            </g>
          </g>
        </>
      );

    case 'FRA':
      return vStripes('#002395', '#FFFFFF', '#ED2939');

    case 'ESP':
      return (
        <>
          <rect width="900" height="150" fill="#AA151B" />
          <rect y="150" width="900" height="300" fill="#F1BF00" />
          <rect y="450" width="900" height="150" fill="#AA151B" />
          <g transform="translate(260 300)">
            <rect x="-52" y="-58" width="104" height="112" rx="18" fill="#AA151B" stroke="#C89211" strokeWidth="8" />
            <rect x="-52" y="-58" width="52" height="56" fill="#C89211" />
            <rect x="0" y="0" width="52" height="54" fill="#F1BF00" />
            <ellipse cx="0" cy="-76" rx="44" ry="18" fill="#C89211" />
            <rect x="-76" y="-56" width="14" height="114" fill="#FFFFFF" stroke="#C89211" strokeWidth="4" />
            <rect x="62" y="-56" width="14" height="114" fill="#FFFFFF" stroke="#C89211" strokeWidth="4" />
          </g>
        </>
      );

    case 'POR':
      return (
        <>
          <rect width="360" height="600" fill="#006600" />
          <rect x="360" width="540" height="600" fill="#FF0000" />
          <circle cx="360" cy="300" r="115" fill="none" stroke="#FFCC00" strokeWidth="18" />
          <line x1="245" y1="300" x2="475" y2="300" stroke="#FFCC00" strokeWidth="12" />
          <line x1="360" y1="185" x2="360" y2="415" stroke="#FFCC00" strokeWidth="12" />
          <rect x="312" y="244" width="96" height="112" rx="22" fill="#FF0000" stroke="#FFFFFF" strokeWidth="8" />
          <rect x="332" y="266" width="56" height="68" rx="10" fill="#FFFFFF" />
        </>
      );

    case 'ITA':
      return vStripes('#009246', '#FFFFFF', '#CE2B37');

    case 'GER':
      return hStripes('#000000', '#DD0000', '#FFCE00');

    case 'BEL':
      return vStripes('#000000', '#FDDA24', '#EF3340');

    case 'NED':
      return hStripes('#AE1C28', '#FFFFFF', '#21468B');

    case 'GBR':
      return (
        <>
          <rect width="900" height="600" fill="#012169" />
          <path d="M0,0 L900,600 M900,0 L0,600" stroke="#FFFFFF" strokeWidth="110" />
          <path d="M0,0 L900,600 M900,0 L0,600" stroke="#C8102E" strokeWidth="56" />
          <path d="M450,0 V600 M0,300 H900" stroke="#FFFFFF" strokeWidth="180" />
          <path d="M450,0 V600 M0,300 H900" stroke="#C8102E" strokeWidth="108" />
        </>
      );

    case 'SUI':
      return (
        <>
          <rect width="900" height="600" fill="#FF0000" />
          <rect x="395" y="130" width="110" height="340" fill="#FFFFFF" />
          <rect x="280" y="245" width="340" height="110" fill="#FFFFFF" />
        </>
      );

    case 'FIN':
      return (
        <>
          <rect width="900" height="600" fill="#FFFFFF" />
          <rect x="250" width="140" height="600" fill="#003580" />
          <rect y="230" width="900" height="140" fill="#003580" />
        </>
      );

    case 'NOR':
      return (
        <>
          <rect width="900" height="600" fill="#BA0C2F" />
          <rect x="240" width="150" height="600" fill="#FFFFFF" />
          <rect y="225" width="900" height="150" fill="#FFFFFF" />
          <rect x="278" width="74" height="600" fill="#00205B" />
          <rect y="263" width="900" height="74" fill="#00205B" />
        </>
      );

    case 'SWE':
      return (
        <>
          <rect width="900" height="600" fill="#006AA7" />
          <rect x="260" width="120" height="600" fill="#FECC02" />
          <rect y="240" width="900" height="120" fill="#FECC02" />
        </>
      );

    case 'POL':
      return (
        <>
          <rect width="900" height="300" fill="#FFFFFF" />
          <rect y="300" width="900" height="300" fill="#DC143C" />
        </>
      );

    case 'CRO':
      return (
        <>
          {hStripes('#FF0000', '#FFFFFF', '#171796')}
          <rect x="380" y="185" width="140" height="190" rx="28" fill="#FFFFFF" stroke="#FF0000" strokeWidth="10" />
          <g fill="#FF0000">
            <rect x="386" y="192" width="32" height="36" />
            <rect x="450" y="192" width="32" height="36" />
            <rect x="418" y="228" width="32" height="36" />
            <rect x="482" y="228" width="32" height="36" />
            <rect x="386" y="264" width="32" height="36" />
            <rect x="450" y="264" width="32" height="36" />
            <rect x="418" y="300" width="32" height="36" />
          </g>
        </>
      );

    case 'SRB':
      return (
        <>
          {hStripes('#C6363C', '#0C4076', '#FFFFFF')}
          <rect x="225" y="170" width="130" height="210" rx="34" fill="#C6363C" stroke="#EAB543" strokeWidth="10" />
          <path d="M290,180 V370 M232,275 H348" stroke="#FFFFFF" strokeWidth="22" />
        </>
      );

    case 'TUR':
      return (
        <>
          <rect width="900" height="600" fill="#E30A17" />
          <path
            d="M515.58,217.96 A150,150 0 1,0 515.58,382.04 A120,120 0 1,1 515.58,217.96 Z"
            fill="#FFFFFF"
          />
          <polygon points={starPoints(518, 300, 68, undefined, 5, -72)} fill="#FFFFFF" />
        </>
      );

    case 'AZE':
      return (
        <>
          {hStripes('#0092BC', '#E4002B', '#00AF66')}
          <path
            d="M468,238 A76,76 0 1,0 468,362 A63,63 0 1,1 468,238 Z"
            fill="#FFFFFF"
          />
          <polygon points={starPoints(502, 300, 40, 19, 8, -90)} fill="#FFFFFF" />
        </>
      );

    case 'IRI':
      return (
        <>
          {hStripes('#239F40', '#FFFFFF', '#DA0000')}
          <g fill="#DA0000" transform="translate(450 300)">
            <rect x="-8" y="-68" width="16" height="136" rx="6" />
            <path d="M-24,-45 C-68,-15 -68,35 -18,62 C-42,25 -40,-15 -14,-42 Z" />
            <path d="M24,-45 C68,-15 68,35 18,62 C42,25 40,-15 14,-42 Z" />
            <path d="M-42,-30 C-88,5 -76,50 -28,68 C-58,35 -60,0 -32,-26 Z" />
            <path d="M42,-30 C88,5 76,50 28,68 C58,35 60,0 32,-26 Z" />
          </g>
        </>
      );

    case 'UZB':
      return (
        <>
          <rect width="900" height="192" fill="#0099B5" />
          <rect y="192" width="900" height="12" fill="#CE1126" />
          <rect y="204" width="900" height="192" fill="#FFFFFF" />
          <rect y="396" width="900" height="12" fill="#CE1126" />
          <rect y="408" width="900" height="192" fill="#1EB53A" />
          <path d="M170,52 A56,56 0 1,0 170,140 A46,46 0 1,1 170,52 Z" fill="#FFFFFF" />
          <g fill="#FFFFFF">
            {[0, 1, 2, 3, 4].map(i => (
              <circle key={`b${i}`} cx={230 + i * 28} cy={132} r="7" />
            ))}
            {[1, 2, 3, 4].map(i => (
              <circle key={`m${i}`} cx={230 + i * 28} cy={98} r="7" />
            ))}
            {[2, 3, 4].map(i => (
              <circle key={`t${i}`} cx={230 + i * 28} cy={64} r="7" />
            ))}
          </g>
        </>
      );

    case 'KAZ':
      return (
        <>
          <rect width="900" height="600" fill="#00AFCA" />
          <rect x="34" y="36" width="44" height="528" rx="12" fill="#FEC50C" />
          <circle cx="470" cy="275" r="95" fill="#FEC50C" />
          <path
            d="M325,355 Q470,445 615,355 Q540,415 470,415 Q400,415 325,355 Z"
            fill="#FEC50C"
          />
        </>
      );

    case 'CHN':
      return (
        <>
          <rect width="900" height="600" fill="#EE1C25" />
          <polygon points={starPoints(150, 150, 90)} fill="#FFFF00" />
          <polygon points={starPoints(300, 60, 30, undefined, 5, -115)} fill="#FFFF00" />
          <polygon points={starPoints(360, 120, 30, undefined, 5, -95)} fill="#FFFF00" />
          <polygon points={starPoints(360, 210, 30, undefined, 5, -70)} fill="#FFFF00" />
          <polygon points={starPoints(300, 270, 30, undefined, 5, -50)} fill="#FFFF00" />
        </>
      );

    case 'JPN':
      return (
        <>
          <rect width="900" height="600" fill="#FFFFFF" />
          <circle cx="450" cy="300" r="180" fill="#BC002D" />
        </>
      );

    case 'TPE':
      return (
        <>
          <rect width="900" height="600" fill="#FE0000" />
          <rect width="450" height="300" fill="#000095" />
          <polygon points={starPoints(225, 150, 112, 58, 12, -90)} fill="#FFFFFF" />
          <circle cx="225" cy="150" r="62" fill="#000095" />
          <circle cx="225" cy="150" r="50" fill="#FFFFFF" />
        </>
      );

    case 'THA':
      return (
        <>
          <rect width="900" height="100" fill="#A51931" />
          <rect y="100" width="900" height="100" fill="#F4F5F8" />
          <rect y="200" width="900" height="200" fill="#2D2A4A" />
          <rect y="400" width="900" height="100" fill="#F4F5F8" />
          <rect y="500" width="900" height="100" fill="#A51931" />
        </>
      );

    case 'AUS':
      return (
        <>
          <rect width="900" height="600" fill="#00008B" />
          <g transform="scale(0.5)">
            <rect width="900" height="600" fill="#012169" />
            <path d="M0,0 L900,600 M900,0 L0,600" stroke="#FFFFFF" strokeWidth="110" />
            <path d="M0,0 L900,600 M900,0 L0,600" stroke="#C8102E" strokeWidth="56" />
            <path d="M450,0 V600 M0,300 H900" stroke="#FFFFFF" strokeWidth="180" />
            <path d="M450,0 V600 M0,300 H900" stroke="#C8102E" strokeWidth="108" />
          </g>
          <polygon points={starPoints(225, 450, 68, 30, 7, -90)} fill="#FFFFFF" />
          <polygon points={starPoints(675, 120, 34, 15, 7, -90)} fill="#FFFFFF" />
          <polygon points={starPoints(575, 260, 34, 15, 7, -90)} fill="#FFFFFF" />
          <polygon points={starPoints(765, 235, 34, 15, 7, -90)} fill="#FFFFFF" />
          <polygon points={starPoints(675, 480, 34, 15, 7, -90)} fill="#FFFFFF" />
        </>
      );

    case 'USA':
      return (
        <>
          <rect width="900" height="600" fill="#FFFFFF" />
          {[0, 2, 4, 6, 8, 10, 12].map(row => (
            <rect
              key={row}
              y={(row * 600) / 13}
              width="900"
              height={600 / 13 + 0.6}
              fill="#B22234"
            />
          ))}
          <rect width="360" height={(7 * 600) / 13} fill="#3C3B6E" />
          <g fill="#FFFFFF">
            {[0, 1, 2, 3, 4].map(r =>
              [0, 1, 2, 3, 4, 5].map(c => (
                <circle key={`a${r}-${c}`} cx={34 + c * 58} cy={32 + r * 64} r="10" />
              )),
            )}
            {[0, 1, 2, 3].map(r =>
              [0, 1, 2, 3, 4].map(c => (
                <circle key={`b${r}-${c}`} cx={63 + c * 58} cy={64 + r * 64} r="10" />
              )),
            )}
          </g>
        </>
      );

    case 'CAN':
      return (
        <>
          <rect width="225" height="600" fill="#FF0000" />
          <rect x="225" width="450" height="600" fill="#FFFFFF" />
          <rect x="675" width="225" height="600" fill="#FF0000" />
          <path
            d="M450,115 L482,192 L528,176 L502,262 L578,242 L560,285 L605,312 L512,378 L528,415 L462,406 L462,492 L438,492 L438,406 L372,415 L388,378 L295,312 L340,285 L322,242 L398,262 L372,176 L418,192 Z"
            fill="#FF0000"
          />
        </>
      );

    case 'MEX':
      return (
        <>
          {vStripes('#006847', '#FFFFFF', '#CE1126')}
          <circle cx="450" cy="300" r="68" fill="#8C5A2B" />
          <path d="M386,336 Q450,396 514,336" fill="none" stroke="#006847" strokeWidth="16" strokeLinecap="round" />
        </>
      );

    case 'BRA':
      return (
        <>
          <rect width="900" height="600" fill="#009C3B" />
          <polygon points="450,65 825,300 450,535 75,300" fill="#FFDF00" />
          <circle cx="450" cy="300" r="132" fill="#002776" />
          <path
            d="M320,272 Q455,232 580,322"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="24"
          />
        </>
      );

    case 'ARG':
      return (
        <>
          {hStripes('#74ACDF', '#FFFFFF', '#74ACDF')}
          <circle cx="450" cy="300" r="56" fill="#F6B40E" stroke="#85340A" strokeWidth="6" />
        </>
      );

    case 'COL':
      return (
        <>
          <rect width="900" height="300" fill="#FCD116" />
          <rect y="300" width="900" height="150" fill="#003893" />
          <rect y="450" width="900" height="150" fill="#CE1126" />
        </>
      );

    case 'CUB':
      return (
        <>
          <rect width="900" height="600" fill="#002A8F" />
          <rect y="120" width="900" height="120" fill="#FFFFFF" />
          <rect y="360" width="900" height="120" fill="#FFFFFF" />
          <polygon points="0,0 460,300 0,600" fill="#CF142B" />
          <polygon points={starPoints(152, 300, 84)} fill="#FFFFFF" />
        </>
      );

    default:
      return (
        <>
          <rect width="900" height="600" fill="#101827" />
          <rect x="24" y="24" width="852" height="552" rx="36" fill="none" stroke="#334155" strokeWidth="20" />
          <text
            x="450"
            y="375"
            textAnchor="middle"
            fill="#F8FAFC"
            fontSize="230"
            fontWeight="900"
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
            letterSpacing="12"
          >
            {rawLabel.slice(0, 3) || 'TKD'}
          </text>
        </>
      );
  }
}

export function CountryFlag({ code, className, title }: CountryFlagProps) {
  const raw = (code ?? '').trim().toUpperCase();
  const normalized = raw ? normalizeCountryCode(raw, raw) : 'MAR';
  const label = title ?? `${raw || normalized} flag`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 900 600"
      role="img"
      aria-label={label}
      className={cn(
        'inline-block aspect-[3/2] shrink-0 select-none overflow-hidden rounded-[3px] ring-1 ring-black/15',
        className,
      )}
    >
      {renderFlagArtwork(normalized, raw || normalized)}
    </svg>
  );
}
