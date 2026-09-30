import config from '../config.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { reportsTable } from '../db/schema.js';
import fs from 'fs';
import path from 'path';
import wLogger from './winston.js';
import { eq, between } from 'drizzle-orm';
import settings from '../config/settings.json' with { type: 'json' };
import { ReportError, ReportContent, RetrievedStatsObj, DistributedStatsObj, BandwidthRetrievedStatsObj, BandwidthDistributedStatsObj, ReportErrorObj } from '../global_types.js';

type Report = typeof reportsTable.$inferInsert;

const db = drizzle(config.databaseUrl);
const datasourcesMap = settings.datasourcesMap;
const productTypeList = settings.productTypeList;

const productTypeLabelList = productTypeList.map(el => el.label);
const productTypeListPosition = Object.fromEntries(productTypeLabelList.map((v, i) => [v, i]));

const toRegex = (pattern: string) =>
  new RegExp(
    pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape
      .replace(/(\\\.+)/g, m => `.{${m.length - 1}}`) // dots → wildcard
    + "\\S*"
  );

async function checkReport(date: Date): Promise<string> {
  if (typeof date === 'string') {
    date = new Date(date);
  }
  wLogger.info("Checking Report for date '" + getDateStr(date) + "'");

  // Get report error from db with date
  const existing = await db
    .select({
      report_error: reportsTable.report_error
    })
    .from(reportsTable)
    .where(eq(reportsTable.report_date, date))
    .limit(1);

  if (existing.length === 0 || existing[0].report_error !== null) {
    if (existing.length === 0) {
      wLogger.info("No report found on db for date '" + getDateStr(date) + "'. Generating");
    } else {
      wLogger.warn("A report is present in the db for date '" + getDateStr(date) + "', but has errors. Trying to generate again.");
    }
    // get single day report
    const report = await getReportForDate(new Date(getDateStr(date)));

    // insert report in db
    const res = await db
      .insert(reportsTable)
      .values(report)
      .onConflictDoUpdate({
        target: reportsTable.report_date,
        set: report
      })
      .returning({ id: reportsTable.id, report_date: reportsTable.report_date, report_error: reportsTable.report_error });

    if (res.length) {
      if (res[0].hasOwnProperty("report_error")) {
        let status = "none";
        let errMsg: string[] = [];
        res[0].report_error?.forEach((reportObj: ReportErrorObj) => {
          wLogger.error("Report for date " + getDateStr(date) + " contains errors: " + JSON.stringify(reportObj, null, 2));
          //errMsg = Object.values(reportObj)[0];
          errMsg.push(reportObj.errorMessage); 
          if (reportObj.errorType === "warning") {
            status = "warning";
          } else if (reportObj.errorType === "error") {
            status = "error";
          } else if (reportObj.errorType === "missing") {
            status = "missing";
          } else {
            status = "unknown";
          }
        });
        if (status == "warning") {
          wLogger.warn("There were problems getting report for date '" + getDateStr(date) + "': " + JSON.stringify(errMsg, null, 2));
          wLogger.info("The report for date '" + getDateStr(date) + "' with ID: " + res[0].id + " has been updated in DB with WARNINGS");
          return "Report for date '" + getDateStr(date) + "' has been inserted with WARNINGS into the DB";
        } else if (status == "error") {
          wLogger.error("There were errors getting report for date '" + getDateStr(date) + "': " + JSON.stringify(errMsg, null, 2));
          wLogger.info("The report for date '" + getDateStr(date) + "' with ID: " + res[0].id + " has been updated in DB with ERRORS");
          return "Report for date '" + getDateStr(date) + "' has been inserted with ERRORS into the DB";
        } else if (status == "missing") {
          wLogger.error("There were missing data getting report for date '" + getDateStr(date) + "': " + JSON.stringify(errMsg, null, 2));
          return "Report for date '" + getDateStr(date) + "' has been inserted with MISSINGS into the DB";
        } else if (status == "none") {
          wLogger.info("A new report for date '" + getDateStr(date) + "' has been inserted in DB, with ID: " + res[0].id);
          return "Report for date '" + getDateStr(date) + "' has been correctly inserted into the DB";
        } else {
          wLogger.error("Status: " + status);
          wLogger.error("There were unknown errors getting report for date '" + getDateStr(date) + "': " + JSON.stringify(errMsg, null, 2));
          wLogger.info("The report for date '" + getDateStr(date) + "' with ID: " + res[0].id + " has been updated in DB with UNKNOWN problems");
          return "Report for date '" + getDateStr(date) + "' has been inserted with UNKNOWN ERRORS into the DB";
        }
      } else {
        wLogger.info("A new report for date '" + getDateStr(date) + "' has been inserted in DB, with ID: " + res[0].id);
        return "Report for date '" + getDateStr(date) + "' has been correctly inserted into the DB";
      }
    } else {
      wLogger.info("A report for date '" + getDateStr(date) + "' already exists. Skipping.");
      return "Report for date '" + getDateStr(date) + "' already exists.";
    }
  } else {
    wLogger.info("A report for date '" + getDateStr(date) + "' already exists. Skipping.");
    return "Report for date '" + getDateStr(date) + "' already exists.";
  }
}

