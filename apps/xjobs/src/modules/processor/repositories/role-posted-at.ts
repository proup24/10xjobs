/**
 * The date a role job carries: the original post's. Each source is dated by
 * its original (`original.postedAt`, for a share) or, with none, by its own
 * `postedAt` (a plain post is itself an original); the role takes the
 * earliest of these across the post's sources, else the post job's own date.
 * A share's original therefore never hides an older plain source.
 */
export function roleJobPostedAt(
  postSources: unknown,
  parentPostedAt: Date | null,
): Date | null {
  const sources =
    postSources &&
    typeof postSources === 'object' &&
    Array.isArray((postSources as { sources?: unknown }).sources)
      ? (postSources as { sources: unknown[] }).sources
      : [];
  const valid = (v: unknown): Date | null => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const field = (s: unknown, key: string): unknown =>
    s && typeof s === 'object' ? (s as Record<string, unknown>)[key] : null;
  let best: Date | null = null;
  for (const s of sources) {
    const d =
      valid(field(field(s, 'original'), 'postedAt')) ??
      valid(field(s, 'postedAt'));
    if (d && (!best || d < best)) best = d;
  }
  return best ?? parentPostedAt;
}
