import config from './config.js';
import createError from 'http-errors';
import express from 'express';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import wLogger from './src/winston.js';
import { fileURLToPath } from 'url';

import indexRouter from './routes/index.js';
import reportsRouter from './routes/reports.js';
import cron from 'node-cron';
import { checkReport } from './src/report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var app = express();

// Setup cors
wLogger.info("Environment is set to: " + config.nodeEnv);
if (config.nodeEnv.includes('dev')) {
  app.use(cors({ origin: true, credentials: true }));
} else {
  app.use(cors({
    origin: config.allowedOriginUrls,
    credentials: true,
  }));
  app.use((req, res, next) => {
  if (!req.ip || !config.allowedOriginUrls.includes(req.ip)) {
    wLogger.error("Request from unauthorized IP: " + (req.ip ? req.ip : "unknown"));
    return res.sendStatus(403);
  }
  next();
});
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Setup api logger
app.use(
  morgan('[:method :url :status :response-time ms', {
    stream: {
      write: (message: string) => wLogger.http(message.trim())
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/reports', reportsRouter);


// Setup cron schedule
cron.schedule(config.reportGenerationSchedule, async () => {
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().slice(0, 10);
  wLogger.info("Run scheduled generation of daily report for date '" + yesterday + "'");
  checkReport(new Date(yesterday));
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// error handler
app.use((err: any, req: any, res: any, next: any) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env').includes('dev') ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error', {
    title: 'error',
    message: err.message,
    error: err
  });
});

export default app;
