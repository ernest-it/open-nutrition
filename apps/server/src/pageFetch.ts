// Fetch one public web page for "import from a nutrition page", safely.
//
// The URL comes from a signed-in user, so the server must not become a way to reach things
// only it can see (SSRF): localhost, the LAN, cloud metadata endpoints, other containers.
// * http(s) only, default ports only (80/443), no credentials in the URL.
// * Every resolved address must be public; the check runs inside the socket's DNS lookup,
//   so a hostname cannot resolve to a public IP for the check and a private one for the
//   connection (DNS rebinding). IP-literal hosts are checked directly.
// * Redirects are followed by hand (max 3), each hop re-validated.
// * Size and time limits; gzip/deflate/br decoded.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { MAX_MENU_PDF_BYTES } from '@open-nutrition/shared';

export class PageFetchError extends Error {}

const USER_AGENT = 'OpenNutrition (self-hosted nutrition tracker; one-off page import on behalf of a user)';
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast + reserved + broadcast
];

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === '::' || lower === '::1') return false;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false;
    return true;
  }
  return false;
}

/** dns.lookup that refuses private answers (used by the socket itself). */
const checkedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new PageFetchError('That address points to a private or local network, which the server will not open.'), '', 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

/** Parse and vet a user-supplied URL. */
export function vetUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new PageFetchError('That is not a valid web address.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PageFetchError('Only http and https links can be imported.');
  if (u.username || u.password) throw new PageFetchError('Links with a username or password are not supported.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new PageFetchError('Only links on the standard web ports can be imported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new PageFetchError('That address points to a private or local network, which the server will not open.');
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$/i.test(host)) {
    throw new PageFetchError('That address points to a private or local network, which the server will not open.');
  }
  return u;
}

export interface FetchedPage {
  bytes: Uint8Array;
  contentType: string | null;
  finalUrl: string;
}

function getOnce(u: URL, maxBytes: number): Promise<{ status: number; location: string | null; contentType: string | null; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup: checkedLookup,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, contentType: null, bytes: Buffer.alloc(0) });
        }
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new PageFetchError('That page is too large to import.'));
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => resolve({ status, location: null, contentType: (res.headers['content-type'] as string | undefined) ?? null, bytes: Buffer.concat(chunks) }));
        stream.on('error', (e) => reject(new PageFetchError(`Could not read that page (${e.message}).`)));
      },
    );
    req.on('timeout', () => req.destroy(new PageFetchError('That page took too long to load.')));
    req.on('error', (e) => reject(e instanceof PageFetchError ? e : new PageFetchError(`Could not open that page (${(e as NodeJS.ErrnoException).code ?? e.message}).`)));
    req.end();
  });
}

/** Fetch a public page (HTML/PDF/text), following up to 3 vetted redirects. */
export async function fetchPublicPage(rawUrl: string, maxBytes = MAX_MENU_PDF_BYTES): Promise<FetchedPage> {
  let u = vetUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await getOnce(u, maxBytes);
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) throw new PageFetchError('That page redirected without saying where to.');
      u = vetUrl(new URL(r.location, u).toString());
      continue;
    }
    if (r.status === 401 || r.status === 403) throw new PageFetchError('That site refused the request (it may block apps). Copy the nutrition table from your browser and paste it instead.');
    if (r.status === 404) throw new PageFetchError('That page was not found (HTTP 404). Check the link.');
    if (r.status < 200 || r.status >= 300) throw new PageFetchError(`That site answered with HTTP ${r.status}.`);
    return { bytes: new Uint8Array(r.bytes), contentType: r.contentType, finalUrl: u.toString() };
  }
  throw new PageFetchError('That page redirected too many times.');
}
