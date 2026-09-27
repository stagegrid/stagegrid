import pino, { type Logger } from 'pino'

import type { Config } from './config/config'

export function createLogger(config: Pick<Config, 'logLevel'>, pretty: boolean): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.token'],
      remove: true,
    },
    ...(pretty
      ? {
          transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
        }
      : {}),
  })
}
