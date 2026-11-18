import {
  Channel,
  TRIAL_CHANNELS,
  isLinkedinJobBoard,
  isTrialChannel,
} from './channel.enum';

describe('channel predicates', () => {
  it('isLinkedinJobBoard covers the job board and every trial channel', () => {
    expect(isLinkedinJobBoard(Channel.LINKEDIN_JOB_BOARD)).toBe(true);
    expect(isLinkedinJobBoard(Channel.LINKEDIN_JOB_BOARD_CHEAP)).toBe(true);
    expect(isLinkedinJobBoard(Channel.LINKEDIN_POSTS)).toBe(false);
    expect(isLinkedinJobBoard(Channel.ASHBY)).toBe(false);
    expect(isLinkedinJobBoard(Channel.GREEN_HOUSE)).toBe(false);
  });

  it('isTrialChannel is true only for the cheap job board', () => {
    expect(isTrialChannel(Channel.LINKEDIN_JOB_BOARD_CHEAP)).toBe(true);
    for (const c of [
      Channel.LINKEDIN_JOB_BOARD,
      Channel.LINKEDIN_POSTS,
      Channel.ASHBY,
      Channel.GREEN_HOUSE,
    ]) {
      expect(isTrialChannel(c)).toBe(false);
    }
  });

  it('every trial channel is a LinkedIn job board', () => {
    expect(TRIAL_CHANNELS.every(isLinkedinJobBoard)).toBe(true);
  });
});