async function deleteReport(date: Date): Promise<string> {
  if (typeof date === 'string') {
    date = new Date(date);
  }
  wLogger.info("Deleting Report for date '" + getDateStr(date) + "'");

  // Delete field from DB
  const res = await db
    .delete(reportsTable)
    .where(eq(reportsTable.report_date, date));

  if (res.rowCount === 1) {
    wLogger.info("Report for date '" + getDateStr(date) + "' has been deleted from the DB");
    return "Report for date '" + getDateStr(date) + "' has been deleted from the DB";
  } else {
    wLogger.info("ERROR: Report for date '" + getDateStr(date) + "' was not found in the DB.");
    return "ERROR: Report for date '" + getDateStr(date) + "' was not found in the DB.";
  }
}

async function getReportForPeriod(startDate: Date, stopDate: Date): Promise<object> {
  wLogger.info("Requested report from " + getDateStr(startDate) + " to " + getDateStr(stopDate));
  if (typeof startDate === 'string') {
    startDate = new Date(startDate);
  }
  if (typeof stopDate === 'string') {
    stopDate = new Date(stopDate);
  }

  const startDateMs = startDate.getTime();
  const stopDateMs = stopDate.getTime();
  if (startDateMs > stopDateMs) {
    return {"error": "StartDate must be earlier than StopDate"};
  }
  const diffMs = stopDateMs - startDateMs;
  const totalDaysRequested = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

  let retrievedStats: RetrievedStatsObj[] = [];
  let distributedStats: DistributedStatsObj[] = [];
  let bandwidthRetrievedStats: BandwidthRetrievedStatsObj[] = [];
  let bandwidthDistributedStats: BandwidthDistributedStatsObj[] = [];
  let reportError: ReportError = [];

  type ReportObj = {
    report_date: Date | null
    report_content: ReportContent | null;
    report_error: ReportError | null;
  };

  let reportObjOutput = {
    report_content: {
      retrievedStats: retrievedStats,
      distributedStats: distributedStats,
      bandwidthRetrievedStats: bandwidthRetrievedStats,
      bandwidthDistributedStats: bandwidthDistributedStats
    },
    report_error: reportError
  }

  const reportArr: Array<ReportObj> = (
    await db
      .select({
        report_date: reportsTable.report_date,
        report_content: reportsTable.report_content,
        report_error: reportsTable.report_error
      })
      .from(reportsTable)
      .where(between(reportsTable.report_date, startDate, stopDate))
  ).map(({ report_date, report_content, report_error }) => ({
    report_date,
    report_content,
    report_error,
  }));

  if (reportArr.length === 0) {
    reportObjOutput.report_error.push({
      date: "whole period",
      errorSource: "log files",
      errorType: "error",
      errorMessage: "No data found for the requested period"
    });
  } else if (reportArr.length < totalDaysRequested) {
    wLogger.debug("No report found in the database for some of the requested days.");
    // dates found in DB
    const foundDates = new Set(
      reportArr.map(r => r.report_date?.toISOString().split('T')[0])
    );
    // all dates in range
    const allDates: string[] = [];
    for (let d = new Date(startDate); d <= stopDate; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }
    // missing dates
    const missingDates = allDates.filter(d => !foundDates.has(d));
    wLogger.info("List of missing dates in db: " + JSON.stringify(missingDates, null, 2));
    missingDates.forEach((missingDate: string) => {
      reportObjOutput.report_error.push({
        date: missingDate,
        errorSource: 'database',
        errorType: "warning",
        errorMessage: "No report found in the database for the requested day."
      });
    });
  }

  reportArr.forEach((reportObj: ReportObj) => {
    if (reportObj.report_content) {
      mergeStatsArrays(reportObjOutput.report_content.retrievedStats, reportObj.report_content.retrievedStats);
      mergeStatsArrays(reportObjOutput.report_content.distributedStats, reportObj.report_content.distributedStats);
      mergeBandwidthArrays(reportObjOutput.report_content.bandwidthRetrievedStats, reportObj.report_content.bandwidthRetrievedStats);
      mergeBandwidthArrays(reportObjOutput.report_content.bandwidthDistributedStats, reportObj.report_content.bandwidthDistributedStats);
    }
    if (reportObj.report_error) {
      reportObjOutput.report_error.push(...reportObj.report_error);
    }    
  });
  wLogger.debug("reportObjOutput: " + JSON.stringify(reportObjOutput, null, 2));
  return reportObjOutput;
}

