import React, { useState } from 'react';
import { AlertTriangle, Copy, X } from 'lucide-react';

interface ExternalLinkWarningModalProps {
    isOpen: boolean;
    onClose: () => void;
    link: string;
}

const ExternalLinkWarningModal: React.FC<ExternalLinkWarningModalProps> = ({ isOpen, onClose, link }) => {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-red-900/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-red-950/20">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="text-red-500" size={24} />
                        <h2 className="text-red-400 font-bold text-lg">Privacy Warning</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <h3 className="text-slate-200 font-semibold mb-3">You are about to unmask yourself!</h3>
                    <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                        Clicking this link will open it in your standard browser. This means you will <strong>leave the Tor Onion network</strong> and the target website will be able to see your real IP address.
                    </p>

                    <div className="bg-slate-950 rounded-lg p-3 flex items-center justify-between gap-3 border border-slate-800 mb-6">
                        <span className="text-slate-300 text-sm truncate font-mono select-all">
                            {link}
                        </span>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={handleCopy}
                            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2"
                        >
                            <Copy size={18} />
                            {copied ? 'Copied!' : 'Copy to Clipboard'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExternalLinkWarningModal;
