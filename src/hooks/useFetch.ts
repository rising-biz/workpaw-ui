import { useState, useEffect, useRef, useCallback } from "react";

interface UseFetchOptions<T> {
  initialData?: T;
  immediate?: boolean;
  /**
   * External values the fetcher closes over (route params, ids, filters…).
   * The fetcher itself is held in a ref (inline closures are allowed without
   * re-fetch loops), so it does NOT re-trigger on identity change — anything
   * the fetcher READS must be listed here to re-fetch when it changes, same
   * contract as SWR's `key` / react-query's `queryKey` / ahooks'
   * `refreshDeps`. The array must keep a stable length across renders.
   */
  refreshDeps?: readonly unknown[];
}

interface UseFetchResult<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetch primitive. The fetcher receives an AbortSignal: useFetch aborts the
 * in-flight request when the component unmounts or `refreshDeps` change, so
 * pass it through to `fetch` when possible —
 *
 *   useFetch((signal) => getItem(id, signal), { refreshDeps: [id] })
 *
 * Callers that ignore the signal keep working (a `() => Promise<T>` closure is
 * still assignable); those requests are merely abandoned rather than aborted,
 * and the monotonic sequence below still drops their stale results.
 */
export function useFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseFetchOptions<T> = {}
): UseFetchResult<T> {
  const { initialData = null, immediate = true, refreshDeps } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  // Hold the latest fetcher identity in a ref so callers may pass inline
  // closures: the fetch effect below must not depend on fetcher identity,
  // otherwise a new function literal per render loops forever. Values the
  // fetcher captures belong in `refreshDeps` (see UseFetchOptions).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Monotonic request sequence: only the most recent request may commit
  // state, so a slow earlier response can never overwrite newer data (this
  // also makes refreshDeps-triggered refetches safe against races).
  const requestSeqRef = useRef(0);
  // Controller of the in-flight request; aborted by the fetch effect cleanup
  // (unmount / refreshDeps change) so abandoned work stops at the network.
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current)
        return; // stale/aborted, drop it
      setData(result);
    } catch (err) {
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current)
        return; // stale/aborted, drop it
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!controller.signal.aborted && requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Re-run on mount (immediate) AND whenever the declared dependencies
  // change. refreshDeps is spread element-wise so plain inline arrays work;
  // keep its length stable across renders. Cleanup aborts any in-flight
  // request (both on unmount and on dep change) and advances the sequence so
  // a promise settling in the same tick can never commit afterwards.
  useEffect(() => {
    if (immediate) {
      void refetch();
    }
    return () => {
      abortRef.current?.abort();
      requestSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, refetch, ...(refreshDeps ?? [])]);

  return { data, error, loading, refetch };
}
