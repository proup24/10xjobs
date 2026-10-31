import { describe, expect, it } from 'vitest';
import { channelConfig } from './index';

describe('channelConfig', () => {
  it('defines an hourly UTC schedule for every channel', () => {
    expect(Object.values(channelConfig)).toHaveLength(4);
    for (const config of Object.values(channelConfig)) {
      expect(config.schedule).toEqual({
        pattern: '0 * * * *',
        timezone: 'UTC',
      });
    }
  });
});
