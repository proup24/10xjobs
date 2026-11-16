import { describe, expect, it } from 'vitest';
import type dns from 'node:dns';
import {
  BlockedAddressError,
  isBlockedAddress,
  resolvePublic,
} from './address';

const stub = (...addrs: string[]): typeof dns.lookup =>
  ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) =>
    cb(
      null,
      addrs.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    )) as never;

describe('isBlockedAddress', () => {
  it.each([
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.7',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1',
    '::ffff:8.8.8.8',
  ])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('resolvePublic', () => {
  it('returns the first public address', async () => {
    await expect(resolvePublic('a.test', stub('8.8.8.8'))).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });

  it('refuses a host when any resolved address is private', async () => {
    await expect(
      resolvePublic('a.test', stub('8.8.8.8', '10.0.0.5')),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuses a host with no results', async () => {
    await expect(resolvePublic('a.test', stub())).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
  });
});
