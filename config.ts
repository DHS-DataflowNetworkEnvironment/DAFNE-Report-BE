import dotenv from 'dotenv';
dotenv.config({path: './config/dafne-report.env'});

const config = {
  nodeEnv: process.env.NODE_ENV || "production",
  logLevel: process.env.LOG_LEVEL || "info",
  port: process.env.REPORT_BE_PORT || "3000",
  databaseUrl: `postgres://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}` || "",
  allowedOriginUrls: process.env.ALLOWED_ORIGIN_URLS || [""],
  gssLogFolder: process.env.GSS_LOG_FOLDER || "",
  reportsLogFolder: process.env.REPORTS_LOG_FOLDER || "",
  localCentre: process.env.LOCAL_CENTRE_NAME || "LOCAL CENTRE N/D",
  apiUsername: process.env.API_USERNAME || "",
  apiPassword: process.env.API_PASSWORD || "",
  reportGenerationSchedule: process.env.AUTOMATIC_REPORT_GENERATION_SCHEDULE || "0 */2 * * *",
}

export default config;