import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  AddInvestigationNoteBody,
  AddInvestigationNoteParams,
  AddInvestigationNoteResponse,
  AnalyzeTransactionBody,
  AnalyzeTransactionResponse,
  CreateInvestigationBody,
  CreateInvestigationResponse,
  CreateTransactionBody,
  CreateTransactionResponse,
  GetAnalyticsTrendsResponse,
  GetInvestigationParams,
  GetInvestigationResponse,
  GetOverviewResponse,
  GetSettingsResponse,
  GetTransactionParams,
  GetTransactionResponse,
  ImportTransactionsResponse,
  ListAlertsQueryParams,
  ListAlertsResponse,
  ListAuditLogsResponse,
  ListInvestigationsResponse,
  ListTransactionsQueryParams,
  ListTransactionsResponse,
  ReviewTransactionBody,
  ReviewTransactionParams,
  ReviewTransactionResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
  UpdateInvestigationBody,
  UpdateInvestigationParams,
  UpdateInvestigationResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import {
  alertsTable,
  auditLogsTable,
  db,
  detectionSettingsTable,
  investigationNotesTable,
  investigationsTable,
  predictionsTable,
  transactionInputSchema,
  transactionsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { assessTransaction } from "../lib/fraudEngine";

const router: IRouter = Router();
const canInvestigate = requireRole("admin", "analyst");

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTransaction(row: typeof transactionsTable.$inferSelect) {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customerId,
    amount: row.amount,
    currency: row.currency,
    merchant: row.merchant,
    category: row.category,
    paymentMethod: row.paymentMethod,
    location: row.location,
    deviceId: row.deviceId,
    occurredAt: iso(row.occurredAt),
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    reviewStatus: row.reviewStatus,
    createdAt: iso(row.createdAt),
  };
}

function toPrediction(row: typeof predictionsTable.$inferSelect) {
  return {
    id: row.id,
    engine: row.engine,
    version: row.version,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    reasons: row.reasons,
    recommendedAction: row.recommendedAction,
    explanation: row.explanation,
    createdAt: iso(row.createdAt),
  };
}

function toAlert(
  row: typeof alertsTable.$inferSelect,
  reference: string,
) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    reference,
    severity: row.severity,
    reason: row.reason,
    status: row.status,
    assignedTo: row.assignedTo,
    resolutionNotes: row.resolutionNotes,
    createdAt: iso(row.createdAt),
  };
}

function toInvestigation(
  row: typeof investigationsTable.$inferSelect,
  reference: string,
) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    reference,
    assignedTo: row.assignedTo,
    priority: row.priority,
    status: row.status,
    outcome: row.outcome,
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
  };
}

async function getSettingsRow() {
  await db
    .insert(detectionSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: detectionSettingsTable.id });
  const [row] = await db
    .select()
    .from(detectionSettingsTable)
    .where(eq(detectionSettingsTable.id, 1))
    .limit(1);
  if (!row) throw new Error("Detection settings are unavailable.");
  return row;
}

async function writeAudit(
  actor: string | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(auditLogsTable).values({
    actor: actor ?? null,
    action,
    entityType,
    entityId: String(entityId),
    metadata: JSON.stringify(metadata),
  });
}

