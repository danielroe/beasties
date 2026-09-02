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

const defaultLogger = {
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

export function createLogger(logLevel: LogLevel): Logger {
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

/**
 * Scope over which repeated warnings are suppressed.
 *
 * - **"process":** _(default)_ suppress messages already emitted anywhere in this process within the last minute.
 * - **"instance":** suppress messages already emitted by this Beasties instance.
 * - **false:** emit every message.
 */
export type DedupeScope = 'process' | 'instance' | false

const DEDUPE_WINDOW_MS = 60_000
const DEDUPE_MAX_ENTRIES = 500

const processSeen = new Map<string, number>()

/** Clear the process-wide record of emitted messages. */
export function resetMessageDeduplication(): void {
  processSeen.clear()
}

/**
 * Wrap a logger so that identical `warn`/`error` messages are only emitted once
 * per scope. Server-side rendering constructs a Beasties instance per request,
 * so the default scope is the process.
 */
export function createDeduplicatingLogger(logger: Logger, scope: DedupeScope): Logger {
  if (scope === false) {
    return logger
  }

  const seen = scope === 'process' ? processSeen : new Map<string, number>()

  const shouldEmit = (level: string, message: string) => {
    const key = `${level}:${message}`
    const now = Date.now()
    const last = seen.get(key)
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
      return false
    }
    if (seen.size >= DEDUPE_MAX_ENTRIES) {
      seen.clear()
    }
    seen.set(key, now)
    return true
  }

  const deduped: Logger = { ...logger }

  for (const level of ['warn', 'error'] as const) {
    const original = logger[level]
    if (!original) {
      continue
    }
    deduped[level] = (message: string) => {
      if (shouldEmit(level, message)) {
        original.call(logger, message)
      }
    }
  }

  return deduped
}

export function isSubpath(basePath: string, currentPath: string): boolean {
  return !path.relative(basePath, currentPath).startsWith('..')
}
