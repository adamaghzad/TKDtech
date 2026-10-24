export {};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const auth = await fetch(`${url}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(15_000) });
if (!auth.ok) throw new Error(`Supabase Auth connection failed: HTTP ${auth.status}`);
console.log('Supabase Auth: reachable');
const entities = ['tournaments', 'organizations', 'profiles', 'athletes', 'categories', 'matches', 'match_events', 'public_match_display'];
let missing = 0;
for (const entity of entities) {
  const response = await fetch(`${url}/rest/v1/${entity}?select=*&limit=0`, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) { console.log(`${entity}: MISSING`); missing++; continue; }
  if (response.ok || [401, 403].includes(response.status)) { console.log(`${entity}: present (HTTP ${response.status}; RLS/grants apply)`); continue; }
  const body = await response.text();
  throw new Error(`${entity}: unexpected HTTP ${response.status}: ${body.slice(0, 300)}`);
}
if (missing) {
  console.log(`${missing} required entities missing. Apply supabase/migrations/202610240001_initial.sql in the Supabase SQL Editor.`);
  process.exitCode = 2;
} else {
  console.log('Supabase public schema check passed. Next verify authenticated RLS and Realtime before enabling CLOUD mode.');
}