async function persistAnalysis(
  rawInput: unknown,
  actorId: string | undefined,
  actorName: string | undefined,
  res: Response,
  responseSchema: typeof AnalyzeTransactionResponse | typeof CreateTransactionResponse = AnalyzeTransactionResponse,
) {
  const parsed = transactionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    return;
  }

  const input = parsed.data;
  const settings = await getSettingsRow();
  const assessment = assessTransaction(input, settings);
  const reasonsText = assessment.reasons.join("; ");

  const persisted = await db.transaction(async (tx) => {
    const [transaction] = await tx
      .insert(transactionsTable)
      .values({
        reference: `FL-${randomUUID().slice(0, 8).toUpperCase()}`,
        customerId: input.customerId ?? null,
        amount: input.amount,
        currency: input.currency,
        merchant: input.merchant,
        category: input.category,
        paymentMethod: input.paymentMethod,
        location: input.location ?? null,
        deviceId: input.deviceId ?? null,
        occurredAt: input.occurredAt,
        recentCount: input.recentCount ?? null,
        failedAttempts: input.failedAttempts ?? null,
        newDevice: input.newDevice ?? null,
        unusualLocation: input.unusualLocation ?? null,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        reviewStatus: "pending",
      })
      .returning();

    const [prediction] = await tx
      .insert(predictionsTable)
      .values({
        transactionId: transaction.id,
        engine: "rules",
        version: assessment.version,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        reasons: assessment.reasons,
        recommendedAction: assessment.recommendedAction,
        explanation: assessment.explanation,
      })
      .returning();

    let alertCreated = false;
    if (assessment.score >= settings.alertThreshold) {
      const [existingAlert] = await tx
        .select({ id: alertsTable.id })
        .from(alertsTable)
        .where(
          and(
            eq(alertsTable.transactionId, transaction.id),
            eq(alertsTable.reason, reasonsText),
            ne(alertsTable.status, "resolved"),
          ),
        )
        .limit(1);
      if (!existingAlert) {
        await tx.insert(alertsTable).values({
          transactionId: transaction.id,
          predictionId: prediction.id,
          severity: assessment.level,
          reason: reasonsText,
          status: "open",
        });
        alertCreated = true;
      }
    }
    await tx.insert(auditLogsTable).values({
      actor: actorId ?? null,
      action: "transaction.analyzed",
      entityType: "transaction",
      entityId: String(transaction.id),
      metadata: JSON.stringify({ reference: transaction.reference, engine: "rules", riskLevel: assessment.level }),
    });
    return { transaction, prediction, alertCreated };
  });

  const output = {
    transaction: toTransaction(persisted.transaction),
    prediction: toPrediction(persisted.prediction),
    alertCreated: persisted.alertCreated,
  };
  res.status(201).json(responseSchema.parse(output));
  void actorName;
}

router.get("/overview", async (_req, res): Promise<void> => {
  const rows = await db.select().from(transactionsTable);
  const alerts = await db
    .select({ alert: alertsTable, reference: transactionsTable.reference })
    .from(alertsTable)
    .innerJoin(transactionsTable, eq(alertsTable.transactionId, transactionsTable.id))
    .where(ne(alertsTable.status, "resolved"))
    .orderBy(desc(alertsTable.createdAt))
    .limit(6);
  const totalTransactions = rows.length;
  const flaggedTransactions = rows.filter((row) => ["high", "critical"].includes(row.riskLevel)).length;
  const confirmed = rows.filter((row) => row.reviewStatus === "confirmed_fraud");
  const distribution = ["low", "medium", "high", "critical"].map((riskLevel) => ({
    riskLevel,
    count: rows.filter((row) => row.riskLevel === riskLevel).length,
  }));
  const recentTransactions = [...rows]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 8)
    .map(toTransaction);

  res.json(
    GetOverviewResponse.parse({
      totalTransactions,
      flaggedTransactions,
      confirmedFraud: confirmed.length,
      estimatedFraudValue: confirmed.reduce((sum, row) => sum + row.amount, 0),
      awaitingReview: rows.filter((row) => row.reviewStatus === "pending").length,
      riskDistribution: distribution,
      recentTransactions,
      recentAlerts: alerts.map(({ alert, reference }) => toAlert(alert, reference)),
    }),
  );
});

router.get("/transactions", async (req, res): Promise<void> => {
  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, risk, status, page = 1, pageSize = 20 } = parsed.data;
  const filters: SQL[] = [];
  if (risk) filters.push(eq(transactionsTable.riskLevel, risk));
  if (status) filters.push(eq(transactionsTable.reviewStatus, status));
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(
        ilike(transactionsTable.reference, pattern),
        ilike(transactionsTable.merchant, pattern),
        ilike(transactionsTable.customerId, pattern),
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const [totalRow] = await db
    .select({ total: count() })
    .from(transactionsTable)
    .where(where);
  const items = await db
    .select()
    .from(transactionsTable)
    .where(where)
    .orderBy(desc(transactionsTable.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json(
    ListTransactionsResponse.parse({
      items: items.map(toTransaction),
      page,
      pageSize,
      total: Number(totalRow.total),
    }),
  );
});

router.post("/transactions", canInvestigate, async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await persistAnalysis(parsed.data, res.locals.actorId, res.locals.actorName, res, CreateTransactionResponse);
});

router.post("/detection/analyze", canInvestigate, async (req, res): Promise<void> => {
  const parsed = AnalyzeTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await persistAnalysis(parsed.data, res.locals.actorId, res.locals.actorName, res);
});

router.get("/transactions/:id", async (req, res): Promise<void> => {
  const params = GetTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, params.data.id))
    .limit(1);
  if (!transaction) {
    res.status(404).json({ error: "Transaction not found." });
    return;
  }
  const predictions = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.transactionId, transaction.id))
    .orderBy(desc(predictionsTable.createdAt));
  res.json(
    GetTransactionResponse.parse({
      transaction: toTransaction(transaction),
      predictions: predictions.map(toPrediction),
    }),
  );
});

