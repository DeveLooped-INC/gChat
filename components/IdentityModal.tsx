import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Shield, Server } from 'lucide-react';
import QRCode from 'qrcode';

interface IdentityModalProps {
  type: 'user' | 'node';
  data: {
    id: string; // PubKey or Onion
    name: string;
    nodeAddress?: string; // Only for user
  };
  onClose: () => void;
}

const IdentityModal: React.FC<IdentityModalProps> = ({ type, data, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // CRITICAL: We MUST encodeURIComponent for IDs (Base64) because they contain '+' and '/' 
  // which are special characters in URLs.
  const deepLink = type === 'user' 
    ? `http://localhost:3000/?action=add-contact&id=${encodeURIComponent(data.id)}&node=${data.nodeAddress}&name=${encodeURIComponent(data.name)}`
    : `http://localhost:3000/?action=add-peer&address=${data.id}`;

  useEffect(() => {
    QRCode.toDataURL(deepLink, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error(err));
  }, [deepLink]);

  const handleCopy = () => {
    navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
          <h3 className="font-bold text-white flex items-center gap-2">
            {type === 'user' ? <Shield className="text-emerald-500" size={20} /> : <Server className="text-onion-500" size={20} />}
            {type === 'user' ? 'User Identity' : 'Node Identity'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="p-6 flex flex-col items-center space-y-6">
          <div className="bg-white p-2 rounded-xl shadow-lg">
             {qrDataUrl ? <img src={qrDataUrl} alt="QR Code" className="w-48 h-48" /> : <div className="w-48 h-48 bg-slate-200 animate-pulse rounded" />}
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold text-white">{data.name}</h2>
            <p className="text-xs font-mono text-slate-400 break-all px-4">{data.id}</p>
          </div>

          <div className="w-full space-y-3">
             <button 
                onClick={handleCopy}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
             >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Link Copied' : 'Copy Invite Link'}
             </button>
             <p className="text-[10px] text-slate-500 text-center">
               Scan this with another gChat node to connect instantly.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IdentityModal;