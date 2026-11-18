import { normalizeConfig } from '../config';
import { nextProcessing, type ProcessingState } from './processing';

const day = 24 * 60 * 60 * 1000;
const seen = new Date('2026-10-01T00:00:00Z');
const after = (days: number) => new Date(seen.getTime() + days * day);
const processed: ProcessingState = {
  status: 'processed',
  reason: 'new',
  requestedAt: seen,
};
const none: ProcessingState = { status: null, reason: null, requestedAt: null };

describe('nextProcessing', () => {
  it('uses a three-week reopen threshold', () => {
    expect(normalizeConfig.reopenAfterMs).toBe(21 * day);
  });

  it('sends an archived job to pending on a newer observation', () => {
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: new Date(seen.getTime() - 60_000),
        observedAt: seen,
        current: { status: 'archived', reason: 'new', requestedAt: seen },
        rebuild: false,
        sightingOnly: false,
      }),
    ).toEqual({ status: 'pending', reason: 'reopened', requestedAt: seen });
  });

  it('leaves an archived job archived on a replay of an older or same batch', () => {
    const archived: ProcessingState = {
      status: 'archived',
      reason: 'new',
      requestedAt: seen,
    };
    for (const previousLastSeenAt of [after(1), seen]) {
      expect(
        nextProcessing({
          created: false,
          previousLastSeenAt,
          observedAt: seen,
          current: archived,
          rebuild: false,
          sightingOnly: false,
        }),
      ).toBe(archived);
    }
  });

  it('leaves an archived job archived on a rebuild', () => {
    const archived: ProcessingState = {
      status: 'archived',
      reason: 'new',
      requestedAt: seen,
    };
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: new Date(seen.getTime() - 60_000),
        observedAt: seen,
        current: archived,
        rebuild: true,
        sightingOnly: false,
      }),
    ).toBe(archived);
  });

  it('sends a new job to Process', () => {
    expect(
      nextProcessing({
        created: true,
        previousLastSeenAt: null,
        observedAt: seen,
        current: none,
        rebuild: false,
        sightingOnly: false,
      }),
    ).toEqual({ status: 'pending', reason: 'new', requestedAt: seen });
  });

  it('leaves a job seen again within three weeks alone', () => {
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: seen,
        observedAt: after(20),
        current: processed,
        rebuild: false,
        sightingOnly: false,
      }),
    ).toBe(processed);
  });

  it('reopens a job seen again after exactly three weeks', () => {
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: seen,
        observedAt: after(21),
        current: processed,
        rebuild: false,
        sightingOnly: false,
      }),
    ).toEqual({
      status: 'pending',
      reason: 'reopened',
      requestedAt: after(21),
    });
  });

  it('never reopens on an observation older than the last one', () => {
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: after(30),
        observedAt: seen,
        current: processed,
        rebuild: false,
        sightingOnly: false,
      }),
    ).toBe(processed);
  });

  it('reopens a job Process is still working on', () => {
    expect(
      nextProcessing({
        created: false,
        previousLastSeenAt: seen,
        observedAt: after(22),
        current: { ...processed, status: 'processing' },
        rebuild: false,
        sightingOnly: false,
      }).status,
    ).toBe('pending');
  });

  it('changes nothing during a rebuild', () => {
    expect(
      nextProcessing({
        created: true,
        previousLastSeenAt: null,
        observedAt: seen,
        current: none,
        rebuild: true,
        sightingOnly: false,
      }),
    ).toBe(none);
  });

  describe('sightingOnly', () => {
    const base = {
      created: false,
      observedAt: after(30),
      rebuild: false,
      sightingOnly: true,
    };

    it('leaves an archived job archived on a newer sighting', () => {
      const current: ProcessingState = {
        status: 'archived',
        reason: 'new',
        requestedAt: seen,
      };
      expect(
        nextProcessing({ ...base, previousLastSeenAt: seen, current }),
      ).toBe(current);
    });

    it('does not reopen a processed job unseen past the threshold', () => {
      expect(
        nextProcessing({
          ...base,
          previousLastSeenAt: seen,
          current: processed,
        }),
      ).toBe(processed);
    });
  });
});