async function getReportForDate(date: Date): Promise<Report> {
  let reportError: ReportError = [];

  // Prepare temp report json objects:
  const reportTempJson = await getReportJsonObjects(date, config.gssLogFolder);
  if (reportTempJson.hasOwnProperty('error')) {
    wLogger.error("There were problems while getting data from log files: " + JSON.stringify(reportTempJson.error, null, 2));
    const error: ReportErrorObj[] = [{
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "error",
      errorMessage: "There were problems while getting data from log files: " + JSON.stringify(reportTempJson.error, null, 2)
    }];
    const reportObj: Report = {
      report_date: date,
      report_content: {
        retrievedStats: [],
        distributedStats: [],
        bandwidthRetrievedStats: [],
        bandwidthDistributedStats: []
      },
      report_error: error
    };
    return reportObj;
  }
  let statsErrors: ReportError = [];
  // Get RetrievedStats
  const [retrievedStats, retrievedStatsErrors] = await getRetrievedStats(reportTempJson.ingestionFilteredLogRowsArr, reportTempJson.producedFilteredLogRowsArr);
  // Get DistributedStats
  const [distributedStats, distributedStatsErrors] = await getDistributedStats(reportTempJson.downloadFilteredLogRowsArr);
  // Get BandwidthRetrievedStats
  const [bandwidthRetrievedStats, bandwidthRetrievedStatsErrors] = await getBandwidthRetrievedStats(reportTempJson.ingestedProcessFilteredLogRowsArr, reportTempJson.ingestedCompletedFilteredLogRowsArr);
  // Get BandwidthDistributedStats
  const [bandwidthDistributedStats, bandwidthDistributedStatsErrors] = await getBandwidthDistributedStats(reportTempJson.downloadFilteredLogRowsArr);

  //wLogger.debug("retrievedStats: " + JSON.stringify(retrievedStats, null, 2));
  //wLogger.debug("retrievedStatsErrors: " + JSON.stringify(retrievedStatsErrors, null, 2));
  retrievedStatsErrors.forEach((err) => {
    statsErrors.push({
      date: getDateStr(date),
      errorSource: 'log files',
      errorType: 'error',
      errorMessage: err.error
    });
  });
  distributedStatsErrors.forEach((err) => {
    statsErrors.push({
      date: getDateStr(date),
      errorSource: 'log files',
      errorType: 'error',
      errorMessage: err.error
    });
  });
  bandwidthRetrievedStatsErrors.forEach((err) => {
    statsErrors.push({
      date: getDateStr(date),
      errorSource: 'log files',
      errorType: 'error',
      errorMessage: err.error
    });
  });
  bandwidthDistributedStatsErrors.forEach((err) => {
    statsErrors.push({
      date: getDateStr(date),
      errorSource: 'log files',
      errorType: 'error',
      errorMessage: err.error
    });
  });

  statsErrors.forEach((err: any) => {
    reportError.push(err);
  });

  // Delete productName property into bandwidthRetrievedStats
  bandwidthRetrievedStats.forEach((tempObj: any) => {
    if (tempObj.hasOwnProperty('productName')) delete tempObj.productName;
  });

  if (
    retrievedStats.length === 0 && 
    distributedStats.length === 0 &&
    bandwidthRetrievedStats.length === 0 && 
    bandwidthDistributedStats.length === 0
  ) {
    //if (!reportError) reportError = [];
    reportError.push({
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "warning",
      errorMessage: "No data found in the centre logs for date: " + getDateStr(date)
    });
  }

  if (retrievedStats.length > 0 && retrievedStats[0].hasOwnProperty('error')) {
    //if (!reportError) reportError = [{"error": "There was an error on getting report for date " + getDateStr(date)}];
    //if (!reportError) reportError = [];
    //wLogger.debug("DEV - retrievedStats Error: " + retrievedStats[0].error);
    reportError.push({
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "error",
      errorMessage: "There was an error on getting retrievedStats for date " + getDateStr(date) + ": " + retrievedStats[0].error
      //"error": "There was an error on getting retrievedStats for date " + getDateStr(date) + ": " + retrievedStats[0].error
    });
    //reportError.push({"error": retrievedStats[0].error});
  }
  if (distributedStats.length > 0 && distributedStats[0].hasOwnProperty('error')) {
    //if (!reportError) reportError = [{"error": "There was an error on getting report for date " + getDateStr(date)}];
    //wLogger.debug("DEV - distributedStats Error: " + distributedStats[0].error);
    reportError.push({
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "error",
      errorMessage: "There was an error on getting distributedStats for date " + getDateStr(date) + ": " + distributedStats[0].error
      //"error": "There was an error on getting distributedStats for date: " + getDateStr(date) + ": " + distributedStats[0].error
    });
    //reportError.push({"error": distributedStats[0].error});
  }
  if (bandwidthRetrievedStats.length > 0 && bandwidthRetrievedStats[0].hasOwnProperty('error')) {
    //if (!reportError) reportError = [{"error": "There was an error on getting report for date " + getDateStr(date)}];
    //wLogger.debug("DEV - bandwidthRetrievedStats Error: " + bandwidthRetrievedStats[0].error);
    reportError.push({
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "error",
      errorMessage: "There was an error on getting bandwidthRetrievedStats for date: " + getDateStr(date) + ": " + bandwidthRetrievedStats[0].error
      //"error": "There was an error on getting bandwidthRetrievedStats for date: " + getDateStr(date) + ": " + bandwidthRetrievedStats[0].error
    });
    //reportError.push({"error": bandwidthRetrievedStats[0].error});
  }
  if (bandwidthDistributedStats.length > 0 && bandwidthDistributedStats[0].hasOwnProperty('error')) {
    //if (!reportError) reportError = [{"error": "There was an error on getting report for date " + getDateStr(date)}];
    //wLogger.debug("DEV - bandwidthDistributedStats Error: " + bandwidthDistributedStats[0].error);
    reportError.push({
      date: getDateStr(date),
      errorSource: "log files",
      errorType: "error",
      errorMessage: "There was an error on getting bandwidthDistributedStat for date: " + getDateStr(date) + ": " + bandwidthDistributedStats[0].error
      //"error": "There was an error on getting bandwidthDistributedStat for date: " + getDateStr(date) + ": " + bandwidthDistributedStats[0].error
    });
    //reportError.push({"error": bandwidthDistributedStats[0].error});
  }

  wLogger.info("All stats have been calculated. Inserting on DB...");
  const reportObj: Report = {
    report_date: date,
    report_content: {
      retrievedStats: retrievedStats,
      distributedStats: distributedStats,
      bandwidthRetrievedStats: bandwidthRetrievedStats,
      bandwidthDistributedStats: bandwidthDistributedStats
    },
    report_error: reportError
  };

  return reportObj;
}

