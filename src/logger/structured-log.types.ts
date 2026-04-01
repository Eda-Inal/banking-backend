export type StructuredLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface BaseLog {
  timestamp: string;
  level: StructuredLogLevel;
  service: string;
  context: string;
  message: string;
  requestId?: string;
  userId?: string;
  traceId?: string;
}

export interface StructuredLogError {
  message: string;
  stack?: string;
  code?: string;
}

export interface LogWithDetails extends BaseLog {
  details?: Record<string, unknown>;
  error?: StructuredLogError;
}
