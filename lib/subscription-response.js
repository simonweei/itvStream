import { exportPlaylist } from './m3u.js';

// Public subscription downloads only; never apply these headers to admin APIs.
export const subscriptionHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Cache-Control': 'no-store',
};

export function subscriptionResponse(request, text, format) {
  const bytes = new TextEncoder().encode(exportPlaylist(text, format === 'm3u8' ? 'm3u' : format));
  const length = bytes.byteLength;
  const headers = new Headers({
    ...subscriptionHeaders,
    'Content-Type': `${format === 'json' ? 'application/json' : 'text/plain'}; charset=utf-8`,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  // HEAD describes the full GET representation, including its UTF-8 byte size.
  if (request.method === 'HEAD') return new Response(null, { headers });

  const range = request.headers.get('range');
  // No validators are issued: an If-Range request must receive the full file.
  const match = !request.headers.has('if-range') && range && /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
    const end = match[1] ? (match[2] ? Number(match[2]) : length - 1) : length - 1;
    // Malformed reversed ranges are ignored; valid but unsatisfiable ranges get 416.
    if (!match[1] || !match[2] || end >= start) {
      if (start >= length) {
        headers.set('Content-Range', `bytes */${length}`);
        headers.set('Content-Length', '0');
        return new Response(null, { status: 416, headers });
      }
      const last = Math.min(end, length - 1);
      headers.set('Content-Range', `bytes ${start}-${last}/${length}`);
      headers.set('Content-Length', String(last - start + 1));
      return new Response(bytes.slice(start, last + 1), { status: 206, headers });
    }
  }
  // Unknown units, malformed and multiple ranges fall back to a complete GET.
  return new Response(bytes, { headers });
}
