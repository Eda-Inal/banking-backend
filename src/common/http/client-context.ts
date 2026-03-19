import type { Request } from 'express';

function firstIpFromXForwardedFor(value: string): string | undefined {
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function maskIp(ip: string): string {
  const normalized = normalizeIp(ip);

  const v4 = normalized.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (v4) {
    return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  }

  const parts = normalized.split(':').filter(Boolean);
  if (parts.length > 0) {
    return `${parts.slice(0, 4).join(':')}::`;
  }

  return normalized;
}

export function getClientIpMasked(req: Request): string | undefined {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return maskIp(cf.trim());

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const ip = firstIpFromXForwardedFor(xff.trim());
    if (ip) return maskIp(ip);
  }

  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim())
    return maskIp(xRealIp.trim());

  if (typeof req.ip === 'string' && req.ip.trim()) return maskIp(req.ip.trim());

  const socketIp = req.socket?.remoteAddress;
  if (typeof socketIp === 'string' && socketIp.trim())
    return maskIp(socketIp.trim());

  return undefined;
}

export function getUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua.trim() ? ua.trim() : undefined;
}