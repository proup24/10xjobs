export type ShareRow = {
  outcome: string;
  reviewRule: string | null;
  reviewField: string | null;
};

export type OutcomeShares = {
  total: number;
  byOutcome: Record<string, number>;
  reviewByRule: Record<string, number>;
  reviewByField: Record<string, number>;
};

function shares(
  keys: (string | null)[],
  total: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    if (key !== null) counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).map(([key, n]) => [key, n / total]),
  );
}

/**
 * The share (0..1) of decided rows per outcome, and of review rows per rule
 * and per field. Review shares are of the review rows, not of all rows.
 */
export function outcomeShares(rows: ShareRow[]): OutcomeShares {
  const reviews = rows.filter((r) => r.outcome === 'review');
  return {
    total: rows.length,
    byOutcome: shares(
      rows.map((r) => r.outcome),
      rows.length,
    ),
    reviewByRule: shares(
      reviews.map((r) => r.reviewRule),
      reviews.length,
    ),
    reviewByField: shares(
      reviews.map((r) => r.reviewField),
      reviews.length,
    ),
  };
}
