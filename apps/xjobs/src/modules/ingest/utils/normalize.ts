import { convert } from 'html-to-text';
import { z } from 'zod';
import { Channel } from 'src/common/enums';
import { applicationUrl, atsIdentity, canonicalSource } from './identity';
import {
  InvalidIngestItem,
  type AtsIdentity,
  type JsonValue,
  type NormalizedJob,
} from '../types';
import { ingestConfig } from '../config';

const optionalText = z.string().trim().nullable().optional();
const inputSchema = z.object({
  externalId: optionalText,
  url: z.string().trim().min(1),
  title: optionalText,
  company: optionalText,
  location: optionalText,
  description: z.string(),
  raw: z.unknown(),
  applyUrl: optionalText,
  postedAt: optionalText,
  postedAtPrecision: z.enum(['hour', 'day']).nullable().optional(),
  authorName: optionalText,
  authorUrl: optionalText,
  contactName: optionalText,
  contactUrl: optionalText,
  rank: z.number().int().positive().nullable().optional(),
});

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function json(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): JsonValue {
  if (depth > ingestConfig.maxRawDepth)
    throw new InvalidIngestItem(
      `Raw payload nesting exceeds ${ingestConfig.maxRawDepth} levels`,
    );
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new InvalidIngestItem('Raw payload must be JSON serializable');
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new InvalidIngestItem('Raw payload must contain plain JSON objects');
  ancestors.add(value);
  const result: JsonValue = Array.isArray(value)
    ? Array.from(value, (child) => json(child, ancestors, depth + 1))
    : Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          json(child, ancestors, depth + 1),
        ]),
      );
  ancestors.delete(value);
  return result;
}
function date(value: string | null): Date | null {
  if (!value) return null;
  if (
    !z.union([z.iso.date(), z.iso.datetime({ offset: true })]).safeParse(value)
      .success
  )
    throw new InvalidIngestItem('Invalid publication date');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new InvalidIngestItem('Invalid publication date');
  return parsed;
}

function resolveExternalId(
  channel: Channel,
  rawExternalId: unknown,
  itemUrl: string,
  sourceId: string | null,
): string | null {
  let externalId = text(rawExternalId);
  if (
    !externalId ||
    ['undefined', 'null'].includes(externalId.toLowerCase()) ||
    externalId === itemUrl
  ) {
    return null;
  }
  if (channel === Channel.ASHBY) {
    externalId = externalId.toLowerCase();
  } else if (channel === Channel.LINKEDIN_POSTS) {
    externalId = externalId.replace(
      /^urn:li:(?:activity|share|groupPost):/,
      '',
    );
  }
  if (sourceId !== null && externalId !== sourceId) {
    throw new InvalidIngestItem('Source ID does not match source URL');
  }
  return externalId;
}

function extractDescription(
  channel: Channel,
  isPost: boolean,
  original: Record<string, unknown>,
  itemDescription: string,
): string {
  let body = isPost
    ? (text(original.content) ?? itemDescription)
    : itemDescription;
  // Greenhouse can wrap HTML in another entity-encoding layer. Decode that
  // transport layer before parsing the markup; the untouched payload stays in raw.
  if (
    channel === Channel.GREEN_HOUSE &&
    /&lt;\/?[a-z][\s\S]*?&gt;/i.test(body)
  ) {
    body = convert(body, { wordwrap: false });
  }
  const description = /<\/?[a-z][^>]*>/i.test(body)
    ? convert(body, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      }).trim()
    : body.trim();
  if (!description) throw new InvalidIngestItem('Empty description');
  return description;
}

function extractTitle(
  isPost: boolean,
  itemTitle: unknown,
  description: string,
): string | null {
  if (!isPost) return text(itemTitle);
  const firstLine =
    description
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  return [...firstLine].slice(0, 120).join('');
}

function resolveCompany(
  channel: Channel,
  isPost: boolean,
  rawCompany: unknown,
  posting: Record<string, unknown>,
): string | null {
  if (isPost) return null;
  const company = text(rawCompany);
  if (company && company.toLowerCase() !== 'unknown') return company;
  return channel === Channel.GREEN_HOUSE ? text(posting.company_name) : null;
}

function resolveApplyUrl(
  isPost: boolean,
  itemApplyUrl: unknown,
  source: { ats: AtsIdentity | null; url: string },
  original: Record<string, unknown>,
): string | null {
  const direct = text(itemApplyUrl);
  if (direct) return applicationUrl(direct);
  if (source.ats) return applicationUrl(source.url);

  const fallback = isPost
    ? text(record(original.article).link)
    : text(original.applyUrl);
  return applicationUrl(fallback);
}

