import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTORS,
  type ActorName,
  type SampleSearch,
} from 'src/scripts/indeed-sample/actors';

// fixtures/memo23.json is built from the actor's dataset schema (build ua2EEra2zcXeFlsb1),
// because its README has no example output item. The schema declares jobDescription
// without saying text or HTML, so the reader cleans both.
function fixture(name: ActorName): Record<string, unknown> {
  const rows = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>[];
  return rows[0];
}

function search(over: Partial<SampleSearch>): SampleSearch {
  return {
    id: 'us-remote-plain',
    place: 'us-remote',
    keywordKind: 'plain',
    keyword: 'software engineer',
    remoteBy: 'filter',
    seniorOnly: false,
    ...over,
  };
}

const MA = {
  id: 'ma-onsite-plain',
  place: 'ma-onsite',
  remoteBy: 'none',
} as const;
const LOC = { id: 'us-locremote-plain', remoteBy: 'location' } as const;

describe('buildInput', () => {
  it('builds valig inputs', () => {
    expect(ACTORS.valig.buildInput(search({}))).toEqual({
      country: 'us',
      title: 'software engineer',
      location: 'Remote',
      limit: 100,
      datePosted: '1',
    });
    expect(ACTORS.valig.buildInput(search(MA))).toMatchObject({
      country: 'ma',
      location: '',
    });
    expect(
      ACTORS.valig.buildInput(
        search({ place: 'uk-remote', remoteBy: 'location' }),
      ),
    ).toMatchObject({ country: 'uk', location: 'Remote' });
  });

  it('builds kaix inputs in rich mode', () => {
    expect(ACTORS.kaix.buildInput(search({}))).toEqual({
      keyword: 'software engineer',
      country: 'US',
      location: '',
      maxItems: 100,
      sort: 'date',
      fromDays: '1',
      remote: 'remote',
      searchMode: 'rich',
    });
    expect(ACTORS.kaix.buildInput(search(LOC))).toMatchObject({
      location: 'Remote',
      remote: '',
    });
    expect(ACTORS.kaix.buildInput(search(MA))).toMatchObject({
      country: 'MA',
      location: '',
      remote: '',
    });
    expect(
      ACTORS.kaix.buildInput(search({ place: 'uk-remote' })),
    ).toMatchObject({ country: 'UK', remote: 'remote' });
  });

  it('builds memo23 inputs', () => {
    const base = {
      position: 'software engineer',
      country: 'United States',
      location: '',
      datePosted: '1',
      remoteWork: 'REMOTE',
      sort: 'date',
      maxJobs: 50,
      includeCompanyDetails: false,
      resolveExternalApplyUrl: true,
      enrichEmails: false,
      expandToCities: false,
      deepSearch: false,
      flattenOutput: true,
    };
    expect(ACTORS.memo23.buildInput(search({}))).toEqual(base);
    expect(
      ACTORS.memo23.buildInput(
        search({ id: 'us-remote-plain-senior', seniorOnly: true }),
      ),
    ).toEqual({ ...base, experienceLevel: 'SENIOR_LEVEL' });
    expect(ACTORS.memo23.buildInput(search(LOC))).toMatchObject({
      location: 'Remote',
      remoteWork: '',
    });
    expect(ACTORS.memo23.buildInput(search(MA))).toMatchObject({
      country: 'Morocco',
      remoteWork: '',
      location: '',
    });
    expect(
      ACTORS.memo23.buildInput(search({ place: 'uk-remote' })),
    ).toMatchObject({ country: 'United Kingdom' });
  });

  it('builds curious_coder inputs', () => {
    expect(ACTORS.curious_coder.buildInput(search({}))).toEqual({
      country: 'us',
      query: 'software engineer',
      location: 'Remote',
      postedWithinDays: '1',
      count: 100,
    });
    expect(ACTORS.curious_coder.buildInput(search(MA))).toMatchObject({
      country: 'ma',
      location: '',
    });
  });

  it('declares events and rows', () => {
    expect(ACTORS.memo23.rowEvents).toEqual([
      'apify-default-dataset-item',
      'additional-data',
    ]);
    expect(ACTORS.valig.rowEvents).toEqual(['apify-default-dataset-item']);
    expect(ACTORS.memo23.rows).toBe(50);
    expect(ACTORS.kaix.hasRemoteFilter).toBe(true);
    expect(ACTORS.curious_coder.startEvent).toBe('apify-actor-start');
  });
});

