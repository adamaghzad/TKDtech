'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '@/components/brand';
import { api, post } from '@/lib/api';
import type { DesktopLicenseStatus } from '@/lib/licensing';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const open = async () => {
      try {
        const license = await api<DesktopLicenseStatus>('/api/v1/licensing/status');
        if (license.required && license.status !== 'ACTIVE') {
          router.replace('/activation');
          return;
        }
      } catch {
        // Preserve the existing authentication recovery path if the status endpoint
        // is temporarily unavailable while the local frontend is starting.
      }
      post('/api/v1/auth/demo').then(() => router.replace('/dashboard')).catch(() => router.replace('/login'));
    };
    void open();
  }, [router]);

  return <main className="subtle-grid flex min-h-screen items-center justify-center bg-background"><div className="text-center"><Brand className="justify-center" /><div className="mx-auto mt-8 size-8 animate-spin rounded-full border-2 border-line border-t-primary" /><p className="mt-4 text-sm text-muted">Opening tournament control…</p></div></main>;
}
