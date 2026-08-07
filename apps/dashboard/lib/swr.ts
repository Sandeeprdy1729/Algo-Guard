'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiError } from './api';

interface UseFetchState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

/** Minimal SWR-ish hook without the dependency. */
export function useFetch<T>(path: string | null): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path != null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<T>(path);
      setData(d);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), { status: 0 }));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
