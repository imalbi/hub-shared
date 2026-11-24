import net from 'node:net';

const ipv4BlockList = new net.BlockList();

// IPv4 non-public / reserved ranges
ipv4BlockList.addSubnet('0.0.0.0', 8, 'ipv4');
ipv4BlockList.addSubnet('10.0.0.0', 8, 'ipv4'); // guard-private: allow Reserved network range or hostname
ipv4BlockList.addSubnet('100.64.0.0', 10, 'ipv4'); // guard-private: allow Reserved network range or hostname
ipv4BlockList.addSubnet('127.0.0.0', 8, 'ipv4');
ipv4BlockList.addSubnet('169.254.0.0', 16, 'ipv4'); // guard-private: allow Reserved network range or hostname
ipv4BlockList.addSubnet('172.16.0.0', 12, 'ipv4'); // guard-private: allow Reserved network range or hostname
ipv4BlockList.addSubnet('192.0.0.0', 24, 'ipv4');
ipv4BlockList.addSubnet('192.0.2.0', 24, 'ipv4');
ipv4BlockList.addSubnet('192.168.0.0', 16, 'ipv4'); // guard-private: allow Reserved network range or hostname
ipv4BlockList.addSubnet('198.18.0.0', 15, 'ipv4');
ipv4BlockList.addSubnet('198.51.100.0', 24, 'ipv4');
ipv4BlockList.addSubnet('203.0.113.0', 24, 'ipv4');
ipv4BlockList.addSubnet('224.0.0.0', 4, 'ipv4');
ipv4BlockList.addSubnet('240.0.0.0', 4, 'ipv4');

const ipv6BlockList = new net.BlockList();

// IPv6 loopback, unspecified, ULA, link/site-local, multicast, mapped/compatible/NAT64/SIIT/6to4
ipv6BlockList.addAddress('::1', 'ipv6');
ipv6BlockList.addAddress('::', 'ipv6');
ipv6BlockList.addSubnet('fc00::', 7, 'ipv6'); // guard-private: allow Reserved network range or hostname
ipv6BlockList.addSubnet('fe80::', 10, 'ipv6'); // guard-private: allow Reserved network range or hostname
ipv6BlockList.addSubnet('fec0::', 10, 'ipv6');
ipv6BlockList.addSubnet('ff00::', 8, 'ipv6');
ipv6BlockList.addSubnet('::ffff:0:0', 96, 'ipv6');
ipv6BlockList.addSubnet('::ffff:0:0:0', 96, 'ipv6');
ipv6BlockList.addSubnet('::', 96, 'ipv6');
ipv6BlockList.addSubnet('64:ff9b::', 96, 'ipv6');
ipv6BlockList.addSubnet('64:ff9b:1::', 48, 'ipv6');
ipv6BlockList.addSubnet('2002::', 16, 'ipv6');

const LOCAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.lan',
  '.home',
  '.home.arpa',
  '.internal',
  '.ts.net',
  '.fritz.box',
  '.arpa',
];

const PUBLIC_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip
    .replace(/^\[|\]$/gu, '')
    .split('%')[0]
    ?.trim();
  if (!clean) return true;
  const version = net.isIP(clean);
  if (version === 0) return true;
  try {
    return version === 4 ? ipv4BlockList.check(clean, 'ipv4') : ipv6BlockList.check(clean, 'ipv6');
  } catch {
    return true;
  }
}

export function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.trim().replace(/\.$/u, '').toLowerCase();
  if (!normalized || normalized.length > 253) return false;
  if (net.isIP(normalized.replace(/^\[|\]$/gu, '')) !== 0) return false;
  if (normalized === 'localhost' || normalized === 'fritz.box') return false; // guard-private: allow Reserved network range or hostname
  if (LOCAL_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  if (!normalized.includes('.')) return false;
  return PUBLIC_HOSTNAME.test(normalized);
}
