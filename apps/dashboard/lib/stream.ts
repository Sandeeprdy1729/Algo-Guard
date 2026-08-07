'use client';
import { useEffect, useState } from 'react';

type Handler = (evt: MessageEvent) => void;

export function useEventStream(handlers: Record<string, Handler>) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource('/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const registered: [string, Handler][] = [];
    for (const [type, fn] of Object.entries(handlers)) {
      es.addEventListener(type, fn as EventListener);
      registered.push([type, fn]);
    }
    return () => {
      for (const [type, fn] of registered) es.removeEventListener(type, fn as EventListener);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { connected };
}
