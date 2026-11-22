import type { PostAuthor, PostDetail } from '../../ingest/normalize/record';
import type { JobForProcessing, PostingInput } from '../models/types';
import { cut, DESCRIPTION_CAP_BYTES } from './input';

/** Everything a post links to: what the assembler checks emails and links against. */
export type PostLinks = {
  emails: string[];
  linkedinJobIds: string[];
  urls: string[];
};

const CUT_NOTE = 'Note: this text was cut at "see more".';
const CAP_NOTE = 'Note: this text was cut for length.';
const SEPARATOR = '\n\n';

/** One section: a header line, the author's text, and the note after a cut text. */
type Section = { header: string; text: string | null; note: string | null };

function render(s: Section): string {
  return [s.header, s.text || null, s.note]
    .filter((v) => v !== null)
    .join('\n');
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function totalBytes(sections: Section[]): number {
  return bytes(sections.map(render).join(SEPARATOR));
}

/**
 * Cuts section texts until all sections fit `budget` bytes: the original
 * post's text first, then the sharers' added texts from the last to the
 * first, so the added text (which may hold the only contact email or say the
 * role is filled) survives where it can. A cut text ends with CAP_NOTE.
 * Headers are never cut. Returns whether any text was cut.
 */
function fit(sections: Section[], budget: number): boolean {
  let cutAny = false;
  const order = [
    0,
    ...sections
      .map((_, i) => i)
      .slice(1)
      .reverse(),
  ];
  for (const i of order) {
    const over = totalBytes(sections) - budget;
    if (over <= 0) break;
    const s = sections[i];
    if (!s.text) continue;
    const capped = { ...s, note: CAP_NOTE };
    const room =
      bytes(s.text) - over - (bytes(render(capped)) - bytes(render(s)));
    sections[i] = { ...capped, text: room > 0 ? cut(s.text, room).text : '' };
    cutAny = true;
  }
  return cutAny;
}

type Original = {
  id: string | null;
  author: PostAuthor | null;
  text: string | null;
  truncated: boolean;
  attachedUrls: string[];
  postedAt: string | null;
};

/** The post a source is about: the shared post, or the source itself. */
function originalOf(source: PostDetail): Original {
  return source.original ?? source;
}

function who(author: PostAuthor | null, withType: boolean): string {
  const name = author?.name ?? 'an unknown author';
  const extra = [author?.headline, withType ? author?.type : null].filter(
    (v): v is string => !!v,
  );
  return extra.length ? `${name} (${extra.join(', ')})` : name;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The text the model reads for a post job, and the links the post carries.
 * Sources are sorted by post id, so their stored order never changes the
 * input or its hash. When sources disagree about the original post, the one
 * of the lowest-id source is rendered; sources about another original are
 * left out of the text and the links. The links block always comes last and
 * whole; over the cap, the texts are cut to fit around it (see `fit`).
 */
export function buildPostInput(job: JobForProcessing): {
  input: PostingInput;
  /** The rendered texts without the links block: what a quote about the post may come from. */
  postText: string;
  links: PostLinks;
} {
  const sources = [...(job.postSources ?? [])].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const sections: Section[] = [];
  const links: PostLinks = { emails: [], linkedinJobIds: [], urls: [] };
  let anyCut = false;
  let linksBlock: string | null = null;

  if (sources.length) {
    const original = originalOf(sources[0]);
    const used = sources.filter((s) => originalOf(s).id === original.id);

    const date = original.postedAt?.slice(0, 10);
    sections.push({
      header: `Original post by ${who(original.author, true)}${date ? `, posted ${date}` : ''}:`,
      text: original.text,
      note: original.truncated ? CUT_NOTE : null,
    });
    anyCut ||= original.truncated;

    for (const s of used) {
      if (!s.original || !s.text) continue;
      sections.push({
        header: `Shared by ${who(s.author, false)} with this added text:`,
        text: s.text,
        note: s.truncated ? CUT_NOTE : null,
      });
      anyCut ||= s.truncated;
    }

    for (const s of used) {
      links.emails.push(...s.links.emails);
      links.linkedinJobIds.push(...s.links.linkedinJobIds);
      links.urls.push(
        ...s.links.atsPostings.map((a) => a.url),
        ...s.links.other,
        ...s.attachedUrls,
        ...(s.original?.attachedUrls ?? []),
      );
    }
    links.emails = unique(links.emails);
    links.linkedinJobIds = unique(links.linkedinJobIds);
    links.urls = unique(links.urls);

    const lines = [
      ...links.emails,
      ...links.linkedinJobIds.map(
        (id) => `https://www.linkedin.com/jobs/view/${id}`,
      ),
      ...links.urls,
    ];
    if (lines.length) linksBlock = `Links in the post:\n${lines.join('\n')}`;
  }

  // The links block is always kept whole; the texts share what is left.
  const budget =
    DESCRIPTION_CAP_BYTES -
    (linksBlock ? bytes(linksBlock) + bytes(SEPARATOR) : 0);
  const capped = fit(sections, budget);
  const postText = sections.map(render).join(SEPARATOR);
  const text = [
    ...sections.map(render),
    ...(linksBlock ? [linksBlock] : []),
  ].join(SEPARATOR);
  return {
    input: {
      jobId: job.id,
      title: null,
      description: text,
      truncated: capped || anyCut,
    },
    postText,
    links,
  };
}
