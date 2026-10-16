"use client";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";

export type PlaybackResult = "finished" | "stopped" | "failed";
const cursorKey = (callId: string) => `support-lab.voice.${callId}`;
function cursor(callId: string) {
  try {
    return Number(localStorage.getItem(cursorKey(callId))) || 0;
  } catch {
    return 0;
  }
}
function saveCursor(callId: string, id: number) {
  try {
    localStorage.setItem(cursorKey(callId), String(id));
  } catch {
    /* In-memory deduplication still works if storage is disabled. */
  }
}

export function useVoice() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [muted, setMuted] = useState(false),
    [rate, setRate] = useState(1),
    [fast, setFast] = useState(false);
  const [customerVoice, setCustomerVoice] = useState(""),
    [supportVoice, setSupportVoice] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const release = useRef<((result: PlaybackResult) => void) | null>(null);
  const seen = useRef(new Set<number>());
  const playbackEpoch = useRef(0);
  const queue = useRef<Promise<PlaybackResult>>(Promise.resolve("finished"));
  const pending = useRef(0);
  const playbackSettings = useRef({
    muted,
    fast,
    rate,
    customerVoice,
    supportVoice,
    voices,
  });
  playbackSettings.current = {
    muted,
    fast,
    rate,
    customerVoice,
    supportVoice,
    voices,
  };

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      playbackEpoch.current++;
      const hadSpeech = !!release.current;
      release.current?.("stopped");
      if (hadSpeech) window.speechSynthesis.cancel();
    };
  }, []);
  function stop() {
    playbackEpoch.current++;
    const hadSpeech = !!release.current;
    release.current?.("stopped");
    if (hadSpeech && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setSpeaking(false);
  }
  function hasPlayed(message: Message) {
    return (
      seen.current.has(message.id) || cursor(message.call_id) >= message.id
    );
  }
  function play(
    messages: Message[],
    replay = false,
    personaVoice = 0,
  ): Promise<PlaybackResult> {
    if (replay && pending.current) return Promise.resolve("stopped");
    const epoch = playbackEpoch.current;
    pending.current++;
    const task = queue.current
      .then(async (): Promise<PlaybackResult> => {
        if (epoch !== playbackEpoch.current) return "stopped";
        if (
          playbackSettings.current.muted ||
          playbackSettings.current.fast ||
          !("speechSynthesis" in window)
        )
          return "finished";
        setSpeaking(true);
        for (const message of messages.filter((m) => m.role !== "system")) {
          if (epoch !== playbackEpoch.current) return "stopped";
          const { muted, fast, rate, customerVoice, supportVoice, voices } =
            playbackSettings.current;
          if (muted || fast) return "stopped";
          if (!replay && hasPlayed(message)) continue;
          const previousCursor = cursor(message.call_id);
          seen.current.add(message.id);
          saveCursor(message.call_id, Math.max(previousCursor, message.id));
          const result = await new Promise<PlaybackResult>((resolve) => {
            let utterance: SpeechSynthesisUtterance | undefined;
            let done = false;
            let timeout: ReturnType<typeof setTimeout>;
            const finish = (status: PlaybackResult) => {
              if (done) return;
              done = true;
              clearTimeout(timeout);
              if (utterance) utterance.onend = utterance.onerror = null;
              if (release.current === finish) release.current = null;
              resolve(status);
            };
            release.current = finish;
            try {
              utterance = new SpeechSynthesisUtterance(message.text);
              const english = voices.filter((v) => v.lang.startsWith("en"));
              const voiceName =
                message.role === "support" ? supportVoice : customerVoice;
              utterance.voice =
                voices.find((v) => v.name === voiceName) ||
                english[
                  message.role === "support"
                    ? (personaVoice + 1) % Math.max(english.length, 1)
                    : personaVoice % Math.max(english.length, 1)
                ] ||
                voices[0] ||
                null;
              utterance.rate = rate;
              utterance.pitch = message.role === "support" ? 0.95 : 1.05;
              utterance.onend = () => finish("finished");
              utterance.onerror = () => {
                finish(epoch === playbackEpoch.current ? "failed" : "stopped");
                window.speechSynthesis.cancel();
              };
              // Never advance another speaker when completion events are missing.
              timeout = setTimeout(
                () => {
                  finish("failed");
                  window.speechSynthesis.cancel();
                },
                Math.max(15000, (message.text.length * 150) / rate),
              );
              window.speechSynthesis.speak(utterance);
            } catch {
              finish("failed");
            }
          });
          if (result === "failed") {
            seen.current.delete(message.id);
            if (cursor(message.call_id) === message.id)
              saveCursor(message.call_id, previousCursor);
            return "failed";
          }
          if (result !== "finished") return result;
        }
        return "finished";
      })
      .catch((): PlaybackResult => "failed")
      .finally(() => {
        pending.current--;
        if (!pending.current) setSpeaking(false);
      });
    queue.current = task;
    return task;
  }
  return {
    voices,
    muted,
    setMuted,
    rate,
    setRate,
    fast,
    setFast,
    customerVoice,
    setCustomerVoice,
    supportVoice,
    setSupportVoice,
    speaking,
    play,
    stop,
    hasPlayed,
  };
}
