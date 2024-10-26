import path from 'node:path'

import pc from 'picocolors'

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const

/** Custom logger interface. */
export interface Logger {
  /** Prints a trace message  */
  trace?: (message: string) => void
  /** Prints a debug message  */
  debug?: (message: string) => void
  /** Prints an information message  */
  info?: (message: string) => void
  /** Prints a warning message  */
  warn?: (message: string) => void
  /** Prints an error message  */
  error?: (message: string) => void
  silent?: (message: string) => void
}

export const defaultLogger = {
  trace(msg) {
    // eslint-disable-next-line no-console
    console.trace(msg)
  },

  debug(msg) {
    // eslint-disable-next-line no-console
    console.debug(msg)
  },

  warn(msg) {
    console.warn(pc.yellow(msg))
  },

  error(msg) {
    console.error(pc.bold(pc.red(msg)))
  },

  info(msg) {
    // eslint-disable-next-line no-console
    console.info(pc.bold(pc.blue(msg)))
  },

  silent() {},
} satisfies Logger

export type LogLevel = typeof LOG_LEVELS[number]

export function createLogger(logLevel: LogLevel) {
  const logLevelIdx = LOG_LEVELS.indexOf(logLevel)

  return LOG_LEVELS.reduce((logger: Partial<Logger>, type, index) => {
    if (index >= logLevelIdx) {
      logger[type] = defaultLogger[type]
    }
    else {
      logger[type] = defaultLogger.silent
    }
    return logger
  }, {})
}

export function isSubpath(basePath: string, currentPath: string) {
  return !path.relative(basePath, currentPath).startsWith('..')
}
