/// <reference types="@types/dom-speech-recognition" />
"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, Pause } from 'lucide-react';
import { api } from "~/utils/api";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";

type Message = {
  speaker: "user" | "ai";
  text: string;
};

export default function HomePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [conversation, setConversation] = useState<Message[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isSpeechApiSupported, setIsSpeechApiSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const sendTurnMutation = api.debate.sendTurn.useMutation({
    onSuccess: (data: { aiText: string; audioUrl: string }) => {
      console.log("tRPC Success:", data);
      setAiResponse(data.aiText);
      setConversation((prev) => [...prev, { speaker: "ai", text: data.aiText }]);
      setAudioUrl(data.audioUrl);
      setIsAiSpeaking(false);
    },
    onError: (error: TRPCClientErrorLike<AppRouter>) => {
      console.error("tRPC Error:", error);
      const errorText = "Error communicating with AI. Please try again.";
      setAiResponse(errorText);
      setConversation((prev) => [...prev, { speaker: "ai", text: errorText }]);
      setAudioUrl(null);
      setIsAiSpeaking(false);
    },
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log("Checking for SpeechRecognition API...");
      console.log("window.SpeechRecognition:", ('SpeechRecognition' in window) ? window.SpeechRecognition : 'Not found');
      console.log("window.webkitSpeechRecognition:", ('webkitSpeechRecognition' in window) ? (window as any).webkitSpeechRecognition : 'Not found');

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      console.log("Assigned SpeechRecognition variable:", SpeechRecognition);

      if (SpeechRecognition) {
        setIsSpeechApiSupported(true);
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = false;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = "";
          let finalTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i]?.isFinal) {
              finalTranscript += event.results[i]?.[0]?.transcript;
            } else {
              interimTranscript += event.results[i]?.[0]?.transcript;
            }
          }
          setUserTranscript(finalTranscript || interimTranscript);
          if (finalTranscript) {
            handleUserTurnEnd(finalTranscript.trim());
          }
        };

        recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error("Speech recognition error", event.error);
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            console.error("Microphone permission denied or service unavailable.");
          }
          setIsRecording(false);
        };

        recognitionInstance.onend = () => {
          if (isRecording) {
            setIsRecording(false);
          }
        };

        recognitionRef.current = recognitionInstance;

        return () => {
          recognitionRef.current?.stop();
        };
      } else {
        console.warn("Speech recognition constructor not found or falsy.");
        setIsSpeechApiSupported(false);
      }
    }
  }, []);

  const handleMicClick = () => {
    if (!recognitionRef.current) {
      console.error("Speech recognition not initialized.");
      return;
    }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      if (isAiSpeaking) {
        console.log("Interrupting AI speech.");
        audioPlayerRef.current?.pause();
        audioPlayerRef.current!.currentTime = 0;
        setAudioUrl(null);
        setIsAiSpeaking(false);
      }
      setUserTranscript("");
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleUserTurnEnd = (text: string) => {
    if (!text) return;
    setConversation((prev) => [...prev, { speaker: "user", text }]);
    setUserTranscript("");
    setIsAiSpeaking(true);
    setAiResponse("...");
    sendTurnMutation.mutate({ text });
  };

  useEffect(() => {
    if (audioUrl && audioPlayerRef.current) {
      audioPlayerRef.current.src = audioUrl;
      audioPlayerRef.current.play()
        .then(() => {
          setIsAiSpeaking(true);
        })
        .catch(error => {
          console.error("Error playing audio:", error);
          setIsAiSpeaking(false);
          setAudioUrl(null);
        });
    }
  }, [audioUrl]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16 ">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
          AI <span className="text-[hsl(280,100%,70%)]">Debate</span> Arena
        </h1>

        <div className="h-64 w-full max-w-md overflow-y-auto rounded-lg bg-white/10 p-4 space-y-2 scrollbar-thin scrollbar-thumb-purple-400 scrollbar-track-white/5">
          {conversation.map((msg, index) => (
            <div key={index} className={`p-2 rounded-md ${msg.speaker === 'user' ? 'bg-blue-600/70 text-right ml-4' : 'bg-purple-600/50 text-left mr-4'}`}>
              <span className="font-semibold capitalize">{msg.speaker}:</span> {msg.text}
            </div>
          ))}
          {isRecording && userTranscript && (
            <div className="p-2 rounded-md bg-green-600/50 text-right ml-4 italic">{userTranscript}...</div>
          )}
          {isAiSpeaking && (
            <div className="p-2 rounded-md bg-purple-600/50 text-left mr-4 italic">
              {sendTurnMutation.isLoading ? "AI is thinking..." : audioUrl ? "AI Speaking..." : "..."}
            </div>
          )}
        </div>

        <button
          onClick={handleMicClick}
          disabled={!recognitionRef.current}
          className={`
            rounded-full p-6 transition-all duration-200 ease-in-out 
            ${isRecording ? 'bg-red-500 scale-110 shadow-lg shadow-red-500/50' : 'bg-green-500 hover:bg-green-400'}
            ${isAiSpeaking ? 'bg-gray-500 cursor-not-allowed opacity-70' : ''}
            ${!recognitionRef.current ? 'bg-gray-700 cursor-not-allowed opacity-50' : ''}
            focus:outline-none focus:ring-4 focus:ring-white/50
          `}
        >
          {isRecording ? (
            <Pause className="h-10 w-10 text-white" /> 
          ) : (
            <Mic className="h-10 w-10 text-white" /> 
          )}
        </button>

        <div className="h-4 text-sm">
          {!isSpeechApiSupported ? "Voice input not supported" :
            isRecording ? "Listening..." : isAiSpeaking ? "AI Speaking..." : "Ready"}
        </div>

        <audio 
          ref={audioPlayerRef} 
          onEnded={() => {
            setIsAiSpeaking(false);
            setAudioUrl(null);
          }}
          onError={() => {
            console.error("Audio playback error.");
            setIsAiSpeaking(false);
            setAudioUrl(null);
          }}
        />
      </div>
    </main>
  );
}
