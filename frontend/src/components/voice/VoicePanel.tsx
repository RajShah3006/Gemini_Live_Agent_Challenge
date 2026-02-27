"use client";

import { useState } from "react";
import { AudioVisualizer } from "./AudioVisualizer";

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
          className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/30"
          style={{ animation: "pulseGlow 2s ease-in-out infinite" }}
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
      {/* Status indicator + visualizer */}
      <div className="flex items-center justify-center gap-3">
        {isListening && (
          <>
            <AudioVisualizer active color="red" bars={5} />
            <span className="text-xs text-red-400">You&apos;re speaking...</span>
            <AudioVisualizer active color="red" bars={5} />
          </>
        )}
        {isSpeaking && !isListening && (
          <>
            <AudioVisualizer active color="emerald" bars={5} />
            <span className="text-xs text-emerald-400">Tutor is explaining...</span>
            <AudioVisualizer active color="emerald" bars={5} />
          </>
        )}
        {!isListening && !isSpeaking && (
          <span className="text-xs text-gray-500">Ready</span>
        )}
      </div>

      {/* Push-to-talk button */}
      <div className="relative">
        {isListening && (
          <div className="absolute inset-0 rounded-xl"
            style={{ animation: "talkRing 1s ease-out infinite", border: "2px solid rgba(239,68,68,0.4)" }} />
        )}
        <button
          onMouseDown={onStartTalking}
          onMouseUp={onStopTalking}
          onMouseLeave={onStopTalking}
          onTouchStart={onStartTalking}
          onTouchEnd={onStopTalking}
          className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
            isListening
              ? "bg-red-600 text-white shadow-lg shadow-red-600/30 scale-[1.02]"
              : "bg-gray-800/80 text-gray-300 border border-gray-700/50 hover:bg-gray-700/80 hover:border-gray-600/50"
          }`}
        >
          {isListening ? "🔴 Release to stop" : "🎤 Hold to talk"}
        </button>
      </div>
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
          className="flex-1 rounded-lg border border-gray-700/50 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-cyan-600/50 focus:ring-1 focus:ring-cyan-600/20 backdrop-blur-sm"
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
