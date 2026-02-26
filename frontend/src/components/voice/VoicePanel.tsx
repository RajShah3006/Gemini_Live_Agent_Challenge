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
}

export function VoicePanel({
  isConnected,
  isListening,
  isSpeaking,
  onConnect,
  onDisconnect,
  onToggleUpload,
  onSendText,
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
        {isSpeaking && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Tutor is speaking...
          </span>
        )}
        {isListening && !isSpeaking && (
          <span className="inline-flex items-center gap-1.5 text-xs text-blue-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            Listening...
          </span>
        )}
        {!isListening && !isSpeaking && (
          <span className="text-xs text-gray-500">Ready</span>
        )}
      </div>

      {/* Text input for typing questions */}
      <div className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendText()}
          placeholder="Type a question or interrupt..."
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
