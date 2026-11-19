import {
  Channel,
  ACTIVE_CHANNELS,
  TRIAL_CHANNELS,
  isLinkedinJobBoard,
  isTrialChannel,
} from './channel.enum';

describe('channel predicates', () => {
  it('isLinkedinJobBoard covers the job board and every trial channel', () => {
    expect(isLinkedinJobBoard(Channel.LINKEDIN_JOB_BOARD)).toBe(true);
    expect(isLinkedinJobBoard(Channel.LINKEDIN_JOB_BOARD_CHEAP)).toBe(true);
    expect(isLinkedinJobBoard(Channel.LINKEDIN_JOB_BOARD_BEBITY)).toBe(true);
    expect(isLinkedinJobBoard(Channel.LINKEDIN_POSTS)).toBe(false);
    expect(isLinkedinJobBoard(Channel.ASHBY)).toBe(false);
    expect(isLinkedinJobBoard(Channel.GREEN_HOUSE)).toBe(false);
  });

  it('isTrialChannel is true only for the trial job boards', () => {
    expect(isTrialChannel(Channel.LINKEDIN_JOB_BOARD_CHEAP)).toBe(true);
    expect(isTrialChannel(Channel.LINKEDIN_JOB_BOARD_BEBITY)).toBe(true);
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

  it('searches are built for the bebity channel', () => {
    expect(ACTIVE_CHANNELS).toContain(Channel.LINKEDIN_JOB_BOARD_BEBITY);
  });
});
