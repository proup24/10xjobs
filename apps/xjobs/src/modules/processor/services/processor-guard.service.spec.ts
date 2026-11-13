import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorConfig } from '../config/processor.config';
import type { LimitObservation } from '../models/claude/stream';
import { MemoryProcessorRepository } from '../testing/fakes';
import { PROVIDER_PAUSE_MS, ProcessorGuard } from './processor-guard.service';

const NOW = new Date('2026-11-02T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

const config: ProcessorConfig = {
  extractionModel: 'm',
  concurrency: 1,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 20,
  weeklyStopAt: 0.85,
  generationTries: 3,
};

const obs = (
  kind: LimitObservation['kind'],
  utilization: number | null,
  resetsAt: Date | null = at(3_600_000),
): LimitObservation => ({ kind, status: 'allowed', utilization, resetsAt });

describe('ProcessorGuard', () => {
  let clock = NOW;
  const make = (c: Partial<ProcessorConfig> = {}) => {
    clock = NOW;
    const repo = new MemoryProcessorRepository(() => clock);
    return new ProcessorGuard(repo, { ...config, ...c }, () => clock);
  };
  afterEach(() => vi.restoreAllMocks());

  it('pauseUntil keeps the later end', () => {
    const guard = make();
    guard.pauseUntil(at(2000), 'usage_limit', 'a');
    guard.pauseUntil(at(1000), 'weekly_reserve', 'b');
    expect(guard.pauseState()).toEqual({
      until: at(2000),
      reason: 'usage_limit',
      detail: 'a',
    });
    guard.pauseUntil(at(3000), 'weekly_reserve', 'c');
    expect(guard.pauseState()?.until).toEqual(at(3000));
  });

  it('logs only when the end moves later, warn for limits and error for auth', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const guard = make();
    guard.pauseUntil(at(2000), 'usage_limit', 'a');
    guard.pauseUntil(at(2000), 'usage_limit', 'a');
    guard.pauseUntil(at(1000), 'usage_limit', 'a');
    expect(warn).toHaveBeenCalledTimes(1);
    guard.pauseUntil(at(3000), 'auth', 'x');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('the pause ends at its time', () => {
    const guard = make();
    guard.pauseUntil(at(1000), 'usage_limit', 'a');
    expect(guard.isPaused()).toBe(true);
    clock = at(1000);
    expect(guard.isPaused()).toBe(false);
    expect(guard.pauseState()).toBeNull();
  });

  it('pause(reason) is the auth pause for ten minutes and names the fix', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const guard = make();
    guard.pause('401');
    const state = guard.pauseState();
    expect(state).toMatchObject({
      until: at(PROVIDER_PAUSE_MS),
      reason: 'auth',
    });
    expect(state?.detail).toContain('claude setup-token');
  });

  it('clearPause ends the pause only for the same reason', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const guard = make();
    guard.pauseUntil(at(5000), 'startup', 'no credential');
    guard.clearPause('auth');
    expect(guard.isPaused()).toBe(true);
    guard.clearPause('startup');
    expect(guard.isPaused()).toBe(false);
  });

  describe('observeLimits', () => {
    it('does not pause a weekly limit at 0.84, pauses at 0.85 until its reset', () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const guard = make();
      guard.observeLimits([obs('weekly', 0.84)]);
      expect(guard.isPaused()).toBe(false);
      expect(guard.lastWeeklyUtilization()).toBe(0.84);
      guard.observeLimits([obs('weekly', 0.85, at(9000))]);
      expect(guard.pauseState()).toMatchObject({
        until: at(9000),
        reason: 'weekly_reserve',
      });
      expect(guard.lastWeeklyUtilization()).toBe(0.85);
    });

    it('never pauses the five-hour window on utilization', () => {
      const guard = make();
      guard.observeLimits([obs('five_hour', 0.99)]);
      expect(guard.isPaused()).toBe(false);
    });

    it('pauses on the Sonnet weekly limit at 0.9', () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const guard = make();
      guard.observeLimits([obs('weekly_sonnet', 0.9)]);
      expect(guard.pauseState()?.reason).toBe('weekly_reserve');
    });

    it('records utilization but cannot pause without a reset time', () => {
      const guard = make();
      guard.observeLimits([obs('weekly', 0.95, null)]);
      expect(guard.isPaused()).toBe(false);
      expect(guard.lastWeeklyUtilization()).toBe(0.95);
    });

    it('honours a configured weeklyStopAt', () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const guard = make({ weeklyStopAt: 0.5 });
      guard.observeLimits([obs('weekly', 0.5)]);
      expect(guard.isPaused()).toBe(true);
    });
  });

  describe('check', () => {
    it('is over_budget once spend reaches the budget', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const repo = new MemoryProcessorRepository(() => NOW);
      repo.addSpend(25);
      const guard = new ProcessorGuard(repo, config, () => NOW);
      await expect(guard.check()).resolves.toBe('over_budget');
    });

    it('never is over_budget with a budget of 0', async () => {
      const repo = new MemoryProcessorRepository(() => NOW);
      repo.addSpend(1000);
      const guard = new ProcessorGuard(
        repo,
        { ...config, dailyBudgetUsd: 0 },
        () => NOW,
      );
      await expect(guard.check()).resolves.toBeNull();
    });
  });
});
