"use client";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";

export function useVoice() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [muted, setMuted] = useState(false),
    [rate, setRate] = useState(1),
    [fast, setFast] = useState(false);
  const [customerVoice, setCustomerVoice] = useState(""),
    [supportVoice, setSupportVoice] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const seen = useRef(new Set<number>());
  const playbackEpoch = useRef(0);
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
      window.speechSynthesis.cancel();
      release.current?.();
    };
  }, []);
  function stop() {
    playbackEpoch.current++;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    release.current?.();
    release.current = null;
    setSpeaking(false);
  }
  async function play(messages: Message[], replay = false, personaVoice = 0) {
    if (
      playbackSettings.current.muted ||
      playbackSettings.current.fast ||
      !("speechSynthesis" in window)
    )
      return;
    const epoch = playbackEpoch.current;
    for (const message of messages.filter((m) => m.role !== "system")) {
      if (epoch !== playbackEpoch.current) break;
      const { muted, fast, rate, customerVoice, supportVoice, voices } =
        playbackSettings.current;
      if (muted || fast) break;
      if (!replay && seen.current.has(message.id)) continue;
      seen.current.add(message.id);
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(message.text);
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
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          setSpeaking(false);
          release.current = null;
          resolve();
        };
        // Some browser engines omit completion events; avoid blocking the next turn indefinitely.
        const timeout = setTimeout(
          () => {
            window.speechSynthesis.cancel();
            finish();
          },
          Math.max(15000, (message.text.length * 150) / rate),
        );
        release.current = finish;
        utterance.onend = finish;
        utterance.onerror = finish;
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
      });
      if (playbackSettings.current.muted || playbackSettings.current.fast)
        break;
    }
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
  };
}
