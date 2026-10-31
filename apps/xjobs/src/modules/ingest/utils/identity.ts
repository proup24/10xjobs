import { Channel } from 'src/common/enums';
import {
  InvalidIngestItem,
  type AtsIdentity,
  type NormalizedJob,
} from '../types';
import { ingestConfig } from '../config';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ashbyPath = new RegExp(`^/([^/]+)/(${uuid})(?:/application)?/?$`, 'i');
const greenhouseHosts = new Set<string>(ingestConfig.greenhouseHosts);
const linkedinHosts = new Set(['linkedin.com', 'www.linkedin.com']);

export function webUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidIngestItem('Invalid URL');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new InvalidIngestItem(
      'Unsupported URL protocol, credentials or port',
    );
  }
  return url;
}

export function applicationUrl(value: string | null): string | null {
  if (!value) return null;
  const url = webUrl(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|trk)/i.test(key) || key === 'gh_src')
      url.searchParams.delete(key);
  }
  return url.toString();
}

/** Recognizes exact supported posting identities without fetching the URL. */
export function atsIdentity(value: string): AtsIdentity | null {
  const url = webUrl(value);
  if (url.hostname === 'jobs.ashbyhq.com') {
    const match = ashbyPath.exec(url.pathname);
    const tenantKey = match?.[1];
    const postingId = match?.[2];
    if (tenantKey && postingId && /^[a-zA-Z0-9_-]+$/.test(tenantKey)) {
      return {
        provider: 'ashby',
        tenantKey,
        postingId: postingId.toLowerCase(),
      };
    }
  }
  if (greenhouseHosts.has(url.hostname)) {
    const match = /^\/([^/]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
    const tenantKey = match?.[1];
    const postingId = match?.[2];
    if (tenantKey && postingId && /^[a-zA-Z0-9_-]+$/.test(tenantKey)) {
      return {
        provider: 'greenhouse',
        tenantKey,
        postingId,
      };
    }
    if (url.pathname === '/embed/job_app') {
      const forParam = url.searchParams.get('for');
      const tokenParam = url.searchParams.get('token');
      if (
        forParam &&
        tokenParam &&
        /^[a-zA-Z0-9_-]+$/.test(forParam) &&
        /^\d+$/.test(tokenParam)
      ) {
        return {
          provider: 'greenhouse',
          tenantKey: forParam,
          postingId: tokenParam,
        };
      }
    }
  }
  return null;
}

function canonicalAtsSource(
  channel: Channel.ASHBY | Channel.GREEN_HOUSE,
  parsed: URL,
  value: string,
): { url: string; sourceId: string; ats: AtsIdentity } {
  const ats = atsIdentity(value);
  const expectedProvider = channel === Channel.ASHBY ? 'ashby' : 'greenhouse';
  if (!ats || ats.provider !== expectedProvider) {
    throw new InvalidIngestItem('Unsupported posting URL');
  }

  if (ats.provider === 'ashby') {
    return {
      url: `https://jobs.ashbyhq.com/${ats.tenantKey}/${ats.postingId}`,
      sourceId: ats.postingId,
      ats,
    };
  }

  const euPrefix = parsed.hostname.includes('.eu.') ? '.eu' : '';
  return {
    url: `https://job-boards${euPrefix}.greenhouse.io/${ats.tenantKey}/jobs/${ats.postingId}`,
    sourceId: ats.postingId,
    ats,
  };
}

function canonicalLinkedInJob(
  parsed: URL,
): { url: string; sourceId: string; ats: null } | null {
  const match = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(parsed.pathname);
  const jobId = match?.[1];
  if (!jobId) return null;

  return {
    url: `https://www.linkedin.com/jobs/view/${jobId}`,
    sourceId: jobId,
    ats: null,
  };
}

function canonicalLinkedInPost(
  parsed: URL,
): { url: string; sourceId: string | null; ats: null } | null {
  const updateMatch =
    /^\/feed\/update\/urn:li:(activity|groupPost):(\d+(?:-\d+)?)\/?$/.exec(
      parsed.pathname,
    );
  if (updateMatch?.[1] && updateMatch?.[2]) {
    const kind = updateMatch[1];
    const id = updateMatch[2];
    return {
      url: `https://www.linkedin.com/feed/update/urn:li:${kind}:${id}/`,
      sourceId: kind === 'groupPost' ? null : id,
      ats: null,
    };
  }

  const postMatch = /^\/posts\/[^/]*activity-(\d+)(?:-[^/]*)?\/?$/.exec(
    parsed.pathname,
  );
  const activityId = postMatch?.[1];
  if (activityId) {
    return {
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
      sourceId: activityId,
      ats: null,
    };
  }

  return null;
}

function canonicalLinkedInSource(
  channel: Channel,
  parsed: URL,
): { url: string; sourceId: string | null; ats: AtsIdentity | null } {
  if (!linkedinHosts.has(parsed.hostname)) {
    throw new InvalidIngestItem('Unsupported LinkedIn host');
  }

  if (channel === Channel.LINKEDIN_JOB_BOARD) {
    const result = canonicalLinkedInJob(parsed);
    if (result) return result;
  } else if (channel === Channel.LINKEDIN_POSTS) {
    const result = canonicalLinkedInPost(parsed);
    if (result) return result;
  }

  throw new InvalidIngestItem('Unsupported source URL');
}

export function canonicalSource(
  channel: Channel,
  value: string,
): { url: string; sourceId: string | null; ats: AtsIdentity | null } {
  const parsed = webUrl(value);
  if (parsed.protocol !== 'https:') {
    throw new InvalidIngestItem('Source URL must use HTTPS');
  }

  if (channel === Channel.ASHBY || channel === Channel.GREEN_HOUSE) {
    return canonicalAtsSource(channel, parsed, value);
  }

  return canonicalLinkedInSource(channel, parsed);
}

export function identityAliases(
  job: NormalizedJob,
): { identityType: string; identityValue: string }[] {
  const aliases = [{ identityType: 'url', identityValue: job.url }];
  if (job.externalId) {
    // Board IDs are scoped by their tenant; application-link ATS identities do not scope LinkedIn IDs.
    const tenant = [Channel.ASHBY, Channel.GREEN_HOUSE].includes(job.channel)
      ? job.ats?.tenantKey
      : null;
    aliases.push({
      identityType: 'source_id',
      identityValue: tenant ? `${tenant}:${job.externalId}` : job.externalId,
    });
  }
  return aliases;
}
