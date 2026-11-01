import { FakeSearchSegmentsRepository } from './testing/fakes';

describe('advanceCursors', () => {
  it('moves only the given builders forward, never back', async () => {
    const repository = new FakeSearchSegmentsRepository();
    const early = new Date('2026-10-31T10:00:00Z');
    const late = new Date('2026-10-31T12:00:00Z');
    await repository.advanceCursors(['qs-1', 'qs-2'], late);
    await repository.advanceCursors(['qs-1'], early);
    expect(repository.cursors.get('qs-1')).toEqual(late);
    expect(repository.cursors.get('qs-2')).toEqual(late);
    expect(repository.cursors.has('qs-3')).toBe(false);
  });
});
