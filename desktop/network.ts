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