router.patch("/transactions/:id/review", canInvestigate, async (req, res): Promise<void> => {
  const params = ReviewTransactionParams.safeParse(req.params);
  const body = ReviewTransactionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(transactionsTable)
    .set({ reviewStatus: body.data.reviewStatus, updatedAt: new Date() })
    .where(eq(transactionsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Transaction not found." });
    return;
  }
  await writeAudit(res.locals.actorId, "transaction.reviewed", "transaction", row.id, {
    reviewStatus: row.reviewStatus,
    note: body.data.note ?? null,
  });
  res.json(ReviewTransactionResponse.parse(toTransaction(row)));
});

router.get("/alerts", async (req, res): Promise<void> => {
  const parsed = ListAlertsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .select({ alert: alertsTable, reference: transactionsTable.reference })
    .from(alertsTable)
    .innerJoin(transactionsTable, eq(alertsTable.transactionId, transactionsTable.id))
    .where(parsed.data.status ? eq(alertsTable.status, parsed.data.status) : undefined)
    .orderBy(desc(alertsTable.createdAt));
  res.json(ListAlertsResponse.parse(rows.map(({ alert, reference }) => toAlert(alert, reference))));
});

router.patch("/alerts/:id", canInvestigate, async (req, res): Promise<void> => {
  const params = UpdateAlertParams.safeParse(req.params);
  const body = UpdateAlertBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data ?? {}).length === 0) {
    res.status(400).json({ error: !params.success ? params.error.message : "Provide an alert update." });
    return;
  }
  const [row] = await db
    .update(alertsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(alertsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  const [transaction] = await db
    .select({ reference: transactionsTable.reference })
    .from(transactionsTable)
    .where(eq(transactionsTable.id, row.transactionId))
    .limit(1);
  if (!transaction) {
    res.status(404).json({ error: "Associated transaction not found." });
    return;
  }
  await writeAudit(res.locals.actorId, "alert.updated", "alert", row.id, body.data);
  res.json(UpdateAlertResponse.parse(toAlert(row, transaction.reference)));
});

router.get("/investigations", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ investigation: investigationsTable, reference: transactionsTable.reference })
    .from(investigationsTable)
    .innerJoin(transactionsTable, eq(investigationsTable.transactionId, transactionsTable.id))
    .orderBy(desc(investigationsTable.openedAt));
  res.json(ListInvestigationsResponse.parse(rows.map(({ investigation, reference }) => toInvestigation(investigation, reference))));
});

router.post("/investigations", canInvestigate, async (req, res): Promise<void> => {
  const body = CreateInvestigationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, body.data.transactionId))
    .limit(1);
  if (!transaction) {
    res.status(404).json({ error: "Transaction not found." });
    return;
  }
  const [alreadyOpen] = await db
    .select()
    .from(investigationsTable)
    .where(and(eq(investigationsTable.transactionId, transaction.id), ne(investigationsTable.status, "closed")))
    .limit(1);
  if (alreadyOpen) {
    res.status(409).json({ error: "An open investigation already exists for this transaction." });
    return;
  }
  const [row] = await db
    .insert(investigationsTable)
    .values({
      transactionId: transaction.id,
      priority: body.data.priority,
      assignedTo: body.data.assignedTo || res.locals.actorName,
      status: "open",
    })
    .returning();
  await writeAudit(res.locals.actorId, "investigation.opened", "investigation", row.id, { transactionId: transaction.id });
  res.status(201).json(CreateInvestigationResponse.parse(toInvestigation(row, transaction.reference)));
});

