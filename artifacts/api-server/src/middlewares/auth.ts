import { getAuth } from "@clerk/express";
import { count, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";

type AppRole = "admin" | "analyst" | "viewer";

async function ensureAppUser(
  clerkId: string,
  claims: Record<string, unknown>,
): Promise<typeof usersTable.$inferSelect> {
  const displayName =
    typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim()
      : clerkId;
  const email =
    typeof claims.email === "string" && claims.email.trim()
      ? claims.email.trim()
      : `${clerkId}@clerk.local`;

  return db.transaction(async (tx) => {
    // Serialize first-user bootstrapping so only one account receives admin.
    await tx.execute(sql`select pg_advisory_xact_lock(774201)`);
    const [existing] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    if (existing) return existing;

    const [userCount] = await tx.select({ value: count() }).from(usersTable);
    const role: AppRole = Number(userCount.value) === 0 ? "admin" : "analyst";
    const [created] = await tx
      .insert(usersTable)
      .values({ clerkId, name: displayName, email, role })
      .onConflictDoNothing({ target: usersTable.clerkId })
      .returning();
    if (created) return created;

    const [raced] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    if (!raced) throw new Error("Unable to resolve authenticated application user");
    return raced;
  });
}

export async function authRequired(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign-in is required." });
    return;
  }
  try {
    const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
    const user = await ensureAppUser(auth.userId, claims);
    res.locals.actorId = user.clerkId;
    res.locals.actorName = user.name;
    res.locals.role = user.role as AppRole;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Unable to resolve application user");
    res.status(500).json({ error: "Unable to resolve application access." });
  }
}

export function requireRole(...roles: AppRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(res.locals.role as AppRole)) {
      res.status(403).json({ error: "Your account does not have permission for this action." });
      return;
    }
    next();
  };
}
