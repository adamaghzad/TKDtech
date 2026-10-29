import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  return a === 10
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
}

export function lanUrls(port: number, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4(entry.address)) continue;
      addresses.add(`http://${entry.address}:${port}`);
    }
  }
  return [...addresses].sort((left, right) => {
    const leftLinkLocal = left.includes('//169.254.');
    const rightLinkLocal = right.includes('//169.254.');
    return Number(leftLinkLocal) - Number(rightLinkLocal) || left.localeCompare(right);
  });
}

export function preferredLanUrl(port: number, interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  return lanUrls(port, interfaces)[0] ?? null;
}

function requestOrigin(host: string | undefined): URL | null {
  if (!host) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function pairingOrigin(host: string | undefined, options: {
  port: number;
  mode?: string;
  configuredUrl?: string;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): string {
  const request = requestOrigin(host);
  const configured = configuredOrigin(options.configuredUrl);
  if ((options.mode ?? 'LOCAL') !== 'LOCAL') {
    return configured ?? request?.origin ?? `http://127.0.0.1:${options.port}`;
  }

  // Hosted Northflank deployments also use LOCAL mode for SQLite. An explicit
  // HTTPS public origin must win over container/private interfaces, which judge
  // devices cannot reach. Desktop launchers configure HTTP LAN origins instead.
  if (configured?.startsWith('https://')) return configured;

  // A request that arrived over a private LAN address proves which address the
  // operator actually used, so preserve it instead of a stale startup value.
  if (request && isPrivateIpv4(request.hostname)) return request.origin;

  // When the operator uses localhost, resolve the current interfaces at pairing
  // time. DHCP, hotspot and router changes must not leave an old IP in new links.
  const currentLan = preferredLanUrl(options.port, options.interfaces);
  if (currentLan) return currentLan;

  return configured ?? request?.origin ?? `http://127.0.0.1:${options.port}`;
}