router.get("/investigations/:id", async (req, res): Promise<void> => {
  const params = GetInvestigationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [result] = await db
    .select({ investigation: investigationsTable, reference: transactionsTable.reference })
    .from(investigationsTable)
    .innerJoin(transactionsTable, eq(investigationsTable.transactionId, transactionsTable.id))
    .where(eq(investigationsTable.id, params.data.id))
    .limit(1);
  if (!result) {
    res.status(404).json({ error: "Investigation not found." });
    return;
  }
  const notes = await db
    .select()
    .from(investigationNotesTable)
    .where(eq(investigationNotesTable.investigationId, result.investigation.id))
    .orderBy(asc(investigationNotesTable.createdAt));
  res.json(
    GetInvestigationResponse.parse({
      investigation: toInvestigation(result.investigation, result.reference),
      notes: notes.map((note) => ({
        id: note.id,
        content: note.content,
        author: note.author,
        createdAt: iso(note.createdAt),
      })),
    }),
  );
});

router.patch("/investigations/:id", canInvestigate, async (req, res): Promise<void> => {
  const params = UpdateInvestigationParams.safeParse(req.params);
  const body = UpdateInvestigationBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data ?? {}).length === 0) {
    res.status(400).json({ error: !params.success ? params.error.message : "Provide an investigation update." });
    return;
  }
  const [row] = await db
    .update(investigationsTable)
    .set({
      ...body.data,
      closedAt: body.data.status === "closed" ? new Date() : undefined,
    })
    .where(eq(investigationsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Investigation not found." });
    return;
  }
  const [transaction] = await db
    .select({ reference: transactionsTable.reference })
    .from(transactionsTable)
    .where(eq(transactionsTable.id, row.transactionId))
    .limit(1);
  if (!transaction) {
    res.status(404).json({ error: "Associated transaction not found." });
    return;
  }
  await writeAudit(res.locals.actorId, "investigation.updated", "investigation", row.id, body.data);
  res.json(UpdateInvestigationResponse.parse(toInvestigation(row, transaction.reference)));
});

router.post("/investigations/:id/notes", canInvestigate, async (req, res): Promise<void> => {
  const params = AddInvestigationNoteParams.safeParse(req.params);
  const body = AddInvestigationNoteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [investigation] = await db
    .select()
    .from(investigationsTable)
    .where(eq(investigationsTable.id, params.data.id))
    .limit(1);
  if (!investigation) {
    res.status(404).json({ error: "Investigation not found." });
    return;
  }
  const [note] = await db
    .insert(investigationNotesTable)
    .values({
      investigationId: investigation.id,
      author: res.locals.actorName ?? res.locals.actorId ?? "Analyst",
      content: body.data.content,
    })
    .returning();
  await writeAudit(res.locals.actorId, "investigation.note_added", "investigation", investigation.id, { noteId: note.id });
  res.status(201).json(
    AddInvestigationNoteResponse.parse({
      id: note.id,
      content: note.content,
      author: note.author,
      createdAt: iso(note.createdAt),
    }),
  );
});