function getReportJsonObjects(requestedDate: Date, dirPath: string): any {
  wLogger.info("Begin looking for data into log files..");
  let retObj: any = {
    ingestionFilteredLogRowsArr: [],
    producedFilteredLogRowsArr: [],
    downloadFilteredLogRowsArr: [],
    ingestedProcessFilteredLogRowsArr: [],
    ingestedCompletedFilteredLogRowsArr: []
  };
  try {
    const files = fs.readdirSync(dirPath);
    const logFiles = files.filter(f => f.endsWith(".log"));

    for (const file of logFiles) {
      // Take only log files corresponding to the requested date range:
      const dateMatch = file.match(/\d{4}-\d{2}-\d{2}/);
      if (!dateMatch) continue;
      const logDate = new Date(dateMatch[0]);
      if (logDate.getFullYear() === requestedDate.getFullYear() &&
          logDate.getMonth() === requestedDate.getMonth() &&
          logDate.getDate() === requestedDate.getDate()) {

        // File has correct date -> elaborate:
        wLogger.debug("Found file for requested date named: " + file);
        const logFilePath = path.join(dirPath, file);
        const logFileContent = fs.readFileSync(logFilePath, "utf8");

        let logFileContentTotalArray = logFileContent.split('\n');
        // Get RETRIEVED ingestionFilteredLogRowsArr
        const ingestionFilteredLogRowsArr = logFileContentTotalArray
          .filter(row => /ingestion process.*completed/i.test(row));
        retObj.ingestionFilteredLogRowsArr = retObj.ingestionFilteredLogRowsArr.concat(ingestionFilteredLogRowsArr);

        // Get RETRIEVED producedFilteredLogRowsArr
        const producedFilteredLogRowsArr = logFileContentTotalArray
          .filter(row => /Consuming - queue/i.test(row));
        retObj.producedFilteredLogRowsArr = retObj.producedFilteredLogRowsArr.concat(producedFilteredLogRowsArr);


        // Get DISTRIBUTED downloadFilteredLogRowsArr
        const downloadFilteredLogRowsArr = logFileContentTotalArray
          .filter(row => /Download of(?!.*\.ql\.).*completed/i.test(row));
        retObj.downloadFilteredLogRowsArr = retObj.downloadFilteredLogRowsArr.concat(downloadFilteredLogRowsArr);

        
        // Get RETRIEVED BW ingestedFilteredLogRowsArr
        const ingestedProcessFilteredLogRowsArr = logFileContentTotalArray
          // This is commented because when product was ingested but its quicklook no, the log line was not taken into consideration.
          //.filter(row => /Summary ingestion process for product.*0 tasks skipped, 0 tasks failed/i.test(row));

          // So this regex instead takes all correctly ingested products, which produce the "Summery.." text:
          .filter(row => /Summary ingestion process for product./i.test(row));
        retObj.ingestedProcessFilteredLogRowsArr = retObj.ingestedProcessFilteredLogRowsArr.concat(ingestedProcessFilteredLogRowsArr);

        // Get RETRIEVED BW ingestedFilteredLogRowsArr
        const ingestedCompletedFilteredLogRowsArr = logFileContentTotalArray
          .filter(row => /Ingestion process of.*from datasource.*completed/i.test(row));
        retObj.ingestedCompletedFilteredLogRowsArr = retObj.ingestedCompletedFilteredLogRowsArr.concat(ingestedCompletedFilteredLogRowsArr);
      }
    }
  } catch (err) {
    wLogger.error(err);
    return {"error": err};
  }
  return retObj;
}

