import express from 'express';
import config from '../config.js';
import settings from '../config/settings.json' with { type: 'json' };
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { reportsTable } from '../db/schema.js';
import { checkReport, getReportForPeriod, deleteReport } from '../src/report.js';
import wLogger from '../src/winston.js';

const router = express.Router();
const db = drizzle(config.databaseUrl);

/* GET reports api listing. */
router.get('/', (req, res, next) => {
  res.send({valid_endpoints: [
    '/get-report/:day', '/check-report/:day', '/get-report-json-for-period'
  ]});
});

/* Check report for one day 
* <report-back-end-url>/reports/check-report/<YYYY-MM-DD>
* 
* curl example:
* curl -L -X POST '<report-backend-url>/reports/check-report/<YYYY-MM-DD>' -H 'Authorization: Basic <base64>usarname:password'
*/
router.post('/check-report/:day', async (req, res, next) => {
  //wLogger.debug(JSON.stringify(req.headers, null, 2));
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const day: Date = new Date(req.params.day);
  if (!day) {
    res.status(400).send("Report day not received");
  }
  try {
    const response = await checkReport(day);
    res.json({ response });
  } catch (err) {
    next(err);
  }
})

/* Delete report for one day
* <report-back-end-url>/reports/delete-report/<YYYY-MM-DD>
* 
* curl example:
* curl -L -X POST '<report-backend-url>/reports/delete-report/<YYYY-MM-DD>' -H 'Authorization: Basic <base64>usarname:password'
*/
router.post('/delete-report/:day', async (req, res, next) => {
  //wLogger.debug(JSON.stringify(req.headers, null, 2));
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const day: Date = new Date(req.params.day);
  if (!day) {
    res.status(400).send("Report day not received");
  }
  try {
    const response = await deleteReport(day);
    res.json({ response });
  } catch (err) {
    next(err);
  }
})

/* GET single day report
* <report-back-end-url>/reports/get-report/<YYYY-MM-DD>
* 
* curl example:
* curl -L '<report-backend-url>/reports/get-report/<YYYY-MM-DD>' -H 'Authorization: Basic <base64>usarname:password'
*/
router.get('/get-report/:day', async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const day: Date = new Date(req.params.day);
  if (!day) {
    res.status(400).send("Report day not received");
  }
  const report = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.report_date, day))
    .catch((err) => {
      wLogger.error(err);
      return "There was an error with db communication.."
    })

  res.send(report);
});

/* Generate report for period
* <report-back-end-url>/reports/get-report-json-for-period + body = {stopDate, startDate}
* 
* curl example:
* curl -L -X POST '<report-backend-url>/reports/get-report-json-for-period' -H 'Authorization: Basic <base64>usarname:password' -d '{"startDate":"<YYYY-MM-DD>","stopDate":"<YYYY-MM-DD>"}'
*/
router.post('/get-report-json-for-period', async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = await getReportForPeriod(req.body.startDate, req.body.stopDate);
  res.json(report);
})

/* GET productTypeFamilyList
* <report-back-end-url>/reports/get-product-type-family-list
* 
* curl example:
* curl -L '<report-backend-url>/reports/get-product-type-family-list' -H 'Authorization: Basic <base64>usarname:password'
*/
router.get('/get-product-type-family-list', async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.send(settings.productTypeFamilyList);
});

/* GET productTypeList
* <report-back-end-url>/reports/get-product-type-list
* 
* curl example:
* curl -L '<report-backend-url>/reports/get-product-type-list' -H 'Authorization: Basic <base64>usarname:password'
*/
router.get('/get-product-type-list', async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.send(settings.productTypeList);
});

/* GET datasourcesMap
* <report-back-end-url>/reports/get-datasources-map
* 
* curl example:
* curl -L '<report-backend-url>/reports/get-datasources-map' -H 'Authorization: Basic <base64>usarname:password' 
*/
router.get('/get-datasources-map', async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // decode base64
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // check credentials
  if (username !== config.apiUsername || password !== config.apiPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.send(settings.datasourcesMap);
});

export default router;