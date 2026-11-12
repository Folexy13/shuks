"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  AlertCircle,
  Bot,
  Camera,
  CameraOff,
  Captions,
  ExternalLink,
  FileAudio,
  Link2,
  MessageSquareText,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  AgentMeetingAnalysis,
  ArtisanProfile,
  BrowserSpeechRecognition,
  JobWorkspaceSession,
  OnboardedUserAccount,
  TranscriptUtterance,
} from "@/lib/types";

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

interface ThreeWayCallStageProps {
  artisan: ArtisanProfile;
  currentUser: OnboardedUserAccount;
  session: JobWorkspaceSession;
  onStartCall: () => void;
  onCallEndedAnalyzing: () => void;
  onLeaveCallWithoutSummary: () => void;
  onAppendUtterance: (utterance: TranscriptUtterance) => void;
}

function detectPlatformFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("zoom.us")) return "Zoom";
  if (lower.includes("meet.google.com")) return "Google Meet";
  if (lower.includes("slack.com")) return "Slack Huddle";
  if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com"))
    return "Microsoft Teams";
  return "External Meeting";
}

export function ThreeWayCallStage({
  artisan,
  currentUser,
  session,
  onStartCall,
  onCallEndedAnalyzing,
  onLeaveCallWithoutSummary,
  onAppendUtterance,
}: ThreeWayCallStageProps) {
  const [mounted, setMounted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [interimCaption, setInterimCaption] = useState("");
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  const [externalMeetingUrl, setExternalMeetingUrl] = useState("");
  const [activePlatform, setActivePlatform] = useState<string>("in_app");
  const [showExternalInput, setShowExternalInput] = useState(false);
  const [showRecordingsLab, setShowRecordingsLab] = useState(false);

  const [botDispatched, setBotDispatched] = useState(false);
  const [botDispatching, setBotDispatching] = useState(false);
  const [botError, setBotError] = useState("");
  const [botStatusInfo, setBotStatusInfo] = useState<{
    active: boolean;
    platform?: string;
    meetingUrl?: string;
    status?: string;
    enteredCall?: boolean;
    statusDetail?: string;
    elapsedSeconds?: number;
    recordedBytes?: number;
    previewImageDataUrl?: string | null;
  } | null>(null);

  const [agentAvailable, setAgentAvailable] = useState<boolean>(false);
  const [agentStatusChecked, setAgentStatusChecked] = useState<boolean>(false);

  const [transportStatus, setTransportStatus] = useState<
    "idle" | "connecting" | "livekit_connected" | "external_bridge" | "error"
  >("idle");
  const [transportDetail, setTransportDetail] = useState("");
  const [remoteVideoAttached, setRemoteVideoAttached] = useState(false);

  const [analysisState, setAnalysisState] = useState<
    "idle" | "loading" | "error" | "success"
  >("idle");
  const [analysisError, setAnalysisError] = useState("");

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const livekitRoomRef = useRef<Room | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch("/api/agent/status")
      .then((r) => r.json())
      .then((statusData: { agentAvailable?: boolean }) => {
        const isAvail = Boolean(statusData?.agentAvailable);
        setAgentAvailable(isAvail);
        setAgentStatusChecked(true);
        if (isAvail) {
          setAnalysisError("");
          setAnalysisState("idle");
        }
      })
      .catch(() => {
        setAgentAvailable(false);
        setAgentStatusChecked(true);
      });
  }, [session.callActive]);

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setInterimCaption("");
  };

  const cleanupMediaAndRoom = () => {
    stopSpeechRecognition();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;

    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    if (livekitRoomRef.current) {
      livekitRoomRef.current.disconnect().catch(() => {});
      livekitRoomRef.current = null;
    }
    setCameraEnabled(false);
    setRemoteVideoAttached(false);
    setMicLevel(0);
  };

  useEffect(() => {
    return () => {
      cleanupMediaAndRoom();
    };
  }, []);

  useEffect(() => {
    if (cameraEnabled && localVideoRef.current && mediaStreamRef.current) {
      localVideoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [cameraEnabled, session.callActive]);

  const broadcastUtteranceOverLiveKit = (utterance: TranscriptUtterance) => {
    const room = livekitRoomRef.current;
    if (!room || room.state !== "connected") return;
    const encoded = new TextEncoder().encode(JSON.stringify(utterance));
    room.localParticipant
      .publishData(encoded, { reliable: true })
      .catch(() => {});
  };

  const startAudioRecorder = (streams: MediaStream[]) => {
    recordedChunksRef.current = [];
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const destination = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      let connectedAny = false;
      for (const s of streams) {
        if (s.getAudioTracks().length > 0) {
          const src = ctx.createMediaStreamSource(s);
          src.connect(destination);
          src.connect(analyser);
          connectedAny = true;
        }
      }

      if (!connectedAny) return;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        levelRafRef.current = requestAnimationFrame(updateLevel);
      };
      levelRafRef.current = requestAnimationFrame(updateLevel);

      if (typeof MediaRecorder !== "undefined") {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(destination.stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
      }
    } catch {
      setMicLevel(0);
    }
  };

  const startContinuousSpeechRecognition = () => {
    stopSpeechRecognition();
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript?.trim();
          if (!text) continue;
          if (res.isFinal) {
            setInterimCaption("");
            const spokenUtt: TranscriptUtterance = {
              id: `utt-mic-${Date.now()}-${i}`,
              speaker: currentUser.role,
              speakerName: currentUser.name,
              text,
              timestampIso: new Date().toISOString(),
            };
            onAppendUtterance(spokenUtt);
            broadcastUtteranceOverLiveKit(spokenUtt);
          } else {
            interim += `${text} `;
          }
        }
        if (interim) {
          setInterimCaption(interim.trim());
        }
      };

      recognition.onerror = () => {};
      recognition.onend = () => {
        setInterimCaption("");
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      setMediaNotice(
        err instanceof Error
          ? `Speech recognition notice: ${err.message}`
          : "Speech recognition unavailable."
      );
    }
  };

  const handleJoinInAppCall = async (withVideo: boolean) => {
    setMediaNotice(null);
    setAnalysisError("");
    setActivePlatform("in_app");
    onStartCall();
    setTransportStatus("connecting");

    const activeStreams: MediaStream[] = [];
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: withVideo,
        });
        mediaStreamRef.current = stream;
        activeStreams.push(stream);
        setCameraEnabled(withVideo);
        if (withVideo && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      }
    } catch {
      setMediaNotice("Microphone/camera access was declined by the browser.");
    }

    startContinuousSpeechRecognition();

    try {
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: session.jobId,
          participantIdentity: currentUser.id,
          participantName: currentUser.name,
          role: currentUser.role,
        }),
      });

      if (!tokenRes.ok) {
        throw new Error(`Token endpoint returned ${tokenRes.status}`);
      }

      const { token, serverUrl, roomName } = await tokenRes.json();
      const room = new Room();
      livekitRoomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
          setRemoteVideoAttached(true);
        } else if (
          track.kind === Track.Kind.Audio &&
          remoteAudioContainerRef.current
        ) {
          const audioEl = track.attach();
          remoteAudioContainerRef.current.appendChild(audioEl);
          if (track.mediaStream) {
            startAudioRecorder([...activeStreams, track.mediaStream]);
          }
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach();
        if (track.kind === Track.Kind.Video) {
          setRemoteVideoAttached(false);
        }
      });

      room.on(RoomEvent.DataReceived, (payloadBytes) => {
        try {
          const decoded = new TextDecoder().decode(payloadBytes);
          const remoteUtt = JSON.parse(decoded) as TranscriptUtterance;
          if (remoteUtt?.id && remoteUtt?.text) {
            onAppendUtterance(remoteUtt);
          }
        } catch {}
      });

      room.on(RoomEvent.Disconnected, () => {
        setTransportStatus("error");
        setTransportDetail("LiveKit room disconnected");
      });

      await room.connect(serverUrl, token, {
        autoSubscribe: true,
      });
      await room.localParticipant.setMicrophoneEnabled(true);
      if (withVideo) {
        await room.localParticipant.setCameraEnabled(true);
      }
      if (activeStreams.length > 0) {
        startAudioRecorder(activeStreams);
      }
      setTransportStatus("livekit_connected");
      setTransportDetail(`LiveKit Connected (${roomName})`);
    } catch (error) {
      if (activeStreams.length > 0) {
        startAudioRecorder(activeStreams);
      }
      setTransportStatus("error");
      setTransportDetail(
        error instanceof Error
          ? `LiveKit connection failed: ${error.message}`
          : "LiveKit connection failed."
      );
    }
  };

  useEffect(() => {
    if (!botDispatched) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(artisan.id)}/bot`
        );
        if (!res.ok) return;
        const data = await res.json();
        setBotStatusInfo(data);
        if (!data.active) {
          setBotDispatched(false);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [artisan.id, botDispatched]);

  const handleConnectExternalMeeting = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = externalMeetingUrl.trim();
    if (!url || botDispatching) return;

    const platform = detectPlatformFromUrl(url);
    setActivePlatform(platform);
    setBotDispatching(true);
    setBotError("");

    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(artisan.id)}/bot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingUrl: url,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch meeting bot.");
      }
      setBotStatusInfo(data);
      setBotDispatched(true);
      setShowExternalInput(false);
    } catch (error) {
      setBotError(
        error instanceof Error
          ? error.message
          : "Could not dispatch autonomous meeting bot."
      );
    } finally {
      setBotDispatching(false);
    }
  };

  const handleRecallExternalBot = () => {
    const wasAdmitted = Boolean(botStatusInfo?.enteredCall);
    setBotDispatched(false);
    setBotStatusInfo(null);
    if (wasAdmitted) {
      onCallEndedAnalyzing();
    }

    void (async () => {
      try {
        await fetch(`/api/jobs/${encodeURIComponent(artisan.id)}/bot`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch {}
    })();
  };

  const handleToggleMute = () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
    if (nextMuted) {
      stopSpeechRecognition();
    } else if (captionsEnabled) {
      startContinuousSpeechRecognition();
    }
  };

  const handleToggleCaptions = () => {
    const next = !captionsEnabled;
    setCaptionsEnabled(next);
    if (next && !micMuted) {
      startContinuousSpeechRecognition();
    } else {
      stopSpeechRecognition();
    }
  };

  const handleToggleVideo = async () => {
    setMediaNotice(null);
    if (cameraEnabled && mediaStreamRef.current) {
      mediaStreamRef.current.getVideoTracks().forEach((track) => track.stop());
      setCameraEnabled(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaNotice("Camera capture is not supported in this browser.");
      return;
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (mediaStreamRef.current) {
        videoStream
          .getVideoTracks()
          .forEach((t) => mediaStreamRef.current?.addTrack(t));
      } else {
        mediaStreamRef.current = videoStream;
      }
      setCameraEnabled(true);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = videoStream;
      }
    } catch {
      setMediaNotice("Camera permission was declined.");
    }
  };

  const handleEndAndSynthesizeCall = () => {
    const transcriptSnapshot = [...session.transcript];
    const chunksSnapshot = [...recordedChunksRef.current];
    const recorderMime = mediaRecorderRef.current?.mimeType || "audio/webm";
    const platformSnapshot = activePlatform;
    const urlSnapshot = externalMeetingUrl.trim() || null;

    cleanupMediaAndRoom();

    if (transcriptSnapshot.length === 0 && chunksSnapshot.length === 0) {
      onLeaveCallWithoutSummary();
      return;
    }

    onCallEndedAnalyzing();

    void (async () => {
      let audioBase64: string | null = null;
      if (transcriptSnapshot.length === 0 && chunksSnapshot.length > 0) {
        const blob = new Blob(chunksSnapshot, { type: recorderMime });
        if (blob.size >= 500) {
          audioBase64 = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result;
              if (typeof res === "string" && res.includes(",")) {
                resolve(res.split(",")[1]);
              } else {
                resolve(null);
              }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        }
      }

      try {
        await fetch("/api/agent/analyze-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artisanId: artisan.id,
            scenarioMode: session.callScenarioMode,
            meetingPlatform: platformSnapshot,
            meetingUrl: urlSnapshot,
            utteranceCount: transcriptSnapshot.length,
            transcript: transcriptSnapshot,
            audioBase64,
            audioMimeType: recorderMime,
          }),
        });
      } catch {
        // Handled by workspace state listener
      }
    })();
  };

  const blobToBase64 = (blob: Blob): Promise<string | null> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === "string" && res.includes(",")) {
          resolve(res.split(",")[1]);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

  const handleSendSampleRecordingFile = (
    recordingFileName: string,
    scenario: "agreed_on_call" | "needs_post_call_permission"
  ) => {
    setShowRecordingsLab(false);
    onCallEndedAnalyzing();

    void (async () => {
      try {
        await fetch("/api/agent/analyze-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artisanId: artisan.id,
            scenarioMode: scenario,
            meetingPlatform: `Call Recording (${recordingFileName})`,
            meetingUrl: null,
            recordingFile: recordingFileName,
            utteranceCount: 0,
            transcript: [],
            audioBase64: null,
            audioMimeType: "audio/wav",
          }),
        });
      } catch {}
    })();
  };

  const handleUploadCustomAudioFile = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setShowRecordingsLab(false);
    onCallEndedAnalyzing();

    void (async () => {
      try {
        const audioBase64 = await blobToBase64(file);
        if (!audioBase64) return;

        await fetch("/api/agent/analyze-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artisanId: artisan.id,
            scenarioMode: "agreed_on_call",
            meetingPlatform: `Uploaded Audio (${file.name})`,
            meetingUrl: null,
            utteranceCount: 0,
            transcript: [],
            audioBase64,
            audioMimeType: file.type || "audio/wav",
          }),
        });
      } catch {}
    })();
  };

  const buyerDisplayName =
    currentUser.role === "buyer"
      ? currentUser.name
      : session.messages.find((m) => m.sender === "buyer")?.senderName ||
        "Aluko Folajimi";
  const counterpartyName =
    currentUser.role === "buyer" ? artisan.name : `${buyerDisplayName} (Client)`;
  const counterpartySubtitle =
    currentUser.role === "buyer"
      ? `${artisan.businessName} • ${artisan.neighborhood}`
      : `Client / Buyer • ${artisan.neighborhood}, ${artisan.city}`;
  const counterpartyHue =
    currentUser.role === "buyer" ? artisan.avatarHue : "bg-ink text-white";

  if (!session.callActive) {
    return (
      <div className="border-b border-border bg-stone px-6 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-ink">
              Call &amp; Silent AI Note-Taker ({currentUser.name} &bull;{" "}
              {counterpartyName})
            </p>
            <p className="text-xs text-muted">
              Start a live call, connect Zoom/Meet/Slack, or send a 2-speaker
              call audio recording for Shuks AI to analyze.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRecordingsLab((v) => !v);
                setShowExternalInput(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-olive bg-olive/10 px-3.5 py-2 text-xs font-bold text-olive hover:bg-olive hover:text-white transition-colors"
            >
              <FileAudio className="h-3.5 w-3.5" />
              <span>Test Call Recordings (2 Scenarios)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowExternalInput((v) => !v);
                setShowRecordingsLab(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-ink transition-colors"
            >
              <Link2 className="h-3.5 w-3.5 text-terracotta" />
              <span>Connect Zoom / Meet / Slack</span>
            </button>
            <button
              type="button"
              onClick={() => handleJoinInAppCall(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-ink bg-surface px-4 py-2 text-xs font-bold text-ink hover:bg-ink hover:text-white transition-colors"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              <span>Voice Call</span>
            </button>
            <button
              type="button"
              onClick={() => handleJoinInAppCall(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white hover:bg-terracotta-dark transition-colors"
            >
              <Video className="h-3.5 w-3.5" />
              <span>Video Call</span>
            </button>
          </div>
        </div>

        {showRecordingsLab && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-canvas p-3.5 space-y-2.5">
                <span className="block text-xs font-bold text-ink">
                  conversation.wav (Fee Mentioned)
                </span>
                <audio
                  controls
                  preload="metadata"
                  src="/recordings/conversation.wav"
                  className="h-9 w-full"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSendSampleRecordingFile(
                      "conversation.wav",
                      "agreed_on_call"
                    )
                  }
                  className="w-full rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors"
                >
                  Send conversation.wav to Shuks AI
                </button>
              </div>

              <div className="rounded-lg border border-border bg-canvas p-3.5 space-y-2.5">
                <span className="block text-xs font-bold text-ink">
                  conversation_2.wav (No Fee Mentioned)
                </span>
                <audio
                  controls
                  preload="metadata"
                  src="/recordings/conversation_2.wav"
                  className="h-9 w-full"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSendSampleRecordingFile(
                      "conversation_2.wav",
                      "needs_post_call_permission"
                    )
                  }
                  className="w-full rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:bg-terracotta transition-colors"
                >
                  Send conversation_2.wav to Shuks AI
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone pt-3">
              <span className="text-xs text-muted">
                Or upload any recorded call audio file (`.wav`, `.mp3`,
                `.webm`, `.m4a`):
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink bg-canvas px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-stone transition-colors">
                <Upload className="h-3.5 w-3.5 text-terracotta" />
                <span>Upload Audio File</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleUploadCustomAudioFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {showExternalInput && (
          <form
            onSubmit={handleConnectExternalMeeting}
            className="space-y-2 rounded-lg border border-border bg-surface p-3.5"
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <label htmlFor="external-meeting-url" className="sr-only">
                Paste Zoom, Google Meet, Jitsi, or Microsoft Teams link
              </label>
              <input
                id="external-meeting-url"
                type="url"
                required
                value={externalMeetingUrl}
                onChange={(e) => setExternalMeetingUrl(e.target.value)}
                placeholder="Paste Google Meet, Zoom, or Jitsi link (e.g. https://meet.google.com/xxx-yyyy-zzz)"
                className="flex-1 rounded-lg border border-border bg-canvas px-3.5 py-2 text-xs text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
              />
              <button
                type="submit"
                disabled={botDispatching}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-terracotta disabled:opacity-50 transition-colors"
              >
                <Bot className="h-3.5 w-3.5" />
                <span>
                  {botDispatching
                    ? "Dispatching Bot..."
                    : "Dispatch Shuks AI Bot into Meeting"}
                </span>
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Spawns a headless Chrome + PulseAudio virtual-sink bot on the
              server that dials into your meeting URL as{" "}
              <strong>&ldquo;Shuks AI Mediator&rdquo;</strong> (no screen-sharing
              required).
            </p>
            {botError && (
              <p className="text-xs font-semibold text-terracotta">{botError}</p>
            )}
          </form>
        )}

        {botDispatched && botStatusInfo && (
          <div className="rounded-xl border border-olive bg-surface p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-olive animate-ping" />
                <div>
                  <p className="text-xs font-bold text-ink">
                    Autonomous Bot Active in {botStatusInfo.platform} (
                    {botStatusInfo.elapsedSeconds ?? 0}s &bull;{" "}
                    {Math.round((botStatusInfo.recordedBytes ?? 0) / 1024)} KB
                    audio captured)
                  </p>
                  <p className="text-xs text-muted">
                    {botStatusInfo.statusDetail}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {botStatusInfo.meetingUrl && (
                  <a
                    href={botStatusInfo.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-stone"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open Meeting</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleRecallExternalBot}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3.5 py-1.5 text-xs font-bold text-white hover:bg-terracotta-dark transition-colors"
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  <span>
                    {botStatusInfo.enteredCall
                      ? "Recall Bot & Summarize Meeting"
                      : "Close Bot"}
                  </span>
                </button>
              </div>
            </div>

            {botStatusInfo.previewImageDataUrl && (
              <div className="overflow-hidden rounded-lg border border-border bg-ink">
                <div className="bg-ink px-3 py-1 text-[10px] font-mono text-stone flex justify-between">
                  <span>Live Headless Bot Viewport (CDP Stream)</span>
                  <span>Status: {botStatusInfo.status}</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={botStatusInfo.previewImageDataUrl}
                  alt="Live view of Shuks AI Bot inside the meeting"
                  className="max-h-56 w-full object-contain bg-black"
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const callOverlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen call stage"
      className="fixed inset-0 z-[9999] flex flex-col bg-ink text-white select-none"
    >
      <div ref={remoteAudioContainerRef} className="hidden" />

      {!agentAvailable && agentStatusChecked && (
        <div className="bg-ochre px-6 py-2 text-center text-xs font-semibold text-ink">
          AI Mediator has not joined this call because no valid GEMINI_API_KEY is
          configured. Only you and {artisan.name} are in the room.
        </div>
      )}

      {mediaNotice && (
        <div className="bg-white/10 px-6 py-2 text-center text-xs text-ochre">
          {mediaNotice}
        </div>
      )}

      {analysisState === "error" && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-terracotta px-6 py-2.5 text-xs font-medium text-white"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{analysisError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              cleanupMediaAndRoom();
              onLeaveCallWithoutSummary();
            }}
            className="rounded bg-ink/40 px-3 py-1 text-xs font-bold hover:bg-ink/60"
          >
            Leave Call Without Summary
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden p-4 gap-4">
        <div className="flex flex-1 flex-col justify-between overflow-hidden">
          <div
            className={`grid flex-1 gap-4 ${
              agentAvailable ? "md:grid-cols-3" : "md:grid-cols-2"
            }`}
          >
            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-white/10">
              {cameraEnabled ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center">
                  <div
                    style={{
                      boxShadow:
                        !micMuted && micLevel > 5
                          ? `0 0 0 ${Math.min(20, micLevel / 3)}px rgba(200, 90, 50, 0.35)`
                          : "none",
                    }}
                    className="flex h-24 w-24 items-center justify-center rounded-full bg-terracotta text-2xl font-bold text-white transition-shadow duration-75"
                  >
                    {currentUser.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <p className="mt-3 text-xs text-stone/80">
                    {micMuted ? "Microphone muted" : `Mic level: ${micLevel}%`}
                  </p>
                </div>
              )}

              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-ink/80 px-3 py-1.5 text-xs font-medium text-white">
                <span>{currentUser.name} (You)</span>
                {micMuted && <MicOff className="h-3.5 w-3.5 text-terracotta" />}
              </div>
            </div>

            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-white/10">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`h-full w-full object-cover ${
                  remoteVideoAttached ? "block" : "hidden"
                }`}
              />

              {!remoteVideoAttached && (
                <div className="flex flex-col items-center justify-center text-center px-4">
                  <div
                    className={`flex h-24 w-24 items-center justify-center rounded-full ${artisan.avatarHue} text-2xl font-bold`}
                  >
                    {artisan.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-white">
                    {artisan.name}
                  </p>
                  <p className="text-xs text-stone/70">
                    {artisan.businessName} &bull; {artisan.neighborhood}
                  </p>
                </div>
              )}

              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-ink/80 px-3 py-1.5 text-xs font-medium text-white">
                <span>
                  {activePlatform === "in_app"
                    ? `${artisan.name} (${artisan.trade})`
                    : `${activePlatform} Stream`}
                </span>
              </div>
            </div>

            {agentAvailable && (
              <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-olive/50 p-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-olive/30 border-2 border-olive text-white">
                  <Bot className="h-11 w-11" />
                </div>
                <p className="mt-3 text-sm font-bold text-white">
                  Shuks AI (Silent Listener)
                </p>
                <p className="mt-1 text-center text-xs text-stone/80 max-w-xs">
                  Listening silently without interrupting. When the call ends,
                  your meeting summary will be sent to your chat.
                </p>

                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-ink/80 px-3 py-1.5 text-xs font-medium text-ochre">
                  <span>Silent Note-Taker (Listening Only)</span>
                </div>
              </div>
            )}
          </div>

          {captionsEnabled && (
            <div className="mt-3 flex min-h-[52px] items-center justify-center rounded-xl bg-black/40 px-6 py-2.5 text-center">
              {interimCaption ? (
                <p className="text-sm text-white">
                  <strong className="text-ochre">{currentUser.name}: </strong>
                  <span>{interimCaption}</span>
                </p>
              ) : session.transcript.length > 0 ? (
                <p className="text-sm text-stone">
                  <strong className="text-ochre">
                    {
                      session.transcript[session.transcript.length - 1]
                        .speakerName
                    }
                    :{" "}
                  </strong>
                  <span>
                    {session.transcript[session.transcript.length - 1].text}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-stone/70">
                  Live Captions (CC) &amp; Audio Recorder active — speak
                  naturally on the call.
                </p>
              )}
            </div>
          )}
        </div>

        {drawerOpen && (
          <aside className="flex w-full max-w-sm flex-col rounded-xl bg-canvas text-ink border border-border overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-surface px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  Live Call Captions Log
                </h3>
                <p className="text-[11px] text-muted">
                  {session.transcript.length} spoken segments captured
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close captions drawer"
                className="rounded-lg p-1.5 text-muted hover:bg-stone"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {session.transcript.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted space-y-2">
                  <p className="font-semibold text-ink">
                    Listening to call audio...
                  </p>
                  <p>
                    Shuks AI is silently recording and transcribing your
                    conversation. When you end the call, it will send the
                    summary to your chat.
                  </p>
                </div>
              ) : (
                session.transcript.map((utt) => (
                  <div
                    key={utt.id}
                    className="rounded-lg border border-border bg-surface p-3 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-terracotta">
                        {utt.speakerName}
                      </span>
                      <span className="text-[10px] text-subtle">
                        {new Date(utt.timestampIso).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-ink leading-relaxed">{utt.text}</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="flex h-20 items-center justify-between border-t border-white/10 bg-ink px-6">
        <div className="hidden sm:flex items-center gap-3 text-xs text-stone/80">
          <span className="font-semibold text-white">
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>|</span>
          <span className="font-mono">{session.jobId}</span>
          <span>|</span>
          <span
            className={
              transportStatus === "livekit_connected" ||
              transportStatus === "external_bridge"
                ? "text-ochre"
                : transportStatus === "error"
                ? "text-terracotta"
                : "text-stone"
            }
          >
            {transportDetail}
          </span>
        </div>

        <div className="flex items-center gap-3 mx-auto sm:mx-0">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
            title={micMuted ? "Turn on microphone" : "Turn off microphone"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              micMuted
                ? "bg-terracotta text-white hover:bg-terracotta-dark"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {micMuted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleVideo}
            aria-label={cameraEnabled ? "Turn off camera" : "Turn on camera"}
            title={cameraEnabled ? "Turn off camera" : "Turn on camera"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              !cameraEnabled
                ? "bg-terracotta text-white hover:bg-terracotta-dark"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {cameraEnabled ? (
              <Camera className="h-5 w-5" />
            ) : (
              <CameraOff className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleCaptions}
            aria-label="Toggle live captions"
            title="Turn on/off captions (CC)"
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              captionsEnabled
                ? "bg-ochre text-ink"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <Captions className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleEndAndSynthesizeCall}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-terracotta px-6 text-xs font-bold text-white hover:bg-terracotta-dark transition-colors"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End Call</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen((prev) => !prev)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition-colors ${
              drawerOpen
                ? "bg-ochre text-ink"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <MessageSquareText className="h-4 w-4" />
            <span>Captions ({session.transcript.length})</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (mounted) {
    return createPortal(callOverlay, document.body);
  }

  return null;
}
