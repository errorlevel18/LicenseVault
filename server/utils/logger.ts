import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Use pino-pretty only in development; structured JSON logs in production
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: "dd-mm-yyyy HH:MM:ss",
            ignore: "pid,hostname"
          },
        },
      }),
});

export default logger;