async function getRetrievedStats(ingestionFilteredLogRowsArr: any[], producedFilteredLogRowsArr: any[]):Promise<[any[], any[]]> {
  wLogger.info("Begin looking for RetrieveStats...");

  // Declare main object:
  let retrieveStatsRowsJsonObjArr: RetrievedStatsObj[] = [];

  const totalFileRows = ingestionFilteredLogRowsArr.length;

  let bytesMatchNumber = 0;
  let urlMatchNumber = 0;
  let errorArr: any[] = [];

  try {
    ingestionFilteredLogRowsArr.forEach((filteredLogRowEl, index) => {
      process.stdout.write("Checking row: " + index + "/" + totalFileRows + " - "+ ((index/totalFileRows)*100).toFixed(1) +"%           \r");
      let sizeInBytes = 0;
      let sizeInTiB = 0.0;
      let productName = "";
      let productType = "";
      let datasourceUrl = "";
      let datasourceKey = "";
      let datasource = "";
      let productExists = false;

      // Find Product Type matches:
      productTypeLabelList.forEach(productTypeListEl => {
        const productNameRegex = new RegExp("\\b" + productTypeListEl + "\\S*");
        const productNameMatch = filteredLogRowEl.match(productNameRegex);
        if (productNameMatch) {
          productName = productNameMatch[0];
          productType = productTypeListEl;
          productExists = true;
        }
      });
      if (productExists == false) {
        wLogger.error("Product Type NOT FOUND while getting retrievedStats: " + filteredLogRowEl);
        errorArr.push({"error": "Product Type NOT FOUND while getting retrievedStats: " + filteredLogRowEl});
        return;
      }

      // Find Product Size: 
      const bytesMatch = filteredLogRowEl.match(/\((\d+)\s+bytes?\)/);
      
      if (bytesMatch) {
        bytesMatchNumber += 1;
        sizeInBytes = parseInt(bytesMatch[1], 10);
        sizeInTiB = sizeInBytes / (1024 ** 4);
      }

      // Find url and datasource associated:
      if (producedFilteredLogRowsArr.length > 0) {
        producedFilteredLogRowsArr.forEach((producedFilteredLogRowsArrEl: string) => {
          if (producedFilteredLogRowsArrEl.includes(productName)) {
            const urlMatch = producedFilteredLogRowsArrEl.match(/\|\s*url:([^|\s]+)/);
            if (urlMatch) {
              let datasourceUrlArr = datasourcesMap.filter(dsEl => urlMatch[1].includes(dsEl.host));
              if (datasourceUrlArr.length > 0) {
                urlMatchNumber += 1;
                const tempDatasourceKey = datasourceUrlArr[0].host;
                datasourceUrl = "https://"+tempDatasourceKey;
                datasourceKey = tempDatasourceKey+"-"+productType;
                datasource = datasourceUrlArr[0].name;
              } else {
                wLogger.error("Datasource from url: "+urlMatch[1]+" was not found.");
                errorArr.push({"error": "Datasource from url: "+urlMatch[1]+" was not found (getRetrievedStats)."});
                return;
              }
            } else {
              wLogger.error("Couldn't find url line in: " + producedFilteredLogRowsArrEl);
              errorArr.push({"error":"Couldn't find url line in (getRetrievedStats): " + producedFilteredLogRowsArrEl});
              return;
            }

            // Add or update Retrieve Array items:
            let existentRetrieveElArr = retrieveStatsRowsJsonObjArr.filter(retrieveEl => retrieveEl.productType == productType);
            if (existentRetrieveElArr.length > 0) {
              // An element with the same productType already exists:
              existentRetrieveElArr[0].nbProducts += 1;
              existentRetrieveElArr[0].size = existentRetrieveElArr[0].size + sizeInTiB;
            } else {
              // Add a new element for this productType
              retrieveStatsRowsJsonObjArr.push({
                key: datasourceKey,
                from: datasource,
                to: config.localCentre,
                productType: productType,
                nbProducts: 1,
                size: sizeInTiB
              });
            }
          }
        });
      } else {
        wLogger.error("Producer product list is empty");
        errorArr.push({"error": "Producer product list is empty"});
        return;
      }
    });
    wLogger.debug("Found " + totalFileRows + " rows containing 'ingestion process.*completed'");
    wLogger.debug("Found " + bytesMatchNumber + " rows containing '(xxx bytes)'");
    wLogger.debug("Found " + urlMatchNumber + " rows containing 'url:(xxx)'");

    // Sort the output json based on productType:
    retrieveStatsRowsJsonObjArr.sort((a, b) => (productTypeListPosition[a.productType] ?? Infinity) - (productTypeListPosition[b.productType] ?? Infinity));
    wLogger.debug("RetrieveStats completed.");
    // if (errorArr.length > 0) {
    //   return [[], errorArr];
    // }
  } catch (err) {
    wLogger.error(err);
    return [[],[{"error": err}]];
  }
  return retrieveStatsRowsJsonObjArr.length > 0 ? [retrieveStatsRowsJsonObjArr, errorArr] : [[], [{"error": "No log found on getRetrievedStats"}]];
}

