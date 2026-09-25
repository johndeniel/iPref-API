import 'winston-daily-rotate-file';
import type { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

interface LogLine {
  level: string;
  message: unknown;
  timestamp?: unknown;
  context?: unknown;
  requestId?: unknown;
  clientIp?: unknown;
  boundedContext?: unknown;
}

const toTag = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : '-';

const toContext = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : 'App';

const lineFormat = winston.format.printf(info => {
  const line = info as unknown as LogLine;
  const timestamp = typeof line.timestamp === 'string' ? line.timestamp : '-';
  const level = line.level.toUpperCase();
  return (
    `${timestamp} [${process.pid}] [${toTag(line.requestId)}] ` +
    `[${toTag(line.clientIp)}] [${toTag(line.boundedContext)}] ` +
    `${level} [${toContext(line.context)}] - ${String(line.message)}`
  );
});

export const loggerConfig: WinstonModuleOptions = {
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    lineFormat,
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      filename: 'logs/ipref-api-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '1g',
    }),
  ],
};
