import { integer, pgTable, timestamp, varchar, text, json } from "drizzle-orm/pg-core";
import { ReportContent, ReportError } from '../global_types.js';

const timestamps = {
  updated_at: timestamp({ mode: "date" }).defaultNow().notNull(),
  created_at: timestamp({ mode: "date" }).defaultNow().notNull()
}

export const reportsTable = pgTable("reports", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  report_date: timestamp({ mode: "date" }).notNull().unique(),
  report_content: json().$type<ReportContent>(),
  report_error: json().$type<ReportError>(),
  ...timestamps
});