function resolvePublishedDate(
  channel: Channel,
  isPost: boolean,
  itemPostedAt: unknown,
  original: Record<string, unknown>,
  posting: Record<string, unknown>,
): string | null {
  const itemDate = text(itemPostedAt);
  if (itemDate) return itemDate;

  if (isPost) {
    return text(record(original.postedAt).date);
  }
  if (channel === Channel.ASHBY) {
    return text(posting.publishedDate);
  }
  if (channel === Channel.GREEN_HOUSE) {
    return text(posting.first_published);
  }
  return null;
}

function resolvePostedAt(
  channel: Channel,
  isPost: boolean,
  itemPostedAt: unknown,
  itemPrecision: 'hour' | 'day' | null | undefined,
  original: Record<string, unknown>,
  posting: Record<string, unknown>,
): { postedAt: Date | null; postedAtPrecision: 'hour' | 'day' | null } {
  const rawDate = resolvePublishedDate(
    channel,
    isPost,
    itemPostedAt,
    original,
    posting,
  );
  const postedAt = date(rawDate);
  if (!postedAt) {
    return { postedAt: null, postedAtPrecision: null };
  }
  const defaultPrecision =
    channel === Channel.ASHBY || (rawDate && !rawDate.includes('T'))
      ? 'day'
      : 'hour';
  return {
    postedAt,
    postedAtPrecision: itemPrecision ?? defaultPrecision,
  };
}

interface AuthorAndContact {
  authorName: string | null;
  authorUrl: string | null;
  contactName: string | null;
  contactUrl: string | null;
}

function resolveAuthorAndContact(
  isPost: boolean,
  item: {
    authorName?: string | null;
    authorUrl?: string | null;
    contactName?: string | null;
    contactUrl?: string | null;
  },
  original: Record<string, unknown>,
): AuthorAndContact {
  if (!isPost) {
    return {
      authorName: null,
      authorUrl: null,
      contactName: text(item.contactName) ?? text(original.posterFullName),
      contactUrl: applicationUrl(
        text(item.contactUrl) ?? text(original.posterProfileUrl),
      ),
    };
  }

  const author = record(original.author);
  const authorName =
    text(item.authorName) ?? text(author.name) ?? text(original.authorName);

  const publicId = text(author.publicIdentifier);
  const profileUrl = publicId
    ? `https://www.linkedin.com/in/${encodeURIComponent(publicId)}`
    : null;
  const rawAuthorUrl =
    text(item.authorUrl) ?? text(author.linkedinUrl) ?? profileUrl;
  const authorUrl = applicationUrl(rawAuthorUrl);

  const isProfile = author.type === 'profile';
  const contactName =
    text(item.contactName) ??
    (isProfile ? authorName : text(original.posterFullName));
  const rawContactUrl =
    text(item.contactUrl) ??
    (isProfile ? authorUrl : text(original.posterProfileUrl));

  return {
    authorName,
    authorUrl,
    contactName,
    contactUrl: applicationUrl(rawContactUrl),
  };
}

/** Maps the collector envelope, using original source fields only where the envelope loses information. */
export function normalizeItem(channel: Channel, value: unknown): NormalizedJob {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new InvalidIngestItem('Malformed collector item');
  const item = parsed.data;
  const raw = json(item.raw);
  const original = record(raw);
  const posting = record(original.posting);
  const source = canonicalSource(channel, item.url);
  const isPost = channel === Channel.LINKEDIN_POSTS;

  const externalId = resolveExternalId(
    channel,
    item.externalId,
    item.url,
    source.sourceId,
  );
  const description = extractDescription(
    channel,
    isPost,
    original,
    item.description,
  );
  const title = extractTitle(isPost, item.title, description);
  const company = resolveCompany(channel, isPost, item.company, posting);
  const applyUrl = resolveApplyUrl(isPost, item.applyUrl, source, original);
  const { postedAt, postedAtPrecision } = resolvePostedAt(
    channel,
    isPost,
    item.postedAt,
    item.postedAtPrecision,
    original,
    posting,
  );
  const { authorName, authorUrl, contactName, contactUrl } =
    resolveAuthorAndContact(isPost, item, original);
  const ats = source.ats ?? (applyUrl ? atsIdentity(applyUrl) : null);

  return {
    channel,
    kind: isPost ? 'post' : 'job',
    externalId,
    url: source.url,
    applyUrl,
    title,
    company,
    location: text(item.location),
    description,
    postedAt,
    postedAtPrecision,
    authorName,
    authorUrl,
    contactName,
    contactUrl,
    raw,
    normalizationVersion: ingestConfig.normalizationVersion,
    ats,
    observedUrl: item.url,
    rank: item.rank ?? null,
  };
}
