"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { SupportedLang } from "@/lib/lang/types";
import type { UiStrings } from "@/lib/lang/ui-strings";

/**
 * The prompt input.
 *
 * The reference puts a microphone in the bottom-left, so it is wired to the
 * Web Speech API rather than shipped as a dead affordance — and hidden
 * entirely where the browser has no support, since a button that cannot work
 * is worse than no button.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech support is a fact about the browser, not React state, so it is read
 * through `useSyncExternalStore` — that gives a stable server snapshot to
 * hydrate against and avoids setting state from an effect on mount.
 */
const noopSubscribe = () => () => {};
const speechSnapshot = () => getRecognition() !== null;
const speechServerSnapshot = () => false;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  /** `hero` sits on the orange card; `flat` sits on the stage in a thread. */
  variant?: "hero" | "flat";
  /** Resting height in px. The reference hero input is tall. */
  minHeight?: number;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Labels in the language of the latest reply. */
  t: UiStrings;
  /** The same language, for dictation; English when there is no reply yet. */
  lang?: SupportedLang;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  placeholder,
  variant = "hero",
  minHeight = 132,
  inputRef,
  t,
  lang,
}: ComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? internalRef;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [listening, setListening] = useState(false);
  const speechSupported = useSyncExternalStore(
    noopSubscribe,
    speechSnapshot,
    speechServerSnapshot,
  );

  // Grow to fit the content, from the resting height up to a ceiling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${minHeight}px`;
    if (el.scrollHeight > minHeight) {
      el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    }
  }, [minHeight, ref, value]);

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) return;

    const recognition = new Ctor();
    // Every supported language has an Indian BCP 47 tag; a reader who was just
    // answered in Bengali is far more likely to dictate the follow-up in it.
    recognition.lang = `${lang ?? "en"}-IN`;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript)
        .join(" ")
        .trim();
      if (transcript) onChange(value ? `${value} ${transcript}` : transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={variant === "flat" ? "composer composer--flat" : "composer"}>
      <label htmlFor="prompt" className="sr-only">
        {t.nameADish}
      </label>

      <textarea
        id="prompt"
        ref={ref}
        className="composer__field"
        style={{ height: minHeight }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
      />

      <div className="composer__bar">
        {speechSupported ? (
          <button
            type="button"
            className={listening ? "icon-btn icon-btn--recording" : "icon-btn"}
            onClick={toggleMic}
            aria-label={listening ? t.stopDictation : t.dictate}
            aria-pressed={listening}
          >
            <Mic size={18} aria-hidden />
          </button>
        ) : (
          <span aria-hidden />
        )}

        {busy ? (
          <button type="button" className="send-btn" onClick={onStop} aria-label={t.stopGenerating}>
            <Square size={15} fill="currentColor" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={onSubmit}
            disabled={!value.trim()}
            aria-label={t.send}
          >
            <ArrowUp size={19} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
