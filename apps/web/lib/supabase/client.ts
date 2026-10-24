import{createBrowserClient}from'@supabase/ssr';import type{SupabaseClient}from'@supabase/supabase-js';
let client:SupabaseClient|null=null;
export function isCloudConfigured(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);}
export function getSupabaseBrowserClient(){if(client)return client;const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)throw new Error('Supabase browser environment is not configured.');client=createBrowserClient(url,key);return client;}
