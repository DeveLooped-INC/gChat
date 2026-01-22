import React, { useRef, useEffect, useState } from 'react';
import { X, Camera, Image as ImageIcon } from 'lucide-react';
import jsQR from 'jsqr';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for video to be ready before scanning
        videoRef.current.setAttribute("playsinline", "true"); 
        videoRef.current.play();
        requestRef.current = requestAnimationFrame(tick);
      }
    } catch (err) {
      setError("Unable to access camera.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  };

  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      if (canvas) {
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code) {
             onScan(code.data);
             return; // Stop loop
          }
        }
      }
    }
    requestRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4">
      <div className="w-full max-w-md bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 relative">
         <div className="p-4 bg-slate-950 flex justify-between items-center border-b border-slate-800">
           <h3 className="text-white font-bold flex items-center gap-2">
             <Camera size={20} className="text-onion-500" />
             <span>Scan QR Code</span>
           </h3>
           <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>
        
        <div className="relative bg-black aspect-square flex items-center justify-center">
            {error ? (
                <div className="text-red-400 p-4 text-center">{error}</div>
            ) : (
                <video ref={videoRef} className="w-full h-full object-cover" />
            )}
            {/* Scan Overlay */}
            <div className="absolute inset-0 border-2 border-onion-500/50 pointer-events-none m-12 rounded-xl">
                 <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-onion-500 -mt-0.5 -ml-0.5"></div>
                 <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-onion-500 -mt-0.5 -mr-0.5"></div>
                 <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-onion-500 -mb-0.5 -ml-0.5"></div>
                 <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-onion-500 -mb-0.5 -mr-0.5"></div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
        </div>
        
        <div className="p-4 text-center text-slate-400 text-xs">
            Point camera at a gChat Identity Card
        </div>
      </div>
    </div>
  );
};

export default QRScanner;