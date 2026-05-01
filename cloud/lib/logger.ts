/**
 * Logging Utility for Proxy and Load Balancer
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

class Logger {
  private isDev = process.env.NODE_ENV === 'development';
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console output in development
    if (this.isDev) {
      const prefix = `[${entry.timestamp}] [${level}]`;
      if (metadata) {
        console.log(prefix, message, metadata);
      } else {
        console.log(prefix, message);
      }
    }
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.log(LogLevel.WARN, message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.log(LogLevel.ERROR, message, metadata);
  }

  getLogs(level?: LogLevel, limit: number = 100): LogEntry[] {
    let filtered = this.logs;
    if (level) {
      filtered = filtered.filter((log) => log.level === level);
    }
    return filtered.slice(-limit);
  }

  clearLogs() {
    this.logs = [];
  }
}

export const logger = new Logger();
