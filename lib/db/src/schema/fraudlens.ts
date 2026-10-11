import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "fraudlens_users",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id").notNull().unique(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("analyst"),
    accountStatus: text("account_status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("fraudlens_users_clerk_id_idx").on(table.clerkId)],
);

export const transactionsTable = pgTable(
  "fraudlens_transactions",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    customerId: text("customer_id"),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    merchant: text("merchant").notNull(),
    category: text("category").notNull(),
    paymentMethod: text("payment_method").notNull(),
    location: text("location"),
    deviceId: text("device_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recentCount: integer("recent_count"),
    failedAttempts: integer("failed_attempts"),
    newDevice: boolean("new_device"),
    unusualLocation: boolean("unusual_location"),
    riskScore: integer("risk_score").notNull().default(0),
    riskLevel: text("risk_level").notNull().default("low"),
    reviewStatus: text("review_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fraudlens_transactions_reference_idx").on(table.reference),
    index("fraudlens_transactions_time_idx").on(table.occurredAt),
    index("fraudlens_transactions_risk_idx").on(table.riskLevel),
    index("fraudlens_transactions_status_idx").on(table.reviewStatus),
  ],
);

export const predictionsTable = pgTable(
  "fraudlens_predictions",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").notNull().references(() => transactionsTable.id, { onDelete: "cascade" }),
    engine: text("engine").notNull().default("rules"),
    version: text("version").notNull(),
    riskScore: integer("risk_score").notNull(),
    riskLevel: text("risk_level").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    recommendedAction: text("recommended_action").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("fraudlens_predictions_transaction_idx").on(table.transactionId)],
);

export const alertsTable = pgTable(
  "fraudlens_alerts",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").notNull().references(() => transactionsTable.id, { onDelete: "cascade" }),
    predictionId: integer("prediction_id").notNull().references(() => predictionsTable.id, { onDelete: "cascade" }),
    severity: text("severity").notNull(),
    reason: text("reason").notNull(),
    assignedTo: text("assigned_to"),
    status: text("status").notNull().default("open"),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("fraudlens_alerts_status_idx").on(table.status),
    index("fraudlens_alerts_transaction_idx").on(table.transactionId),
    uniqueIndex("fraudlens_alerts_unresolved_unique").on(table.transactionId, table.reason).where(sql`${table.status} <> 'resolved'`),
  ],
);

export const investigationsTable = pgTable(
  "fraudlens_investigations",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").notNull().references(() => transactionsTable.id, { onDelete: "cascade" }),
    assignedTo: text("assigned_to"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    outcome: text("outcome"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    index("fraudlens_investigations_status_idx").on(table.status),
    uniqueIndex("fraudlens_investigations_open_transaction_unique").on(table.transactionId).where(sql`${table.status} <> 'closed'`),
  ],
);

export const investigationNotesTable = pgTable(
  "fraudlens_investigation_notes",
  {
    id: serial("id").primaryKey(),
    investigationId: integer("investigation_id").notNull().references(() => investigationsTable.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("fraudlens_notes_case_idx").on(table.investigationId)],
);

export const auditLogsTable = pgTable(
  "fraudlens_audit_logs",
  {
    id: serial("id").primaryKey(),
    actor: text("actor"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("fraudlens_audit_created_idx").on(table.createdAt)],
);

export const detectionSettingsTable = pgTable("fraudlens_detection_settings", {
  id: integer("id").primaryKey().default(1),
  mediumThreshold: integer("medium_threshold").notNull().default(25),
  highThreshold: integer("high_threshold").notNull().default(50),
  criticalThreshold: integer("critical_threshold").notNull().default(75),
  alertThreshold: integer("alert_threshold").notNull().default(50),
  scoringVersion: text("scoring_version").notNull().default("rules-v1.0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const transactionInputSchema = z.object({
  customerId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).transform((v) => v.toUpperCase()),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  paymentMethod: z.string().trim().min(1).max(40),
  location: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  occurredAt: z.coerce.date(),
  recentCount: z.number().int().min(0).nullable().optional(),
  failedAttempts: z.number().int().min(0).nullable().optional(),
  newDevice: z.boolean().nullable().optional(),
  unusualLocation: z.boolean().nullable().optional(),
});
export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvestigationSchema = createInsertSchema(investigationsTable).omit({ id: true, openedAt: true, closedAt: true });
export const insertInvestigationNoteSchema = createInsertSchema(investigationNotesTable).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });

export type Transaction = typeof transactionsTable.$inferSelect;
export type Prediction = typeof predictionsTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
export type Investigation = typeof investigationsTable.$inferSelect;
export type InvestigationNote = typeof investigationNotesTable.$inferSelect;
