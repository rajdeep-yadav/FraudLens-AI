export interface ScoringThresholds {
  mediumThreshold: number;
  highThreshold: number;
  criticalThreshold: number;
  alertThreshold: number;
  scoringVersion: string;
}

export interface TransactionFeatures {
  amount: number;
  recentCount?: number | null;
  failedAttempts?: number | null;
  newDevice?: boolean | null;
  unusualLocation?: boolean | null;
}

export interface Assessment {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
  recommendedAction: string;
  explanation: string;
  version: string;
}

export function assessTransaction(
  input: TransactionFeatures,
  thresholds: ScoringThresholds,
): Assessment {
  let score = 0;
  const reasons: string[] = [];

  if (input.amount >= 3000) {
    score += 40;
    reasons.push("High transaction amount (≥ 3,000)");
  } else if (input.amount >= 1000) {
    score += 25;
    reasons.push("Elevated transaction amount (≥ 1,000)");
  }
  if (typeof input.recentCount === "number" && input.recentCount >= 4) {
    score += Math.min(30, 10 + (input.recentCount - 4) * 5);
    reasons.push(`Rapid activity reported: ${input.recentCount} recent transactions`);
  }
  if (typeof input.failedAttempts === "number" && input.failedAttempts > 0) {
    score += Math.min(25, input.failedAttempts * 12);
    reasons.push(`${input.failedAttempts} failed attempt(s) reported`);
  }
  if (input.newDevice === true) {
    score += 15;
    reasons.push("Transaction submitted from a device marked as new");
  }
  if (input.unusualLocation === true) {
    score += 25;
    reasons.push("Transaction location marked as unusual");
  }

  score = Math.min(100, score);
  const level =
    score >= thresholds.criticalThreshold
      ? "critical"
      : score >= thresholds.highThreshold
        ? "high"
        : score >= thresholds.mediumThreshold
          ? "medium"
          : "low";
  const recommendedAction =
    score >= thresholds.alertThreshold
      ? "Queue for analyst review; verify context before taking action."
      : score >= thresholds.mediumThreshold
        ? "Review if additional account context indicates concern."
        : "No immediate review signal; continue standard monitoring.";
  const explanation =
    reasons.length > 0
      ? `Rule-based score of ${score}/100 from ${reasons.length} supplied signal(s). This is a triage recommendation, not a fraud finding.`
      : "No configured risk rules were triggered by the information supplied. This is not proof that the transaction is legitimate.";

  return {
    score,
    level,
    reasons: reasons.length > 0 ? reasons : ["No configured risk rule triggered"],
    recommendedAction,
    explanation,
    version: thresholds.scoringVersion,
  };
}
