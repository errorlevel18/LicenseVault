// Simple logger wrapper for client-side logging
// Levels: debug, info, warn, error

const logLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogLevel = keyof typeof logLevels;

const isValidLogLevel = (value: string | null | undefined): value is LogLevel => {
  return !!value && value in logLevels;
};

const viteEnv = ((import.meta as ImportMeta & {
  env?: {
    DEV?: boolean;
    VITE_CLIENT_LOG_LEVEL?: string;
  };
}).env);

const getConfiguredLogLevel = (): LogLevel => {
  const envLevel = viteEnv?.VITE_CLIENT_LOG_LEVEL?.toLowerCase();
  const storageLevel = typeof window !== 'undefined'
    ? window.localStorage.getItem('licensevault:log-level')?.toLowerCase()
    : undefined;
  const configuredLevel = storageLevel ?? envLevel;

  if (isValidLogLevel(configuredLevel)) {
    return configuredLevel;
  }

  return viteEnv?.DEV ? 'warn' : 'error';
};

const currentLevel = getConfiguredLogLevel();

const shouldLog = (level: LogLevel): boolean => {
  return logLevels[level] >= logLevels[currentLevel];
};

const formatMessage = (level: string, message: string, ...args: any[]): string => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
};

const logger = {
  debug: (message: string, ...args: any[]) => {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message), ...args);
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message), ...args);
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message), ...args);
    }
  },
  
  error: (message: string, ...args: any[]) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message), ...args);
    }
  }
};

export default logger;