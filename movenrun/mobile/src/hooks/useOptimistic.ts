import { useState, useCallback } from 'react';

export type OptimisticStatus = 'idle' | 'pending' | 'confirmed' | 'failed';

interface Options<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
  /** How long to show success chip before resetting (ms). Default 1800. */
  successDuration?: number;
}

interface Return<T, Args extends unknown[]> {
  execute: (...args: Args) => Promise<T | undefined>;
  status: OptimisticStatus;
  error: Error | null;
  reset: () => void;
}

/**
 * Wraps an async action with optimistic status tracking.
 *
 * Usage pattern:
 *   // 1. Update local state instantly (optimistic)
 *   setMyData(expectedValue);
 *   // 2. Fire execute — chip shows "confirming on Base..."
 *   await execute(args);
 *   // On success: chip dissolves. On failure: revert state + shake.
 */
export function useOptimistic<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  options: Options<T> = {},
): Return<T, Args> {
  const { onSuccess, onError, successDuration = 1800 } = options;
  const [status, setStatus] = useState<OptimisticStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setStatus('pending');
      setError(null);
      try {
        const result = await fn(...args);
        setStatus('confirmed');
        onSuccess?.(result);
        setTimeout(() => setStatus('idle'), successDuration);
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setStatus('failed');
        setError(err);
        onError?.(err);
        setTimeout(() => setStatus('idle'), 3000);
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, successDuration],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { execute, status, error, reset };
}