async function getDistributedStats(downloadFilteredLogRowsArr: any[]):Promise<[any[], any[]]> {
  wLogger.info("Begin looking for DistributedStats...");

  // Declare main objects:
  let distributedStatsRowsJsonObjArr: DistributedStatsObj[] = [];

  const totalFileRows = downloadFilteredLogRowsArr.length;

  let bytesMatchNumber = 0;
  let productNameMatchNumber = 0;
  let userMatchNumber = 0;
  let errorArr: any[] = [];

  try {
    downloadFilteredLogRowsArr.forEach((filteredLogRowEl, index) => {
      process.stdout.write("Checking row: " + index + "/" + totalFileRows + " - "+ ((index/totalFileRows)*100).toFixed(1) +"%           \r");
      let sizeInBytes = 0;
      let sizeInTiB = 0.0;
      let productName = "";
      let productType = "";
      let datasourceUrl = "";
      let datasourceKey = "";
      let datasource = "";
      let username = "";
      let productExists = false;

      // Find url and datasource associated:
      const userMatch = filteredLogRowEl.match(/(?<=product performed by )[^,]+/);
      if (userMatch) {
        username = userMatch[0];
        let datasourceUrlArr = datasourcesMap.filter(dsEl => username == dsEl.login);
        if (datasourceUrlArr.length > 0) {
          if (datasourceUrlArr[0].name === config.localCentre) {
            wLogger.warn("Found a product downloaded by the user assigned to local centre. Skipping: " + filteredLogRowEl);
            return;
          }
          userMatchNumber += 1;
          const tempDatasourceKey = datasourceUrlArr[0].host;
          datasourceUrl = "https://"+tempDatasourceKey;
          datasourceKey = tempDatasourceKey+"-"+productType;
          datasource = datasourceUrlArr[0].name;
        } else {
          wLogger.warn("Datasource from username: "+username+" was not found.");
          //errorArr.push({"error": "Datasource from username: "+username+" was not found (getDistributedStats)."});
          return;
        }
      } else {
        wLogger.error("Couldn't find username line match: " + filteredLogRowEl);
        errorArr.push({"error":"Couldn't find username line match (getDistributedStats): " + filteredLogRowEl});
        return;
      }

      // Find Product Type matches:
      productTypeLabelList.forEach(productTypeListEl => {
        // OLD WAY: const productNameRegex = new RegExp("\\b" + productTypeListEl + "\\S*");
        const productNameRegex = toRegex(productTypeListEl)
        const productNameMatch = filteredLogRowEl.match(productNameRegex);
        if (productNameMatch) {
          productNameMatchNumber += 1;
          productName = productNameMatch[0];
          productType = productTypeListEl;
          productExists = true;
        }
      });
      if (productExists == false) {
        errorArr.push({"error": "Product Type NOT FOUND while getting distributedStats: " + filteredLogRowEl});
        return;
      }

      // Find Product Size: 
      const bytesMatch = filteredLogRowEl.match(/\((\d+)\s+bytes?\)/);
      
      if (bytesMatch) {
        bytesMatchNumber += 1;
        sizeInBytes = parseInt(bytesMatch[1], 10);
        sizeInTiB = sizeInBytes / (1024 ** 4);
      }
      
      // Add or update Distribute Array items:
      let existentDistributeElArr = distributedStatsRowsJsonObjArr.filter(distributedEl => distributedEl.productType == productType);
      if (existentDistributeElArr.length > 0) {
        // An element with the same productType already exists:
        existentDistributeElArr[0].nbProducts += 1;
        existentDistributeElArr[0].size = existentDistributeElArr[0].size + sizeInTiB;
      } else {
        // Add a new element for this productType
        distributedStatsRowsJsonObjArr.push({
          key: datasourceKey,
          from: config.localCentre,
          to: datasource,
          productType: productType,
          nbProducts: 1,
          size: sizeInTiB
        });
      }
    })
    wLogger.debug("Found " + totalFileRows + " rows containing 'Download of(?!.*\.ql\.).*completed'");
    wLogger.debug("Found " + userMatchNumber + " rows containing 'product performed by' to get user");
    wLogger.debug("Found " + bytesMatchNumber + " rows containing '(xxx bytes)'");
    wLogger.debug("Found " + productNameMatchNumber + " rows containing a match for a Product Name");
    /* if (errorArr.length > 0) {
      return [[], errorArr];
    } */
  } catch (err) {
    wLogger.error(err);
    return [[],[{"error": err}]];
  }
  return distributedStatsRowsJsonObjArr.length > 0 ? [distributedStatsRowsJsonObjArr, errorArr] : [[], [{"error": "No log found on getDistributedStats"}]];
}

