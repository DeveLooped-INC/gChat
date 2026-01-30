
import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, RefreshCw, Check, AlertTriangle, Image as ImageIcon } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (base64Image: string) => void;
}

const CameraModal: React.FC<CameraModalProps> = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [useNative, setUseNative] = useState(false);
  
  // Zoom State
  const [zoom, setZoom] = useState(1);
  const [zoomCapability, setZoomCapability] = useState<{min: number, max: number} | null>(null);

  useEffect(() => {
    if (isOpen && !useNative) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, facingMode, useNative]);

  const startCamera = async () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: facingMode, 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 } 
        }, 
        audio: false 
      });
      
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      // Get Zoom Capabilities
      const track = mediaStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      // @ts-ignore - Zoom is a newer standard property
      if (capabilities.zoom) {
          // @ts-ignore
          setZoomCapability(capabilities.zoom);
      }

      setError(null);
    } catch (err: any) {
      console.error("Camera Error:", err);
      let msg = "Could not access camera.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = "Permission denied. Check settings.";
      } else if (err.name === 'NotFoundError') {
          msg = "No camera found.";
      }
      setError(msg);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setCapturedImage(null);
  };

  const toggleCamera = () => {
      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newZoom = parseFloat(e.target.value);
      setZoom(newZoom);
      if (stream) {
          const track = stream.getVideoTracks()[0];
          // @ts-ignore
          track.applyConstraints({ advanced: [{ zoom: newZoom }] });
      }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        if (facingMode === 'user') {
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setCapturedImage(dataUrl);
      }
    }
  };

  const handleNativeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (ev) => {
              if(ev.target?.result) setCapturedImage(ev.target.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black animate-in fade-in duration-200">
      <div className="w-full h-full md:max-w-lg md:h-auto md:bg-slate-900 md:rounded-2xl md:overflow-hidden md:border md:border-slate-700 md:shadow-2xl flex flex-col relative">
        
        {/* Header */}
        <div className="absolute md:relative top-0 left-0 right-0 p-4 z-20 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent md:bg-slate-950 md:border-b md:border-slate-800">
           <h3 className="text-white font-bold flex items-center gap-2 drop-shadow-md md:drop-shadow-none">
             <Camera size={20} className="text-onion-500" />
             <span>Capture</span>
           </h3>
           <button onClick={onClose} className="text-white md:text-slate-400 md:hover:text-white bg-black/30 md:bg-transparent p-2 rounded-full backdrop-blur-md md:backdrop-blur-none transition-colors"><X size={24} /></button>
        </div>

        {/* Viewport */}
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
           {useNative ? (
               <div className="text-center p-6 space-y-4">
                   <p className="text-slate-400 text-sm">Using device camera app...</p>
                   <button onClick={() => nativeInputRef.current?.click()} className="bg-onion-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 mx-auto">
                       <Camera size={20} /> Open Camera
                   </button>
                   <input 
                       ref={nativeInputRef} 
                       type="file" 
                       accept="image/*" 
                       capture="environment" 
                       className="hidden" 
                       onChange={handleNativeFile} 
                   />
                   <button onClick={() => setUseNative(false)} className="text-slate-500 text-xs underline">Switch back to in-app camera</button>
               </div>
           ) : error ? (
             <div className="text-red-400 text-center p-6 max-w-xs">
                <AlertTriangle size={48} className="mx-auto mb-4 opacity-50" />
                <p className="font-bold mb-2">Camera Error</p>
                <p className="text-sm mb-4">{error}</p>
                <button onClick={() => setUseNative(true)} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm">Use Native Camera App</button>
             </div>
           ) : capturedImage ? (
             <img src={capturedImage} alt="Captured" className="w-full h-full object-contain" />
           ) : (
             <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'transform scale-x-[-1]' : ''}`} 
             />
           )}
           
           <canvas ref={canvasRef} className="hidden" />

           {/* In-App Controls (Zoom + Flip) */}
           {!capturedImage && !error && !useNative && (
               <>
                   {zoomCapability && (
                       <div className="absolute left-6 top-1/2 -translate-y-1/2 h-48 bg-black/30 rounded-full w-8 flex flex-col items-center justify-center backdrop-blur-md border border-white/10 z-20">
                           <input 
                               type="range" 
                               min={zoomCapability.min} 
                               max={zoomCapability.max} 
                               step={0.1} 
                               value={zoom} 
                               onChange={handleZoomChange}
                               className="w-40 h-8 -rotate-90 origin-center"
                           />
                       </div>
                   )}
                   <button 
                       onClick={toggleCamera}
                       className="absolute bottom-6 right-6 md:bottom-4 md:right-4 p-3 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/20 hover:bg-black/60 transition-colors z-20"
                   >
                       <RefreshCw size={24} />
                   </button>
                   {/* Fallback Trigger */}
                   <button 
                       onClick={() => setUseNative(true)}
                       className="absolute bottom-6 left-6 md:bottom-4 md:left-4 p-3 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/20 hover:bg-black/60 transition-colors z-20"
                       title="Use Native App"
                   >
                       <ImageIcon size={24} />
                   </button>
               </>
           )}
        </div>

        {/* Footer Controls */}
        <div className="absolute md:relative bottom-0 left-0 right-0 p-8 md:p-6 flex justify-center items-center space-x-12 md:space-x-6 bg-gradient-to-t from-black/90 to-transparent md:bg-slate-900 z-20">
           {capturedImage ? (
             <>
               <button 
                 onClick={() => setCapturedImage(null)}
                 className="flex flex-col items-center space-y-1 text-slate-300 md:text-slate-400 hover:text-white transition-colors"
               >
                 <div className="p-3 rounded-full bg-white/10 md:bg-slate-800 border border-white/20 md:border-slate-700 backdrop-blur-md">
                    <RefreshCw size={24} />
                 </div>
                 <span className="text-xs font-bold shadow-black drop-shadow-md">Retake</span>
               </button>

               <button 
                 onClick={() => { onCapture(capturedImage); onClose(); }}
                 className="flex flex-col items-center space-y-1 text-emerald-400 hover:text-emerald-300 transition-colors"
               >
                 <div className="p-4 rounded-full bg-emerald-600/80 md:bg-emerald-500/20 border border-emerald-500 backdrop-blur-md">
                    <Check size={32} className="text-white md:text-emerald-500" />
                 </div>
                 <span className="text-xs font-bold shadow-black drop-shadow-md">Use Photo</span>
               </button>
             </>
           ) : !useNative && !error && (
             <button 
               onClick={takePhoto}
               className="w-20 h-20 md:w-16 md:h-16 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg shadow-black/50"
             >
               <div className="w-16 h-16 md:w-14 md:h-14 bg-white rounded-full border-2 border-slate-900" />
             </button>
           )}
        </div>
      </div>
    </div>
  );
};

export default CameraModal;
