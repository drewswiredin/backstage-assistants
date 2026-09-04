import { renderHook, act } from '@testing-library/react';
import { markTurnEnded, useTurnEndReason } from './interruptedTurns';

describe('interruptedTurns', () => {
  it('reports undefined for a turn that has not ended', () => {
    const { result } = renderHook(() => useTurnEndReason('msg-unknown'));
    expect(result.current).toBeUndefined();
  });

  it('notifies readers when a turn ends and keys by message id', () => {
    const a = renderHook(() => useTurnEndReason('msg-a'));
    const b = renderHook(() => useTurnEndReason('msg-b'));

    act(() => markTurnEnded('msg-a', 'interrupted'));
    expect(a.result.current).toBe('interrupted');
    expect(b.result.current).toBeUndefined();

    act(() => markTurnEnded('msg-b', 'disconnected'));
    expect(a.result.current).toBe('interrupted');
    expect(b.result.current).toBe('disconnected');
  });

  it('is idempotent for a repeated reason', () => {
    const { result } = renderHook(() => useTurnEndReason('msg-c'));
    act(() => markTurnEnded('msg-c', 'disconnected'));
    act(() => markTurnEnded('msg-c', 'disconnected'));
    expect(result.current).toBe('disconnected');
  });
});