router.get("/analytics/trends", async (_req, res): Promise<void> => {
  const records = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${transactionsTable.occurredAt}), 'YYYY-MM-DD')`,
      volume: count(),
      flagged: sql<number>`count(*) filter (where ${transactionsTable.riskLevel} in ('high', 'critical'))`,
      confirmedFraudValue: sql<number>`coalesce(sum(${transactionsTable.amount}) filter (where ${transactionsTable.reviewStatus} = 'confirmed_fraud'), 0)`,
    })
    .from(transactionsTable)
    .groupBy(sql`date_trunc('day', ${transactionsTable.occurredAt})`)
    .orderBy(sql`date_trunc('day', ${transactionsTable.occurredAt})`);
  res.json(
    GetAnalyticsTrendsResponse.parse(
      records.map((row) => ({
        day: row.day,
        volume: Number(row.volume),
        flagged: Number(row.flagged),
        confirmedFraudValue: Number(row.confirmedFraudValue),
      })),
    ),
  );
});

router.get("/audit-logs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(250);
  res.json(
    ListAuditLogsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        createdAt: iso(row.createdAt),
      })),
    ),
  );
});

router.get("/settings", async (_req, res): Promise<void> => {
  const row = await getSettingsRow();
  res.json(GetSettingsResponse.parse(row));
});

router.put("/settings", requireRole("admin"), async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { mediumThreshold, highThreshold, criticalThreshold, alertThreshold } = body.data;
  if (!(mediumThreshold < highThreshold && highThreshold < criticalThreshold)) {
    res.status(400).json({ error: "Thresholds must be strictly increasing: medium < high < critical." });
    return;
  }
  const [row] = await db
    .insert(detectionSettingsTable)
    .values({ id: 1, ...body.data })
    .onConflictDoUpdate({
      target: detectionSettingsTable.id,
      set: { ...body.data, updatedAt: new Date() },
    })
    .returning();
  await writeAudit(res.locals.actorId, "settings.thresholds_updated", "settings", "1", body.data);
  res.json(UpdateSettingsResponse.parse(row));
});

router.post("/import/transactions", canInvestigate, async (req, res): Promise<void> => {
  const rawRows =
    req.body && typeof req.body === "object" && Array.isArray(req.body.rows)
      ? req.body.rows.slice(0, 500)
      : null;
  if (!rawRows) {
    res.status(400).json({ error: "Provide a rows array with no more than 500 records." });
    return;
  }
  const errors: string[] = [];
  let accepted = 0;
  for (const [index, row] of rawRows.entries()) {
    const parsed = transactionInputSchema.safeParse(row);
    if (!parsed.success) {
      errors.push(`Row ${index + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      continue;
    }
    await persistImported(parsed.data, res.locals.actorId);
    accepted += 1;
  }
  await writeAudit(res.locals.actorId, "transactions.imported", "import", randomUUID(), {
    accepted,
    rejected: rawRows.length - accepted,
  });
  res.json(
    ImportTransactionsResponse.parse({
      accepted,
      rejected: rawRows.length - accepted,
      errors,
    }),
  );
});

async function persistImported(
  input: ReturnType<typeof transactionInputSchema.parse>,
  actorId: string | undefined,
) {
  const settings = await getSettingsRow();
  const assessment = assessTransaction(input, settings);
  await db.transaction(async (tx) => {
    const [transaction] = await tx
      .insert(transactionsTable)
      .values({
        reference: `FL-${randomUUID().slice(0, 8).toUpperCase()}`,
        customerId: input.customerId ?? null,
        amount: input.amount,
        currency: input.currency,
        merchant: input.merchant,
        category: input.category,
        paymentMethod: input.paymentMethod,
        location: input.location ?? null,
        deviceId: input.deviceId ?? null,
        occurredAt: input.occurredAt,
        recentCount: input.recentCount ?? null,
        failedAttempts: input.failedAttempts ?? null,
        newDevice: input.newDevice ?? null,
        unusualLocation: input.unusualLocation ?? null,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        reviewStatus: "pending",
      })
      .returning();
    const [prediction] = await tx
      .insert(predictionsTable)
      .values({
        transactionId: transaction.id,
        engine: "rules",
        version: assessment.version,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        reasons: assessment.reasons,
        recommendedAction: assessment.recommendedAction,
        explanation: assessment.explanation,
      })
      .returning();
    if (assessment.score >= settings.alertThreshold) {
      await tx.insert(alertsTable).values({
        transactionId: transaction.id,
        predictionId: prediction.id,
        severity: assessment.level,
        reason: assessment.reasons.join("; "),
        status: "open",
      });
    }
    await tx.insert(auditLogsTable).values({
      actor: actorId ?? null,
      action: "transaction.imported",
      entityType: "transaction",
      entityId: String(transaction.id),
      metadata: JSON.stringify({ reference: transaction.reference }),
    });
  });
}

router.get("/export/transactions", async (_req, res): Promise<void> => {
  const rows = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.occurredAt));
  const headers = [
    "reference", "customerId", "amount", "currency", "merchant", "category", "paymentMethod",
    "location", "deviceId", "occurredAt", "riskScore", "riskLevel", "reviewStatus",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = rows.map((row) =>
    [
      row.reference, row.customerId, row.amount, row.currency, row.merchant, row.category,
      row.paymentMethod, row.location, row.deviceId, row.occurredAt.toISOString(),
      row.riskScore, row.riskLevel, row.reviewStatus,
    ].map(escape).join(","),
  );
  await writeAudit(res.locals.actorId, "transactions.exported", "transaction", "all", { count: rows.length });
  res
    .status(200)
    .type("text/csv")
    .set("Content-Disposition", 'attachment; filename="fraudlens-transactions.csv"')
    .send([headers.join(","), ...lines].join("\r\n"));
});

export default router;
