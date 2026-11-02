import type { QuerySearchBuilderRow } from 'src/database';
import { withoutClaim } from './query-search-builder.response.dto';

describe('withoutClaim', () => {
  it('drops the collection claim columns and keeps the rest', () => {
    const row = {
      id: 'b1',
      keyword: 'backend',
      coveredUntil: null,
      claimRunId: 'r1',
      claimWindowStart: new Date(0),
      claimWindowEnd: new Date(1),
      claimExpiresAt: new Date(2),
    } as unknown as QuerySearchBuilderRow;

    expect(withoutClaim(row)).toEqual({
      id: 'b1',
      keyword: 'backend',
      coveredUntil: null,
    });
  });
});
