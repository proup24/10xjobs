/**
 * The date a role job carries: the original post's. The earliest non-null
 * `original.postedAt` across the post's sources, else the earliest source
 * `postedAt`, else the post job's own date. (A reshare is dated when it was
 * shared; the role is as old as the post it came from.)
 */
export function roleJobPostedAt(
  postSources: unknown,
  parentPostedAt: Date | null,
): Date | null {
  const sources =
    postSources &&
    typeof postSources === 'object' &&
    Array.isArray((postSources as { sources?: unknown }).sources)
      ? ((postSources as { sources: unknown[] }).sources as unknown[])
      : [];
  const earliest = (values: unknown[]): Date | null => {
    let best: Date | null = null;
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;
      if (!best || d < best) best = d;
    }
    return best;
  };
  const field = (s: unknown, key: string): unknown =>
    s && typeof s === 'object' ? (s as Record<string, unknown>)[key] : null;
  return (
    earliest(sources.map((s) => field(field(s, 'original'), 'postedAt'))) ??
    earliest(sources.map((s) => field(s, 'postedAt'))) ??
    parentPostedAt
  );
}
