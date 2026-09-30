import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import config from '../config.js';

const wLogger = winston.createLogger({
  level: config.nodeEnv == 'production' ? config.logLevel : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
  transports: [
    new DailyRotateFile({ 
      filename: path.join(config.reportsLogFolder, 'reports-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: false,
      maxFiles: '365d'
    }),
  ],
});
// Development logging in console
if (config.nodeEnv !== 'production') {
  wLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level}: ${message}`;
      })
    ),
  }));
}

export default wLogger;