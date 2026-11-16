/** Which of the user's decisions the Applications page lists. */
export type AppStatus = 'applied' | 'dismissed';

export type AppView = { status: AppStatus; job: string | null };

/** The page's state from its URL; an unknown status reads as the default, `applied`. */
export function readAppView(params: URLSearchParams): AppView {
  return {
    status: params.get('status') === 'dismissed' ? 'dismissed' : 'applied',
    job: params.get('job') || null,
  };
}

/** The Applications page URL for a state; the default status is left out. */
export function appViewHref(v: AppView): string {
  const q = new URLSearchParams();
  if (v.status !== 'applied') q.set('status', v.status);
  if (v.job) q.set('job', v.job);
  const s = q.toString();
  return s ? `/applications?${s}` : '/applications';
}
