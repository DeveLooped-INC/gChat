import React, { useState, useRef, useEffect } from 'react';
import { Mic, Video, Play, Pause, Square, Download, Trash2, Loader2, FileAudio, FileVideo, AlertTriangle, RefreshCw, Radio, CheckCircle, Cloud, File, FileText, Image as ImageIcon, Camera, X } from 'lucide-react';
import { formatDuration, formatBytes } from '../utils';
import { MediaMetadata, ToastMessage } from '../types';
import { networkService } from '../services/networkService';
import { getMedia, saveMedia, deleteMedia } from '../services/mediaStorage';

// --- RECORDER COMPONENTS ---

interface MediaRecorderProps {
    type: 'audio' | 'video';
    onCapture: (blob: Blob, previewUrl: string, duration: number) => void;
    onCancel: () => void;
    maxDuration: number; // in seconds
}

export const MediaRecorder: React.FC<MediaRecorderProps> = ({ type, onCapture, onCancel, maxDuration }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [duration, setDuration] = useState(0);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [useNativeFallback, setUseNativeFallback] = useState(false);

    const mediaRecorderRef = useRef<any>(null);
    const chunksRef = useRef<Blob[]>([]);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const nativeInputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<number | undefined>(undefined);
    const streamRef = useRef<MediaStream | null>(null);

    const cleanup = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
        }
        if (timerRef.current !== undefined) {
            clearInterval(timerRef.current);
        }
    };

    const startStream = async () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
        }

        try {
            const constraints: MediaStreamConstraints = type === 'audio'
                ? { audio: true }
                : {
                    audio: true,
                    video: {
                        facingMode: facingMode,
                        // Relaxed constraints for better compatibility (S21/Tab S6)
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                };

            const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(mediaStream);
            streamRef.current = mediaStream;
            setError(null);

            if (type === 'video' && videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = mediaStream;
            }
        } catch (e: any) {
            console.error("Media access denied", e);
            let msg = "Could not access media device.";

            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                msg = "Permission denied. Check settings.";
            } else if (e.name === 'OverconstrainedError') {
                msg = "Camera resolution not supported.";
            }

            setError(msg);
        }
    };

    useEffect(() => {
        if (!useNativeFallback) {
            startStream();
        }
        return () => {
            cleanup();
        };
    }, [facingMode, useNativeFallback]);

    const toggleCamera = () => {
        setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    };

    const startRecording = () => {
        if (!stream) return;
        chunksRef.current = [];

        // Improved MIME type selection for Android compatibility
        let mimeType = 'video/webm';
        if (type === 'video') {
            const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
            for (const t of types) {
                if (window.MediaRecorder.isTypeSupported(t)) {
                    mimeType = t;
                    break;
                }
            }
        } else {
            mimeType = 'audio/webm';
        }

        try {
            const recorder = new window.MediaRecorder(stream, { mimeType });

            recorder.ondataavailable = (e: BlobEvent) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                const url = URL.createObjectURL(blob);
                onCapture(blob, url, duration);
            };

            mediaRecorderRef.current = recorder;
            recorder.start(1000);
            setIsRecording(true);

            timerRef.current = window.setInterval(() => {
                setDuration(prev => {
                    if (prev >= maxDuration) {
                        stopRecording();
                        return prev;
                    }
                    return prev + 1;
                });
            }, 1000);
        } catch (e: any) {
            setError(`Recording failed: ${e.message}`);
        }
    };

    const pauseRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
            if (timerRef.current !== undefined) clearInterval(timerRef.current);
        }
    };

    const resumeRecording = () => {
        if (mediaRecorderRef.current && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
            timerRef.current = window.setInterval(() => {
                setDuration(prev => {
                    if (prev >= maxDuration) {
                        stopRecording();
                        return prev;
                    }
                    return prev + 1;
                });
            }, 1000);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            cleanup();
        }
    };

    const handleNativeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            // Can't know exact duration without loading metadata, estimating 0 for now
            onCapture(file, url, 0);
        }
    };

    if (useNativeFallback) {
        return (
            <div className="flex flex-col items-center bg-slate-900 rounded-xl p-6 w-full border border-slate-700 text-center min-w-[260px]">
                <Video className="text-onion-500 mb-2" size={32} />
                <h3 className="text-white font-bold mb-1">Native Camera</h3>
                <p className="text-slate-400 text-xs mb-4">Using device camcorder app...</p>
                <button onClick={() => nativeInputRef.current?.click()} className="bg-onion-600 px-6 py-3 rounded-xl text-white font-bold mb-2">
                    Launch Recorder
                </button>
                <input
                    ref={nativeInputRef}
                    type="file"
                    accept={type === 'video' ? "video/*" : "audio/*"}
                    capture="environment"
                    className="hidden"
                    onChange={handleNativeFile}
                />
                <button onClick={() => setUseNativeFallback(false)} className="text-slate-500 text-xs underline">Retry In-App Recorder</button>
                <button onClick={onCancel} className="mt-4 text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center bg-slate-900 rounded-xl p-6 w-full border border-slate-700 text-center min-w-[260px]">
                <AlertTriangle className="text-red-500 mb-2" size={32} />
                <h3 className="text-white font-bold mb-1">Media Error</h3>
                <p className="text-slate-400 text-xs mb-4 max-w-[200px] mx-auto">{error}</p>
                <div className="flex gap-2">
                    <button onClick={() => setUseNativeFallback(true)} className="bg-onion-600 px-4 py-2 rounded-lg text-white text-sm hover:bg-onion-500">
                        Use Native App
                    </button>
                    <button onClick={onCancel} className="bg-slate-800 px-4 py-2 rounded-lg text-white text-sm hover:bg-slate-700">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    // --- AUDIO RECORDER LAYOUT ---
    if (type === 'audio') {
        return (
            <div className="flex flex-col items-center bg-slate-900 rounded-xl p-4 w-full border border-slate-700 min-w-[260px]">
                <div className="w-full h-16 bg-slate-800 rounded-lg flex items-center justify-center mb-4 relative overflow-hidden">
                    <div className={`absolute inset-0 bg-onion-500/20 transition-transform duration-500 ${isRecording && !isPaused ? 'animate-pulse' : ''}`} style={{ width: `${(duration / maxDuration) * 100}%` }} />
                    <div className="z-10 text-2xl font-mono text-white flex items-center gap-2">
                        <Mic size={24} className={isRecording ? "text-red-500" : "text-slate-400"} />
                        <span>{formatDuration(duration)}</span>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    {!isRecording ? (
                        <button onClick={startRecording} className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:scale-105 transition-transform shadow-lg shadow-red-900/20">
                            <div className="w-6 h-6 bg-white rounded-full" />
                        </button>
                    ) : (
                        <>
                            {isPaused ? (
                                <button onClick={resumeRecording} className="p-3 rounded-full bg-emerald-600 text-white"><Play size={24} /></button>
                            ) : (
                                <button onClick={pauseRecording} className="p-3 rounded-full bg-amber-600 text-white"><Pause size={24} /></button>
                            )}
                            <button onClick={stopRecording} className="w-14 h-14 rounded-full border-4 border-red-500 flex items-center justify-center">
                                <Square size={20} className="fill-red-500 text-red-500" />
                            </button>
                        </>
                    )}
                    <button onClick={onCancel} className="p-3 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700">
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>
        );
    }

    // --- VIDEO RECORDER LAYOUT (FULL SCREEN MOBILE OVERLAY) ---
    return (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col md:relative md:bg-slate-900 md:rounded-xl md:border md:border-slate-700 md:z-0 md:min-w-[300px] overflow-hidden">

            {/* Mobile Header / Close (Visible only on mobile overlay) */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-20 md:hidden bg-gradient-to-b from-black/50 to-transparent">
                <span className="text-white font-bold drop-shadow-md flex items-center gap-2"><Video size={16} className="text-red-500" /> Record Video</span>
                <button onClick={onCancel} className="bg-black/40 text-white p-2 rounded-full backdrop-blur-md border border-white/10">
                    <X size={20} />
                </button>
            </div>

            {/* Video Preview */}
            <div className="relative w-full h-full md:aspect-video bg-black flex items-center justify-center">
                <video
                    ref={videoPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover ${facingMode === 'user' ? 'transform scale-x-[-1]' : ''}`}
                />

                {/* Duration Badge */}
                <div className="absolute top-4 right-4 md:top-2 md:right-2 bg-red-600 px-3 py-1 rounded-full text-white text-sm font-mono font-bold shadow-lg z-20 flex items-center gap-2">
                    <div className={`w-2 h-2 bg-white rounded-full ${isRecording && !isPaused ? 'animate-pulse' : ''}`} />
                    {formatDuration(duration)} / {formatDuration(maxDuration)}
                </div>

                {/* Flip Camera Button */}
                {!isRecording && (
                    <button
                        onClick={toggleCamera}
                        className="absolute bottom-28 right-6 md:top-2 md:left-2 md:bottom-auto md:right-auto bg-black/40 text-white p-3 rounded-full backdrop-blur-md border border-white/20 z-20 hover:bg-black/60 transition-colors"
                    >
                        <RefreshCw size={24} />
                    </button>
                )}

                {/* Fallback Button */}
                {!isRecording && (
                    <button
                        onClick={() => setUseNativeFallback(true)}
                        className="absolute bottom-28 left-6 md:top-2 md:left-2 md:bottom-auto md:right-auto bg-black/40 text-white p-3 rounded-full backdrop-blur-md border border-white/20 z-20 hover:bg-black/60 transition-colors"
                        title="Use Native Camera App"
                    >
                        <ImageIcon size={24} />
                    </button>
                )}
            </div>

            {/* Controls Overlay */}
            <div className="absolute bottom-0 w-full p-8 md:p-4 flex items-center justify-center gap-8 md:gap-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-20 md:relative md:bg-none">
                {!isRecording ? (
                    <button onClick={startRecording} className="w-20 h-20 md:w-14 md:h-14 rounded-full bg-red-500 flex items-center justify-center hover:scale-105 transition-transform shadow-lg shadow-red-900/20 border-4 border-white/20">
                        <div className="w-8 h-8 md:w-6 md:h-6 bg-white rounded-full" />
                    </button>
                ) : (
                    <>
                        {isPaused ? (
                            <button onClick={resumeRecording} className="p-4 md:p-3 rounded-full bg-emerald-600 text-white shadow-lg"><Play size={32} className="md:w-6 md:h-6" /></button>
                        ) : (
                            <button onClick={pauseRecording} className="p-4 md:p-3 rounded-full bg-amber-600 text-white shadow-lg"><Pause size={32} className="md:w-6 md:h-6" /></button>
                        )}
                        <button onClick={stopRecording} className="w-20 h-20 md:w-14 md:h-14 rounded-full border-4 border-red-500 flex items-center justify-center bg-black/50 backdrop-blur">
                            <Square size={24} className="fill-red-500 text-red-500 md:w-5 md:h-5" />
                        </button>
                    </>
                )}

                {/* Desktop Cancel Button (Mobile uses header X) */}
                <button onClick={onCancel} className="hidden md:block p-3 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700">
                    <Trash2 size={20} />
                </button>
            </div>
        </div>
    );
};


// --- PLAYER COMPONENT ---

interface MediaPlayerProps {
    media: MediaMetadata;
    peerId?: string | undefined; // Needed for download, but optional if unknown (will search mesh)
    autoPlay?: boolean;
    onNotification?: (title: string, message: string, type: ToastMessage['type']) => void;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ media, peerId, autoPlay, onNotification }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number>(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const IS_LARGE_FILE = media.size > 1 * 1024 * 1024; // > 1MB

    useEffect(() => {
        checkLocal();
    }, [media.id]);

    const checkLocal = async () => {
        const blob = await getMedia(media.id);
        if (blob && blob.size > 0) {
            setBlobUrl(URL.createObjectURL(blob));
            return;
        }
        const bgProgress = networkService.getDownloadProgress(media.id);
        if (bgProgress !== null && peerId) {
            if (IS_LARGE_FILE) {
                setIsBackgroundSyncing(true);
                setDownloadProgress(bgProgress === -1 ? 0 : bgProgress);
            } else {
                setIsDownloading(true);
            }
            if (bgProgress === -1) setIsSearching(true);
            startDownloadProcess();
        }
    };

    const startDownloadProcess = async () => {
        // if(!peerId) return; // REMOVED: We now allow unknown peers via Mesh Recovery
        setError(null);

        if (IS_LARGE_FILE) {
            setIsBackgroundSyncing(true);
            if (onNotification && !networkService.getDownloadProgress(media.id)) {
                onNotification('Syncing Media', 'Large file downloading in background...', 'info');
            }
        } else {
            setIsDownloading(true);
        }

        try {
            // If peerId is provided, it's the Origin Node.
            // If it's undefined, NetworkService will trigger Mesh Recovery (Safe mode)
            const blob = await networkService.downloadMedia(peerId, media, (progress) => {
                if (progress === -1) {
                    setIsSearching(true);
                } else {
                    setIsSearching(false);
                    setDownloadProgress(progress);
                }
            });
            setBlobUrl(URL.createObjectURL(blob));
            if (IS_LARGE_FILE && onNotification) {
                onNotification('Media Ready', 'Download complete.', 'success');
            }
        } catch (e: any) {
            console.error(e);
            setError(e.toString());
        } finally {
            setIsDownloading(false);
            setIsBackgroundSyncing(false);
            setIsSearching(false);
        }
    };

    const handleRetry = () => {
        setBlobUrl(null);
        setError(null);
        setDownloadProgress(0);
        startDownloadProcess();
    };

    const downloadFileLocally = () => {
        if (blobUrl) {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = media.filename || `file-${media.id}`;
            a.click();
        }
    };

    if (blobUrl) {
        if (media.type === 'video') {
            return (
                <video src={blobUrl} controls autoPlay={autoPlay} className="w-full min-w-[260px] sm:min-w-[300px] max-h-96 rounded-lg bg-black border border-slate-700" onError={() => setError("Playback Error")} />
            );
        } else if (media.type === 'image') {
            return (
                <div className="w-full min-w-[260px] sm:min-w-[300px] max-h-96 rounded-lg bg-black border border-slate-700 flex items-center justify-center overflow-hidden">
                    <img src={blobUrl} className="max-w-full max-h-full object-contain" alt="media" />
                </div>
            );
        } else if (media.type === 'audio') {
            return (
                <div className="w-full min-w-[260px] sm:min-w-[300px] rounded-lg border border-slate-700 bg-slate-900 p-4 flex flex-col gap-3 shadow-lg">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                            <FileAudio size={20} className="text-onion-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-200 truncate">Audio Message</div>
                            <div className="text-xs text-slate-500">{formatDuration(media.duration)} • {formatBytes(media.size)}</div>
                        </div>
                    </div>
                    <audio src={blobUrl} controls autoPlay={autoPlay} className="w-full h-10" onError={() => setError("Playback Error")} />
                </div>
            );
        } else {
            return (
                <div className="flex items-center gap-3 bg-slate-800 p-3 rounded-lg border border-slate-700 hover:bg-slate-750 transition-colors group min-w-[260px]">
                    <div className="w-10 h-10 rounded-lg bg-indigo-900/50 flex items-center justify-center border border-indigo-500/30">
                        <FileText size={20} className="text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-200 truncate">{media.filename || 'Unknown File'}</div>
                        <div className="text-xs text-slate-500">{formatBytes(media.size)} • {media.mimeType}</div>
                    </div>
                    <button
                        onClick={downloadFileLocally}
                        className="p-2 bg-slate-900 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors border border-slate-700"
                        title="Save File"
                    >
                        <Download size={16} />
                    </button>
                </div>
            );
        }
    }

    // Fallback / Loading State
    // ADDED: min-w-[260px] to prevent collapse in flex container
    return (
        <div className={`w-full min-w-[260px] sm:min-w-[300px] rounded-lg border border-slate-700 bg-slate-900 overflow-hidden relative ${media.type === 'video' ? 'aspect-video' : 'p-4 min-h-[160px]'}`}>

            {/* Thumbnail / Placeholder */}
            {media.type === 'video' ? (
                media.thumbnail ? (
                    <img src={media.thumbnail} className="w-full h-full object-cover opacity-50" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-black">
                        <FileVideo size={48} className="text-slate-600" />
                    </div>
                )
            ) : media.type === 'audio' ? (
                <div className="flex items-center gap-3 h-full">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
                        <FileAudio size={20} className="text-onion-400" />
                    </div>
                    <div>
                        <div className="text-sm font-medium text-slate-200">Audio Message</div>
                        <div className="text-xs text-slate-500">{formatDuration(media.duration)} • {formatBytes(media.size)}</div>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-3 opacity-50 h-full">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
                        <File size={20} className="text-slate-400" />
                    </div>
                    <div>
                        <div className="text-sm font-medium text-slate-200">{media.filename || 'File'}</div>
                        <div className="text-xs text-slate-500">{formatBytes(media.size)}</div>
                    </div>
                </div>
            )}

            {/* Overlay Controls */}
            <div className="absolute inset-0 flex items-center justify-center flex-col bg-black/40 backdrop-blur-[2px]">
                {isBackgroundSyncing ? (
                    /* BACKGROUND SYNC STATE */
                    <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-center p-4">
                        <Cloud className="text-emerald-500 animate-pulse mb-3" size={32} />
                        <h4 className="text-white font-bold text-sm">Syncing in Background</h4>
                        <p className="text-[10px] text-slate-400 mt-1 max-w-[240px] leading-relaxed">
                            This file is downloading securely via the mesh. You can browse other chats.
                        </p>
                        <div className="w-48 h-1 bg-slate-700 rounded-full overflow-hidden mt-4">
                            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${downloadProgress}%` }} />
                        </div>
                        <span className="text-[10px] text-emerald-400 font-mono mt-1">{downloadProgress}%</span>
                    </div>
                ) : !isDownloading ? (
                    /* IDLE STATE */
                    error ? (
                        <button
                            onClick={handleRetry}
                            className="flex flex-col items-center gap-2 group text-red-400 hover:text-red-300"
                        >
                            <RefreshCw size={24} />
                            <span className="text-xs font-bold">{error} - Retry</span>
                        </button>
                    ) : (
                        <button
                            onClick={startDownloadProcess}
                            className="flex flex-col items-center gap-2 group relative"
                        >
                            <div className="w-14 h-14 rounded-full bg-onion-600 group-hover:bg-onion-500 flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
                                <Download size={28} className="text-white" />
                            </div>
                            <span className="text-xs font-bold text-white shadow-black drop-shadow-md bg-black/40 px-3 py-1 rounded-full mt-2 backdrop-blur">
                                {formatBytes(media.size)}
                            </span>
                            {IS_LARGE_FILE && (
                                <span className="text-[10px] text-amber-300 bg-black/80 px-2 py-0.5 rounded-full border border-amber-500/30 mt-1 font-bold">Large File</span>
                            )}
                        </button>
                    )
                ) : (
                    /* BLOCKING SYNC STATE (Small Files) */
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 size={36} className="text-onion-500 animate-spin" />

                        {isSearching ? (
                            <div className="flex flex-col items-center animate-pulse">
                                <div className="flex items-center gap-2 text-onion-300 text-xs font-bold">
                                    <Radio size={14} />
                                    <span>SEARCHING MESH...</span>
                                </div>
                                <span className="text-[10px] text-slate-400 mt-1">Locating peer with file...</span>
                            </div>
                        ) : (
                            <>
                                <div className="w-32 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-onion-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                                </div>
                                <span className="text-xs font-mono text-white">{downloadProgress}%</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
