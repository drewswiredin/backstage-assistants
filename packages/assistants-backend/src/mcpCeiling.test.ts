import { pausableTimeout } from './mcp';

describe('pausableTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts after its time, not counting the time it was paused', () => {
    const ceiling = pausableTimeout(60_000);
    jest.advanceTimersByTime(40_000);
    ceiling.pause();
    jest.advanceTimersByTime(300_000);
    expect(ceiling.signal.aborted).toBe(false);
    ceiling.resume();
    jest.advanceTimersByTime(19_000);
    expect(ceiling.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1_000);
    expect(ceiling.signal.aborted).toBe(true);
    expect((ceiling.signal.reason as Error).name).toBe('TimeoutError');
  });

  it('never aborts once cleared', () => {
    const ceiling = pausableTimeout(1_000);
    ceiling.clear();
    jest.advanceTimersByTime(5_000);
    expect(ceiling.signal.aborted).toBe(false);
  });
});
