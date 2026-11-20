import { postRunFailure } from './linkedin-posts.log';

describe('postRunFailure', () => {
  it('reports an unreadable log', () => {
    expect(postRunFailure(null)).toBe('run log unavailable');
  });

  it('finds No available resource', () => {
    const log =
      '2026-11-20T06:33:25.458Z Error scraping item#1 {"sortBy":"date","page":1,"search":"hiring … remote"}: No available resource';
    expect(postRunFailure(log)).toBe('no available resource');
  });

  it('finds Too many boolean operators', () => {
    const log =
      '2026-11-20T06:33:25.458Z Error scraping item#1 {"search":"x"}: Too many boolean operators';
    expect(postRunFailure(log)).toBe('too many boolean operators');
  });

  it('is null for a clean log', () => {
    expect(postRunFailure('2026-11-20T06:33:25.458Z Done')).toBeNull();
  });
});
