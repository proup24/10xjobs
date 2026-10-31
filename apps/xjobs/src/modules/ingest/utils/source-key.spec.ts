import { Channel } from 'src/common/enums';
import ashbyFailed from './fixtures/ashby-failed.json';
import ashby from './fixtures/ashby.json';
import greenhouse from './fixtures/greenhouse.json';
import linkedinJob from './fixtures/linkedin-job.json';
import linkedinPost from './fixtures/linkedin-post.json';
import { sourceKey } from './source-key';

describe('sourceKey', () => {
  describe('LinkedIn job board', () => {
    it('uses the item id', () => {
      expect(sourceKey(Channel.LINKEDIN_JOB_BOARD, linkedinJob)).toEqual({
        key: 'id:4012345678',
      });
    });

    it('takes the id from the posting URL when the item has none', () => {
      const { id: _id, ...noId } = linkedinJob;
      expect(sourceKey(Channel.LINKEDIN_JOB_BOARD, noId)).toEqual({
        key: 'id:4012345678',
      });
    });

    it('treats blank and sentinel ids as missing', () => {
      for (const id of ['', '  ', 'undefined', 'null'])
        expect(
          sourceKey(Channel.LINKEDIN_JOB_BOARD, { ...linkedinJob, id }),
        ).toEqual({ key: 'id:4012345678' });
    });

    it('falls back to the canonical URL when no id can be found', () => {
      expect(
        sourceKey(Channel.LINKEDIN_JOB_BOARD, {
          url: 'https://WWW.linkedin.com/jobs/collections/remote/?trk=x#a',
        }),
      ).toEqual({
        key: 'url:https://www.linkedin.com/jobs/collections/remote/',
      });
    });

    it('rejects an item with neither id nor URL', () => {
      expect(sourceKey(Channel.LINKEDIN_JOB_BOARD, { title: 'x' })).toEqual({
        invalid: 'no source id or URL',
      });
    });
  });

  describe('LinkedIn posts', () => {
    it('uses the post id', () => {
      expect(sourceKey(Channel.LINKEDIN_POSTS, linkedinPost)).toEqual({
        key: 'id:7390000000000000001',
      });
    });

    it('takes the activity id from an urn, then from the post URL', () => {
      const { id: _id, ...noId } = linkedinPost;
      expect(
        sourceKey(Channel.LINKEDIN_POSTS, {
          ...noId,
          urn: 'urn:li:activity:7390000000000000002',
        }),
      ).toEqual({ key: 'id:7390000000000000002' });
      expect(sourceKey(Channel.LINKEDIN_POSTS, noId)).toEqual({
        key: 'id:7390000000000000001',
      });
    });
  });

  describe('Ashby and Greenhouse', () => {
    it('keys an Ashby posting by organization and posting id from the hit URL', () => {
      expect(sourceKey(Channel.ASHBY, ashby)).toEqual({
        key: 'posting:acme/0b1c2d3e-0000-4000-8000-000000000001',
      });
    });

    it('gives a failed fetch the same key as the fetched posting', () => {
      expect(sourceKey(Channel.ASHBY, ashbyFailed)).toEqual(
        sourceKey(Channel.ASHBY, ashby),
      );
    });

    it('keys Greenhouse by board and job id on every host', () => {
      expect(sourceKey(Channel.GREEN_HOUSE, greenhouse)).toEqual({
        key: 'posting:acme/42',
      });
      expect(
        sourceKey(Channel.GREEN_HOUSE, {
          hit: { url: 'https://job-boards.eu.greenhouse.io/acme/jobs/42' },
          posting: null,
          fetchError: 'timeout',
        }),
      ).toEqual({ key: 'posting:acme/42' });
    });

    it('rejects a hit that is not a posting page', () => {
      expect(
        sourceKey(Channel.ASHBY, {
          hit: { url: 'https://jobs.ashbyhq.com/acme' },
          posting: null,
          fetchError: null,
        }),
      ).toEqual({ invalid: 'not a posting URL' });
      expect(
        sourceKey(Channel.GREEN_HOUSE, {
          hit: {
            url: 'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000001',
          },
        }),
      ).toEqual({ invalid: 'not a posting URL' });
    });
  });

  it('rejects a payload that is not a JSON object', () => {
    for (const payload of [null, 'x', 3, ['a']])
      expect(sourceKey(Channel.LINKEDIN_JOB_BOARD, payload)).toEqual({
        invalid: 'payload is not a JSON object',
      });
  });
});
