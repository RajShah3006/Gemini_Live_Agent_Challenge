"use client";

import { useState } from "react";

interface VoicePanelProps {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleUpload: () => void;
  onSendText: (text: string) => void;
  onStartTalking: () => void;
  onStopTalking: () => void;
}

export function VoicePanel({
  isConnected,
  isListening,
  isSpeaking,
  onConnect,
  onDisconnect,
  onToggleUpload,
  onSendText,
  onStartTalking,
  onStopTalking,
}: VoicePanelProps) {
  const [textInput, setTextInput] = useState("");

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setTextInput("");
  };

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <button
          onClick={onConnect}
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          🎙️ Start Session
        </button>
        <p className="text-center text-xs text-gray-500">
          Connect to start talking with your AI math tutor
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2">
        {isListening && (
          <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            You&apos;re speaking...
          </span>
        )}
        {isSpeaking && !isListening && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Tutor is speaking...
          </span>
        )}
        {!isListening && !isSpeaking && (
          <span className="text-xs text-gray-500">Ready</span>
        )}
      </div>

      {/* Push-to-talk button */}
      <button
        onMouseDown={onStartTalking}
        onMouseUp={onStopTalking}
        onMouseLeave={onStopTalking}
        onTouchStart={onStartTalking}
        onTouchEnd={onStopTalking}
        className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
          isListening
            ? "bg-red-600 text-white shadow-lg shadow-red-600/30 scale-[1.02]"
            : "bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700"
        }`}
      >
        {isListening ? "🔴 Release to stop" : "🎤 Hold to talk"}
      </button>
      <p className="text-center text-[10px] text-gray-600">
        Or hold <kbd className="rounded border border-gray-700 px-1.5 py-0.5 text-gray-400">Space</kbd> to talk
      </p>

      {/* Text input for typing questions */}
      <div className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendText()}
          placeholder="Type a question..."
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-600"
        />
        <button
          onClick={handleSendText}
          disabled={!textInput.trim()}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
        >
          Send
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onToggleUpload}
          className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
        >
          📷 Upload Image
        </button>
        <button
          onClick={onDisconnect}
          className="rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/20"
        >
          End
        </button>
      </div>
    </div>
  );
}