describe('readItem', () => {
  const names: ActorName[] = ['valig', 'kaix', 'memo23', 'curious_coder'];
  const keys: Record<ActorName, string> = {
    valig: 'key',
    kaix: 'id',
    memo23: 'jobId',
    curious_coder: 'id',
  };

  it.each(names)('reads the %s fixture', (name) => {
    const raw = fixture(name);
    const job = ACTORS[name].readItem(raw);
    expect(job.jk).toBe(raw[keys[name]]);
    expect(job.title).toBeTruthy();
    expect(job.company).toBeTruthy();
    expect(job.descriptionText).toBeTruthy();
    expect(job.descriptionText).not.toContain('<');
  });

  it('reads employer apply urls', () => {
    expect(ACTORS.valig.readItem(fixture('valig')).applyUrl).toBe(
      fixture('valig').jobUrl,
    );
    expect(ACTORS.kaix.readItem(fixture('kaix')).applyUrl).toBe(
      (fixture('kaix').apply as { url: string }).url,
    );
    expect(ACTORS.memo23.readItem(fixture('memo23')).applyUrl).toBe(
      fixture('memo23').externalApplyLink,
    );
    expect(
      ACTORS.curious_coder.readItem(fixture('curious_coder')).applyUrl,
    ).toBe(fixture('curious_coder').originalApplyUrl);
  });

  it('reads easy apply, dates, salary and types where present', () => {
    expect(ACTORS.kaix.readItem(fixture('kaix'))).toMatchObject({
      easyApply: true,
      postedAt: '2026-09-23',
      remote: false,
      salary: '$152,200 - $243,700 a year',
      jobType: 'Full-time',
    });
    expect(
      ACTORS.curious_coder.readItem(fixture('curious_coder')),
    ).toMatchObject({
      postedAt: '2026-04-03T05:00:00.000Z',
      salary: '28-32 USD hour',
    });
  });

  it('strips markup from the kaix fixture description', () => {
    const raw = fixture('kaix');
    const description = raw.description as { text: string; html: string };
    expect(description.html).toContain('<');
    const fromText = ACTORS.kaix.readItem(raw).descriptionText ?? '';
    const fromHtml =
      ACTORS.kaix.readItem({ ...raw, description: { html: description.html } })
        .descriptionText ?? '';
    for (const out of [fromText, fromHtml]) {
      expect(out).toContain('Responsibilities');
      expect(out).toContain('APIs & internal tooling');
      expect(out).not.toMatch(/[<>]|&amp;/);
    }
  });

  it('cleans markup and entities on the text path too', () => {
    expect(
      ACTORS.memo23.readItem({ jobDescription: '<p>Build &amp; ship</p>' })
        .descriptionText,
    ).toBe('Build & ship');
  });

  it('reads memo23 easy apply and dates from the schema fields', () => {
    expect(ACTORS.memo23.readItem(fixture('memo23'))).toMatchObject({
      easyApply: false,
      postedAt: '2025-06-04T05:00:00.000Z',
      remote: false,
      salary: '$175,000 - $250,000 a year',
      jobType: 'Full-time',
      place: 'New York, NY',
    });
    expect(ACTORS.memo23.readItem({ postedAt: '1 day ago' }).postedAt).toBe(
      '1 day ago',
    );
  });

  it('turns html-only descriptions into plain text', () => {
    const job = ACTORS.valig.readItem({
      description: { html: '<div><p>Build <b>things</b></p></div>' },
    });
    expect(job.descriptionText).toBe('Build things');
  });

  it('nulls apply urls that point at indeed.com', () => {
    const url = 'https://www.indeed.com/applystart?jk=abc';
    expect(ACTORS.valig.readItem({ jobUrl: url }).applyUrl).toBeNull();
    expect(ACTORS.kaix.readItem({ apply: { url } }).applyUrl).toBeNull();
    expect(
      ACTORS.memo23.readItem({ externalApplyLink: url }).applyUrl,
    ).toBeNull();
    expect(
      ACTORS.curious_coder.readItem({ originalApplyUrl: url }).applyUrl,
    ).toBeNull();
  });

  it.each(names)('%s reads an empty item as all null', (name) => {
    const job = ACTORS[name].readItem({});
    expect(Object.values(job).every((value) => value === null)).toBe(true);
  });
});