async function getBandwidthRetrievedStats(ingestedProcessFilteredLogRowsArr: any[], ingestedCompletedFilteredLogRowsArr: any[]):Promise<[any[], any[]]> {
  wLogger.info("Begin looking for BandwidthRetrievedStats...");

  // Declare main objects:
  let bandwidthRetrievedStatsRowsJsonObjArr: BandwidthRetrievedStatsObj[] = [];

  const totalFileRows = ingestedProcessFilteredLogRowsArr.length;

  let datasourceMatchNumber = 0;
  let errorArr: any[] = [];

  try {
    ingestedProcessFilteredLogRowsArr.forEach((filteredLogRowEl, index) => {
      process.stdout.write("Checking row: " + index + "/" + totalFileRows + " - "+ ((index/totalFileRows)*100).toFixed(1) +"%           \r");
      let bandwidthBs = 0;
      let bandwidthMbps = 0;
      let productName = "";
      let productType = "";
      let productExists = false;

      // Find Product Type matches:
      productTypeLabelList.forEach(productTypeListEl => {
        const productNameRegex = new RegExp("\\b" + productTypeListEl + "\\S*");
        const productNameMatch = filteredLogRowEl.match(productNameRegex);
        if (productNameMatch) {
          productName = productNameMatch[0];
          productType = productTypeListEl;
          productExists = true;
        }
      });
      if (productExists == false) {
        errorArr.push({"error": "Product Type NOT FOUND while getting bandwidthRetrievedStats: " + filteredLogRowEl});
        return;
      }

      // Find totalBytes
      const totalBytes = filteredLogRowEl.match(/\((\d+)\s+bytes\)/);
      let totalBytesInt = 0;
      if (totalBytes) {
        totalBytesInt = parseInt(totalBytes[1], 10);
      }

      // Find totalTime
      const totalTime = filteredLogRowEl.match(/done in (\d+)\s+ms/);
      let totalTimeInt = 0;
      if (totalTime) {
        totalTimeInt = parseInt(totalTime[1], 10);
      }
      // Find Product Size: 
      if (totalBytesInt > 0 && totalTimeInt > 0) {
        bandwidthBs = totalBytesInt / (totalTimeInt / 1000.0);
        bandwidthMbps = (bandwidthBs * 8) / 1000000;
      }
      
      // Add or update Distribute Array items:
      let existentDistributeElArr = bandwidthRetrievedStatsRowsJsonObjArr.filter(distributedEl => distributedEl.productType == productType);
      if (existentDistributeElArr.length > 0) {
        // An element with the same productType already exists:
        existentDistributeElArr[0].bandwidth += bandwidthMbps;
      } else {
        // Add a new element for this productType
        bandwidthRetrievedStatsRowsJsonObjArr.push({
          key: "",
          from: "",
          to: config.localCentre,
          productType: productType,
          productName: productName,
          bandwidth: bandwidthMbps,
        });
      }
    })

    const totalFileRows2 = ingestedCompletedFilteredLogRowsArr.length;

    ingestedCompletedFilteredLogRowsArr.forEach((filteredLogRowEl, index) => {
      process.stdout.write("Checking row: " + index + "/" + totalFileRows2 + " - "+ ((index/totalFileRows2)*100).toFixed(1) +"%           \r");
      // Find datasource associated:
      bandwidthRetrievedStatsRowsJsonObjArr.forEach((retrievedItem, index) => {
        const regex = new RegExp(
          `${retrievedItem.productName}.*?from datasource (\\w+)`
        );
        const datasourceMatch = filteredLogRowEl.match(regex);
        if (datasourceMatch) {
          datasourceMatchNumber += 1;
          let datasource = datasourceMatch[1];
          let datasourceUrlArr = datasourcesMap.filter(dsEl => datasource == dsEl.name);
          bandwidthRetrievedStatsRowsJsonObjArr[index].from = datasource;
          bandwidthRetrievedStatsRowsJsonObjArr[index].key = datasourceUrlArr[0].host + "-" + bandwidthRetrievedStatsRowsJsonObjArr[index].productType;
        }
      })
    });
    wLogger.debug("Found " + totalFileRows + " rows containing 'Summary ingestion process for product.*0 tasks skipped, 0 tasks failed'");
    wLogger.debug("Found " + totalFileRows2 + " rows containing 'Ingestion process of.*from datasource.*completed'");
    wLogger.debug("Found " + datasourceMatchNumber + " rows matching Datasource for Product Name");
    // if (errorArr.length > 0) {
    //   return [[], errorArr];
    // }
  } catch (err) {
    wLogger.error(err);
    return [[],[{"error": err}]];
  }
  return bandwidthRetrievedStatsRowsJsonObjArr.length > 0 ? [bandwidthRetrievedStatsRowsJsonObjArr, errorArr] : [[], [{"error": "No log found on getBandwidthRetrievedStats"}]];
}

