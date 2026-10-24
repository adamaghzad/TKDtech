'use client';
import {createContext,useContext} from 'react';
import type {Bootstrap} from '@/lib/types';
export interface AdminContextValue{data:Bootstrap;selectedTournamentId:string;selectTournament:(id:string)=>void;refresh:()=>Promise<void>}
export const AdminContext=createContext<AdminContextValue|null>(null);
export function useAdmin(){const value=useContext(AdminContext);if(!value)throw new Error('Admin context is unavailable.');return value;}
