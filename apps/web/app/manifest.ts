import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'TKD Scoring by ADAM AGHZAF', short_name: 'TKD Scoring', description: 'Offline-capable Taekwondo tournament management and scoring.', start_url: '/', display: 'standalone', background_color: '#080B12', theme_color: '#080B12', orientation: 'any', icons: [{ src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
}
