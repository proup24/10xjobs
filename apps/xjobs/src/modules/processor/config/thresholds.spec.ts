import { Logger } from '@nestjs/common';
import { thresholdFor } from './thresholds';

afterEach(() => vi.restoreAllMocks());

describe('thresholdFor', () => {
  it('returns the pinned threshold, junk keys sharing one', () => {
    expect(thresholdFor('typesafe/jev-1.14', 'seniority')).toBe(0.8);
    expect(thresholdFor('typesafe/jev-1.14', 'junk:spam')).toBe(0.8);
  });

  it('returns null for an unknown model and warns once per model', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(thresholdFor('other/model-a', 'seniority')).toBeNull();
    expect(thresholdFor('other/model-a', 'arrangement')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('other/model-a');
    expect(thresholdFor('other/model-b', 'seniority')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
