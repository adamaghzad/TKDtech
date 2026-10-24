'use client';
import {useCallback,useEffect,useState} from 'react';
import {api} from './api';
export function useApi<T>(path?:string|null){const[data,setData]=useState<T|null>(null);const[error,setError]=useState<Error|null>(null);const[loading,setLoading]=useState(Boolean(path));const refresh=useCallback(async()=>{if(!path)return;setLoading(true);try{setData(await api<T>(path));setError(null);}catch(reason){setError(reason as Error);}finally{setLoading(false);}},[path]);useEffect(()=>{const frame=requestAnimationFrame(()=>void refresh());return()=>cancelAnimationFrame(frame);},[refresh]);return{data,error,loading,refresh,setData};}
