import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { isPrivateIpv4, lanUrls, pairingOrigin, preferredLanUrl } from '../../apps/local-server/src/network';

function entry(address: string, internal = false): NetworkInterfaceInfo {
  return { address, internal, family: 'IPv4' } as NetworkInterfaceInfo;
}

describe('offline LAN addresses and pairing origins', () => {
  it('uses private router addresses without requiring a gateway or Internet', () => {
    const interfaces = { wifi: [entry('192.168.0.50')] };
    expect(preferredLanUrl(3000, interfaces)).toBe('http://192.168.0.50:3000');
    expect(pairingOrigin('127.0.0.1:3000', { port: 3000, interfaces })).toBe('http://192.168.0.50:3000');
  });

  it('replaces a stale startup address when pairing from localhost', () => {
    expect(pairingOrigin('127.0.0.1:3000', {
      port: 3000,
      configuredUrl: 'http://192.168.0.100:3000',
      interfaces: { wifi: [entry('192.168.0.50')] },
    })).toBe('http://192.168.0.50:3000');
  });

  it('preserves the private LAN address that actually served the operator', () => {
    expect(pairingOrigin('192.168.0.51:3000', {
      port: 3000,
      configuredUrl: 'http://192.168.0.100:3000',
      interfaces: { wifi: [entry('192.168.0.50')] },
    })).toBe('http://192.168.0.51:3000');
  });

  it('filters public, loopback and duplicate interface addresses and puts link-local last', () => {
    expect(lanUrls(3000, {
      ethernet: [entry('169.254.20.4'), entry('192.168.1.20'), entry('8.8.8.8'), entry('192.168.1.20')],
      wifi: [entry('10.0.0.8'), entry('127.0.0.1', true)],
    })).toEqual(['http://10.0.0.8:3000', 'http://192.168.1.20:3000', 'http://169.254.20.4:3000']);
  });

  it('does not trust an arbitrary public Host header for local pairing', () => {
    expect(pairingOrigin('example.com:3000', {
      port: 3000,
      configuredUrl: 'http://192.168.0.100:3000',
      interfaces: { wifi: [entry('192.168.0.50')] },
    })).toBe('http://192.168.0.50:3000');
  });

  it('retains configured-origin behavior outside local mode', () => {
    expect(pairingOrigin('127.0.0.1:3000', {
      port: 3000,
      mode: 'CLOUD',
      configuredUrl: 'https://score.example.com/base',
      interfaces: { wifi: [entry('192.168.0.50')] },
    })).toBe('https://score.example.com');
  });

  it.each(['10.0.0.8', '192.168.1.20', '172.16.4.2', '172.31.255.255', '169.254.10.2'])('accepts private or link-local IPv4 %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(true);
  });

  it.each(['127.0.0.1', '172.15.0.1', '172.32.0.1', '8.8.8.8', 'not-an-ip', '999.1.1.1'])('rejects non-LAN address %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(false);
  });
});
