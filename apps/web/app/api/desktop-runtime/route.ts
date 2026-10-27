export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { desktopInstance: process.env.TKD_DESKTOP_INSTANCE_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
