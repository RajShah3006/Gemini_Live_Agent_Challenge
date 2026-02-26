"use client";

import { useState } from "react";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { ImageUpload } from "@/components/upload/ImageUpload";
import { useSession } from "@/hooks/useSession";

export default function Home() {
  const {
    isConnected,
    isListening,
    isSpeaking,
    connect,
    disconnect,
    sendImage,
    sendText,
    whiteboardCommands,
    transcript,
  } = useSession();

  const [showUpload, setShowUpload] = useState(false);

  return (
    <main className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-lg font-bold">
            M
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">MathBoard</h1>
            <p className="text-xs text-gray-400">AI Math Tutor</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              isConnected
                ? "bg-emerald-900/50 text-emerald-400"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "bg-emerald-400" : "bg-gray-500"
              }`}
            />
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Whiteboard area */}
        <div className="flex flex-1 flex-col">
          <Whiteboard commands={whiteboardCommands} />
        </div>

        {/* Right panel */}
        <div className="flex w-80 flex-col border-l border-gray-800 bg-gray-900/50">
          {/* Transcript */}
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Conversation
            </h3>
            {transcript.length === 0 ? (
              <p className="text-sm text-gray-500">
                Start a session to begin talking with your AI tutor.
              </p>
            ) : (
              <div className="space-y-3">
                {transcript.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "ml-4 bg-blue-900/40 text-blue-200"
                        : "mr-4 bg-gray-800 text-gray-200"
                    }`}
                  >
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {msg.role === "user" ? "You" : "Tutor"}
                    </span>
                    {msg.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload area */}
          {showUpload && (
            <div className="border-t border-gray-800 p-4">
              <ImageUpload
                onUpload={(base64) => {
                  sendImage(base64);
                  setShowUpload(false);
                }}
                onCancel={() => setShowUpload(false)}
              />
            </div>
          )}

          {/* Controls */}
          <div className="border-t border-gray-800 p-4">
            <VoicePanel
              isConnected={isConnected}
              isListening={isListening}
              isSpeaking={isSpeaking}
              onConnect={connect}
              onDisconnect={disconnect}
              onToggleUpload={() => setShowUpload((v) => !v)}
              onSendText={sendText}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
