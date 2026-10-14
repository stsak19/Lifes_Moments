// Public, read by Booking.com: one room's taken nights as an iCal file.
// The link carries a long random token per room; nothing about the guests is in it.
//   GET /functions/v1/ical/<token>.ics
import { admin, log } from '../_shared/core.ts';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const day = (s: string) => s.replace(/-/g, '');

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });
  const url = new URL(req.url);
  const token = (url.pathname.split('/').pop() ?? '').replace(/\.ics$/i, '') || url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{36}$/.test(token)) return new Response('not found', { status: 404 });

  const { data: feed } = await admin.from('ical_feeds').select('unit').eq('export_token', token).maybeSingle();
  if (!feed) return new Response('not found', { status: 404 });
  const { data: rows, error } = await admin.rpc('ical_busy', { p_token: token });
  if (error) { log('ical_export_error', { message: error.message }); return new Response('error', { status: 500 }); }

  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Life's Moments//Availability//EL", 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'
  ];
  for (const r of (rows ?? []) as { uid: string; check_in: string; check_out: string }[]) {
    lines.push('BEGIN:VEVENT', 'UID:' + r.uid + '@lifesmoments', 'DTSTAMP:' + now,
      'DTSTART;VALUE=DATE:' + day(r.check_in), 'DTEND;VALUE=DATE:' + day(r.check_out),
      'SUMMARY:Not available', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  log('ical_export', { unit: feed.unit, events: rows?.length ?? 0 });
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="' + feed.unit + '.ics"' }
  });
});
