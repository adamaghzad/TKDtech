'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {Brand} from '@/components/brand';
import {post} from '@/lib/api';
export default function Home(){const router=useRouter();useEffect(()=>{post('/api/v1/auth/demo').then(()=>router.replace('/dashboard')).catch(()=>router.replace('/login'));},[router]);return<main className="subtle-grid flex min-h-screen items-center justify-center bg-background"><div className="text-center"><Brand className="justify-center"/><div className="mx-auto mt-8 size-8 animate-spin rounded-full border-2 border-line border-t-primary"/><p className="mt-4 text-sm text-muted">Opening tournament control…</p></div></main>;}
