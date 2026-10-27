import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { isPrivateIpv4, lanUrls, preferredLanUrl } from '../../desktop/network';

function entry(address: string, internal = false): NetworkInterfaceInfo {
  return { address, internal, family: 'IPv4' } as NetworkInterfaceInfo;
}

describe('desktop LAN selection', () => {
  it.each(['10.0.0.8', '192.168.1.20', '172.16.4.2', '172.31.255.255', '169.254.10.2'])('accepts private or link-local IPv4 %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(true);
  });

  it.each(['127.0.0.1', '172.15.0.1', '172.32.0.1', '8.8.8.8', 'not-an-ip', '999.1.1.1'])('rejects non-LAN address %s', (address) => {
    expect(isPrivateIpv4(address)).toBe(false);
  });

  it('filters loopback, public and duplicate addresses and puts link-local last', () => {
    const urls = lanUrls(3000, {
      ethernet: [entry('169.254.20.4'), entry('192.168.1.20'), entry('8.8.8.8'), entry('192.168.1.20')],
      wifi: [entry('10.0.0.8'), entry('127.0.0.1', true)],
    });
    expect(urls).toEqual(['http://10.0.0.8:3000', 'http://192.168.1.20:3000', 'http://169.254.20.4:3000']);
    expect(preferredLanUrl(3000, { wifi: [entry('192.168.1.50')] })).toBe('http://192.168.1.50:3000');
  });

  it('does not deliberately produce an unusable public pairing URL', () => {
    expect(lanUrls(3000, { wifi: [entry('8.8.8.8'), entry('127.0.0.1', true)] })).toEqual([]);
    expect(preferredLanUrl(3000, {})).toBeNull();
  });
});
