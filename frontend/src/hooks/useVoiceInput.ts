"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseVoiceInputOptions {
  /**
   * Language for speech recognition (default: "id-ID" for Indonesian)
   */
  lang?: string;
  /**
   * Called when a final transcript is received
   */
  onTranscript?: (transcript: string) => void;
  /**
   * Called when an error occurs (e.g., microphone access denied)
   */
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  /**
   * Whether the Web Speech API is supported in this browser
   */
  isSupported: boolean;
  /**
   * Whether voice recognition is currently active
   */
  isListening: boolean;
  /**
   * Current transcript (interim or final)
   */
  transcript: string | null;
  /**
   * Toggle voice input on/off
   */
  toggleVoiceInput: () => void;
  /**
   * Clear the current transcript
   */
  clearTranscript: () => void;
}

/**
 * Hook for managing Web Speech API voice input
 * Supports Indonesian language by default
 */
export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { lang = "id-ID", onTranscript, onError } = options;
  
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Check for Web Speech API support on mount + cleanup on unmount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
    }
    return () => {
      // Stop any active recognition on unmount to release mic
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript(null);
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (!isSupported) return;
    
    if (isListening) {
      // Stop listening
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    // Start listening
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true; // Enable interim results for better UX
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript(null);
    };

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript;
      
      if (result.isFinal) {
        // Final result - show preview instead of auto-sending
        setTranscript(text);
        setIsListening(false);
        onTranscript?.(text);
      } else {
        // Interim result - show live preview
        setTranscript(text + "...");
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        const errorMsg = "Akses mikrofon ditolak. Izinkan akses mikrofon untuk menggunakan fitur suara.";
        onError?.(errorMsg);
      }
      setIsListening(false);
      setTranscript(null);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, isListening, lang, onTranscript, onError]);

  return {
    isSupported,
    isListening,
    transcript,
    toggleVoiceInput,
    clearTranscript,
  };
}
