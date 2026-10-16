"use client";
import { useEffect, useRef, useState } from "react";

export const playbackLock = "support-lab-conversation-playback";

// Hold ownership across model requests AND speech. Other tabs observe the call.
export function usePlaybackOwner(
  active: boolean,
  working: boolean,
  onYield: () => void,
) {
  const [owned, setOwned] = useState(false);
  const [willing, setWilling] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const held = useRef(false),
    wants = useRef(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const identity = useRef("");
  const yieldPlayback = useRef(onYield);
  yieldPlayback.current = onYield;

  useEffect(() => {
    identity.current ||= crypto.randomUUID();
    if (!("locks" in navigator) || !("BroadcastChannel" in window)) {
      setUnavailable(true);
      return;
    }
    const connection = new BroadcastChannel(playbackLock);
    channel.current = connection;
    connection.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: string; owner?: string } | null;
      if (
        !data ||
        !["claim", "owned"].includes(data?.type || "") ||
        typeof data.owner !== "string" ||
        data.owner === identity.current
      )
        return;
      if (data.type === "owned") {
        // Rejoin the waiting queue after the requested tab has acquired the
        // lock, so closing that tab still allows automatic failover.
        wants.current = true;
        setWilling(true);
      } else {
        wants.current = false;
        setWilling(false);
        yieldPlayback.current();
      }
    };
    return () => {
      connection.close();
      channel.current = null;
    };
  }, []);

  // Retain the lock until a previous model request unwinds after a transfer.
  const needed = working || (active && willing);
  useEffect(() => {
    if (!needed || unavailable || !("locks" in navigator)) return;
    const abort = new AbortController();
    let disposed = false;
    let release: (() => void) | undefined;
    void navigator.locks
      .request(playbackLock, { signal: abort.signal }, async () => {
        if (disposed) return;
        held.current = true;
        setOwned(true);
        channel.current?.postMessage({
          type: "owned",
          owner: identity.current,
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        held.current = false;
        if (!disposed) setOwned(false);
      })
      .catch(() => {
        if (!disposed) setUnavailable(true);
      });
    return () => {
      disposed = true;
      abort.abort();
      held.current = false;
      setOwned(false);
      release?.();
    };
  }, [needed, unavailable]);

  function claim() {
    wants.current = true;
    setWilling(true);
    channel.current?.postMessage({ type: "claim", owner: identity.current });
    // A current owner can claim again on Resume without reacquiring its lock.
    // Waiting tabs still need the acknowledgment to rejoin the failover queue.
    if (held.current)
      channel.current?.postMessage({ type: "owned", owner: identity.current });
  }
  return {
    controlling: owned && willing,
    unavailable,
    canControl: () => held.current && wants.current,
    claim,
  };
}
