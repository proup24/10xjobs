import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`blocked address for ${host}`);
    this.name = 'BlockedAddressError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['192.0.2.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
blocked.addSubnet('::', 96, 'ipv6');
blocked.addSubnet('64:ff9b::', 96, 'ipv6');
blocked.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64
blocked.addSubnet('100::', 64, 'ipv6'); // discard-only
blocked.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');

const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isBlockedAddress(ip: string): boolean {
  const mapped = MAPPED.exec(ip);
  if (mapped) return isBlockedAddress(mapped[1]);
  const family = isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export async function resolvePublic(
  host: string,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<{ address: string; family: 4 | 6 }> {
  const results = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    lookup(host, { all: true }, (err, addresses) =>
      err ? reject(err) : resolve(addresses),
    );
  });
  if (
    results.length === 0 ||
    results.some((r) => isBlockedAddress(r.address))
  ) {
    throw new BlockedAddressError(host);
  }
  const first = results[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
