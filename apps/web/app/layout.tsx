import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { PwaRegistration } from '@/components/pwa-registration';

export const metadata: Metadata = {
  title: { default: 'TKD Scoring · TKDTech', template: '%s · TKD Scoring' },
  description: 'Tournament management and real-time Taekwondo Kyorugi scoring by ADAM AGHZAF — TKDTech Sports Management.',
  applicationName: 'TKD Scoring', manifest: '/manifest.webmanifest',
  icons: { icon: '/assets/icon.svg' }
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, themeColor: '#080B12' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body><I18nProvider><ToastProvider>{children}<PwaRegistration /></ToastProvider></I18nProvider></body></html>;
}
