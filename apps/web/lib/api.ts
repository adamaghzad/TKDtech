'use client';
import{createClientUuid}from'@/lib/uuid';
export class ApiRequestError extends Error{constructor(public code:string,message:string,public status:number,public details?:unknown){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});const body=await response.json().catch(()=>null) as {data?:T;error?:{code:string;message:string;details?:unknown}}|null;if(!response.ok)throw new ApiRequestError(body?.error?.code||'REQUEST_FAILED',body?.error?.message||`Request failed (${response.status})`,response.status,body?.error?.details);return body?.data as T;}
export function post<T>(path:string,payload:unknown={}){return api<T>(path,{method:'POST',body:JSON.stringify(payload),headers:{'Idempotency-Key':createClientUuid()}});}
export function patch<T>(path:string,payload:unknown){return api<T>(path,{method:'PATCH',body:JSON.stringify(payload)});}
