import type { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import { bankingStructuredLogFormat } from './banking-structured-log.format';

const noisyDevContexts = new Set([
  'InstanceLoader',
  'RouterExplorer',
  'RoutesResolver',
]);

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
} as const;

function levelColor(level: string): string {
  if (level === 'error') return ansi.red;
  if (level === 'warn') return ansi.yellow;
  if (level === 'debug') return ansi.magenta;
  return ansi.green;
}

function colorizeKey(key: string): string {
  return `${ansi.bold}${ansi.brightCyan}${key}${ansi.reset}`;
}

function colorizeStatusCode(value: unknown): string {
  const code = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(code)) return compactValue(value);
  const color = code >= 500 ? ansi.red : code >= 400 ? ansi.yellow : ansi.green;
  return `${ansi.bold}${color}${code}${ansi.reset}`;
}

function pushKeyValue(parts: string[], key: string, value: unknown): void {
  const displayValue = key === 'statusCode' ? colorizeStatusCode(value) : compactValue(value);
  parts.push(`${colorizeKey(key)}=${displayValue}`);
}

function compactValue(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value.includes(' ') ? `"${value}"` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const devReadableFormat = winston.format.printf((info) => {
  const ts = typeof info.timestamp === 'string' ? info.timestamp : new Date().toISOString();
  const level = typeof info.level === 'string' ? info.level : 'info';
  const message = typeof info.message === 'string' ? info.message : compactValue(info.message);
  const context = typeof info.context === 'string' && info.context ? `[${info.context}] ` : '';

  const lines: string[] = [
    `${ansi.gray}${ts}${ansi.reset} ${ansi.bold}${levelColor(level)}[${level}]${ansi.reset}: ${ansi.bold}${ansi.blue}${context}${ansi.reset}${message}`,
  ];
  const parts: string[] = [];
  const detailKeys = new Set<string>();

  const details =
    info.details && typeof info.details === 'object' && !Array.isArray(info.details)
      ? (info.details as Record<string, unknown>)
      : undefined;

  if (details) {
    for (const [k, v] of Object.entries(details)) {
      detailKeys.add(k);
      pushKeyValue(parts, k, v);
    }
  }
  if (info.requestId && !detailKeys.has('requestId')) {
    pushKeyValue(parts, 'requestId', info.requestId);
  }
  if (info.traceId && !detailKeys.has('traceId')) {
    pushKeyValue(parts, 'traceId', info.traceId);
  }
  if (info.userId && !detailKeys.has('userId')) {
    pushKeyValue(parts, 'userId', info.userId);
  }

  const err = info.error as unknown;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const errObj = err as Record<string, unknown>;
    if (errObj.message) parts.push(`${ansi.red}error${ansi.reset}=${compactValue(errObj.message)}`);
    if (errObj.code) parts.push(`${ansi.red}code${ansi.reset}=${compactValue(errObj.code)}`);
  }

  if (parts.length > 0) {
    lines.push(`  ${parts.join(' ')}`);
  }

  return lines.join('\n');
});

export function buildWinstonModuleOptions(isDevelopment: boolean): WinstonModuleOptions {
  return {
    level: isDevelopment ? 'debug' : 'info',
    transports: [
      new winston.transports.Console({
        format: isDevelopment
          ? winston.format.combine(
              winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
              winston.format.errors({ stack: true }),
              winston.format((info) =>
                noisyDevContexts.has(String(info.context)) ? false : info,
              )(),
              devReadableFormat,
            )
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.errors({ stack: true }),
              bankingStructuredLogFormat(),
            ),
      }),
    ],
  };
}
