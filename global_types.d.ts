import { reportsTable } from "./db/schema";

interface RetrievedStatsObj {
  key: string,
  from: string,
  to: string,
  productType: string,
  nbProducts: number,
  size: number
}
interface DistributedStatsObj {
  key: string,
  from: string,
  to: string,
  productType: string,
  nbProducts: number,
  size: number
}
interface BandwidthRetrievedStatsObj {
  key: string,
  from: string,
  to: string,
  productType: string,
  productName?: string,
  bandwidth: number
}
interface BandwidthDistributedStatsObj {
  key: string,
  from: string,
  to: string,
  productType: string,
  bandwidth: number
}

interface ReportContent {
  retrievedStats: RetrievedStatsObj[],
  distributedStats: DistributedStatsObj[],
  bandwidthRetrievedStats: BandwidthRetrievedStatsObj[],
  bandwidthDistributedStats: BandwidthDistributedStatsObj[]
}

interface ReportErrorObj {
  date: string,
  errorSource: "log files" | "database" | "generation" | "output",
  errorType: "error" | "warning" | "missing" | "unknown",
  errorMessage: string
}
interface ReportError extends Array<ReportErrorObj>{}