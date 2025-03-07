// src/utils/logger.ts
import chalk from 'chalk';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level: LogLevel;
  timestamps: boolean;
  colors: boolean;
}

class Logger {
  private options: LoggerOptions = {
    level: 'info',
    timestamps: true,
    colors: true
  };

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(options?: Partial<LoggerOptions>) {
    this.configure(options || {});
  }

  configure(options: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Enable debug mode - shorthand for setting level to 'debug'
   */
  enableDebug(): void {
    this.options.level = 'debug';
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.options.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.options.timestamps ? `[${new Date().toISOString()}] ` : '';
    const prefix = `[${level.toUpperCase()}]`;

    if (!this.options.colors) {
      return `${timestamp}${prefix} ${message}`;
    }

    // Apply colors
    const colorizedPrefix = (() => {
      switch (level) {
        case 'debug': return chalk.blue(prefix);
        case 'info': return chalk.green(prefix);
        case 'warn': return chalk.yellow(prefix);
        case 'error': return chalk.red(prefix);
      }
    })();

    const colorizedTimestamp = chalk.gray(timestamp);
    return `${colorizedTimestamp}${colorizedPrefix} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  /**
   * Log a divider line to visually separate log sections
   */
  divider(level: LogLevel = 'info'): void {
    if (this.shouldLog(level)) {
      const divider = '-'.repeat(80);
      console.log(this.options.colors ? chalk.gray(divider) : divider);
    }
  }

  /**
   * Logs a stringified object with proper indentation
   */
  object(level: LogLevel, label: string, obj: any): void {
    if (this.shouldLog(level)) {
      let output: string;
      try {
        output = JSON.stringify(obj, null, 2);
      } catch (error) {
        output = `[Object could not be stringified: ${error}]`;
      }

      this[level](`${label}:\n${output}`);
    }
  }
}

// Export a singleton instance
export const logger = new Logger({
  level: process.env.LOG_LEVEL as LogLevel || 'info',
  timestamps: true,
  colors: true
});