async function getBandwidthDistributedStats(downloadFilteredLogRowsArr: any[]):Promise<[any[], any[]]> {
  wLogger.info("Begin looking for BandwidthDistributedStats...");

  // Declare main objects:
  let bandwidthDistributedStatsRowsJsonObjArr: BandwidthDistributedStatsObj[] = [];

  const totalFileRows = downloadFilteredLogRowsArr.length;

  let userMatchNumber = 0;
  let bandwidthMatchNumber = 0;
  let productNameMatchNumber = 0;
  let errorArr: any[] = [];

  try {
    downloadFilteredLogRowsArr.forEach((filteredLogRowEl, index) => {
      process.stdout.write("Checking row: " + index + "/" + totalFileRows + " - "+ ((index/totalFileRows)*100).toFixed(1) +"%           \r");
      let bandwidthBs = 0;
      let bandwidthMbps = 0;
      let productName = "";
      let productType = "";
      let datasourceUrl = "";
      let datasourceKey = "";
      let datasource = "";
      let username = "";
      let productExists = false;

      // Find url and datasource associated:
      const userMatch = filteredLogRowEl.match(/(?<=product performed by )[^,]+/);
      if (userMatch) {
        username = userMatch[0];
        let datasourceUrlArr = datasourcesMap.filter(dsEl => username == dsEl.login);
        if (datasourceUrlArr.length > 0) {
          if (datasourceUrlArr[0].name === config.localCentre) {
            wLogger.warn("Found a product downloaded by the user assigned to local centre. Skipping: " + filteredLogRowEl);
            return;
          }
          userMatchNumber += 1;
          const tempDatasourceKey = datasourceUrlArr[0].host;
          datasourceUrl = "https://"+tempDatasourceKey;
          datasourceKey = tempDatasourceKey+"-"+productType;
          datasource = datasourceUrlArr[0].name;
        } else {
          wLogger.warn("Datasource from username: "+username+" was not found.");
          //errorArr.push({"error": "Datasource from username: "+username+" was not found (getBandwidthDistributedStats)."});
          return;
        }
      } else {
        wLogger.error("Couldn't find username line match (getBandwidthDistributedStats): " + filteredLogRowEl);
        errorArr.push({"error": "Couldn't find username line match (getBandwidthDistributedStats): " + filteredLogRowEl});
        return;
      }

      // Find Product Type matches:
      productTypeLabelList.forEach(productTypeListEl => {
        const productNameRegex = new RegExp("\\b" + productTypeListEl + "\\S*");
        const productNameMatch = filteredLogRowEl.match(productNameRegex);
        if (productNameMatch) {
          productNameMatchNumber += 1;
          productName = productNameMatch[0];
          productType = productTypeListEl;
          productExists = true;
        }
      });
      if (productExists == false) {
        errorArr.push({"error": "Product Type NOT FOUND while getting bandwidthDistributedStats: " + filteredLogRowEl});
        return;
      }

      // Find Product Size: 
      const bandwidth = filteredLogRowEl.match(/\((\d+)\s+B\/s\)/);
      
      if (bandwidth) {
        bandwidthMatchNumber += 1;
        bandwidthBs = parseInt(bandwidth[1], 10);
        bandwidthMbps = (bandwidthBs * 8) / 1000000;
      }
      
      // Add or update Distribute Array items:
      let existentDistributeElArr = bandwidthDistributedStatsRowsJsonObjArr.filter(distributedEl => distributedEl.productType == productType);
      if (existentDistributeElArr.length > 0) {
        // An element with the same productType already exists:
        existentDistributeElArr[0].bandwidth += bandwidthMbps;
      } else {
        // Add a new element for this productType
        bandwidthDistributedStatsRowsJsonObjArr.push({
          key: datasourceKey,
          from: config.localCentre,
          to: datasource,
          productType: productType,
          bandwidth: bandwidthMbps,
        });
      }
    })
    wLogger.debug("Found " + totalFileRows + " rows containing 'Download of(?!.*\.ql\.).*completed'");
    wLogger.debug("Found " + productNameMatchNumber + " rows containing a match for a Product Name");
    wLogger.debug("Found " + bandwidthMatchNumber + " rows containing a match for Bandwidth");
    wLogger.debug("Found " + userMatchNumber + " rows containing 'product performed by' to get user");
    /* if (errorArr.length > 0) {
      return [[], errorArr];
    } */
  } catch (err) {
    wLogger.error(err);
    return [[],[{"error": err}]];
  }
  return bandwidthDistributedStatsRowsJsonObjArr.length > 0 ? [bandwidthDistributedStatsRowsJsonObjArr, errorArr] : [[], [{"error": "No log found on getBandwidthDistributedStats"}]];
}

function mergeStatsArrays(targetArr: (RetrievedStatsObj | DistributedStatsObj)[], newArr: (RetrievedStatsObj | DistributedStatsObj)[]) {
  newArr.forEach(newItem => {
    // check for object with same data
    const existing = targetArr.find(
      e =>
        e.key === newItem.key &&
        e.from === newItem.from &&
        e.to === newItem.to &&
        e.productType === newItem.productType
    );

    if (existing) {
      existing.nbProducts += newItem.nbProducts;
    } else {
      targetArr.push({ ...newItem });
    }
  });
}

function mergeBandwidthArrays(targetArr: (BandwidthRetrievedStatsObj | BandwidthDistributedStatsObj)[], newArr: (BandwidthRetrievedStatsObj | BandwidthDistributedStatsObj)[]) {
  newArr.forEach(newItem => {
    // check for object with same data
    const existing = targetArr.find(
      e =>
        e.key === newItem.key &&
        e.from === newItem.from &&
        e.to === newItem.to &&
        e.productType === newItem.productType
    );

    if (existing) {
      existing.bandwidth += newItem.bandwidth;
    } else {
      targetArr.push({ ...newItem });
    }
  });
}

function getDateStr(date: Date):string {
  if (typeof date === 'string') date = new Date(date);
  return date.toISOString().slice(0, 10);
}

export { checkReport, getReportForPeriod, deleteReport };