import React, { useState } from 'react';
import { Smartphone, Loader2, Wifi, Key, ShieldCheck, X, Camera } from 'lucide-react';
import QRScanner from './QRScanner';
import { validateMnemonic, keysFromMnemonic } from '../services/mnemonicService';
import { generateTripcode } from '../services/cryptoService';
import { networkService } from '../services/networkService';

interface LinkData {
    address: string;
    privateOnion: string;
    masterIp: string;
    apiPort: string;
    name: string;
}

interface MobileLinkModalProps {
    onLinked: (linkData: LinkData, keys: any, userId: string, tripcode: string) => void;
    onClose: () => void;
}

const MobileLinkModal: React.FC<MobileLinkModalProps> = ({ onLinked, onClose }) => {
    const [step, setStep] = useState<'scan' | 'verify' | 'linking'>('scan');
    const [linkData, setLinkData] = useState<LinkData | null>(null);
    const [mnemonicInput, setMnemonicInput] = useState('');
    const [error, setError] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleQRScan = (data: string) => {
        try {
            // Parse gchat://link-node?address=...&private=...&masterIp=...&apiPort=...&name=...
            const url = new URL(data);
            if (url.protocol !== 'gchat:' || url.hostname !== 'link-node') {
                setError('Invalid QR code. Please scan the Node QR from the Settings page of your master node.');
                setStep('scan');
                return;
            }

            const parsed: LinkData = {
                address: url.searchParams.get('address') || '',
                privateOnion: url.searchParams.get('private') || '',
                masterIp: url.searchParams.get('masterIp') || '',
                apiPort: url.searchParams.get('apiPort') || '',
                name: decodeURIComponent(url.searchParams.get('name') || 'Unknown'),
            };

            if (!parsed.masterIp || !parsed.apiPort) {
                setError('QR code is missing connection info. Make sure to scan the Node QR from Settings.');
                return;
            }

            setLinkData(parsed);
            setError('');
            setStep('verify');
        } catch (e) {
            setError('Could not parse QR code data.');
        }
    };

    const handleVerify = async () => {
        if (!mnemonicInput.trim() || !linkData) return;
        setIsProcessing(true);
        setError('');

        const phrase = mnemonicInput.trim().toLowerCase().split(/\s+/);
        if (!validateMnemonic(phrase)) {
            setError('Invalid seed phrase. Please check your words.');
            setIsProcessing(false);
            return;
        }

        try {
            const keys = await keysFromMnemonic(phrase.join(' '));
            const userId = keys.signing.publicKey;
            const tripcode = generateTripcode(userId);

            setStep('linking');

            // Reconfigure networkService to point to the master
            networkService.reconfigure(linkData.masterIp, linkData.apiPort);

            // Store the private onion for Tor-based connections
            if (linkData.privateOnion) {
                localStorage.setItem('gchat_private_onion', linkData.privateOnion);
            }
            if (linkData.address) {
                localStorage.setItem('gchat_master_onion', linkData.address);
            }

            // Mark this as a frontend-only install
            localStorage.setItem('gchat_frontend_only', 'true');

            // Re-init the socket connection with the new backend
            networkService.init();

            // Wait briefly for connection then proceed
            setTimeout(() => {
                onLinked(linkData, keys, userId, tripcode);
            }, 1500);
        } catch (e) {
            setError('Failed to derive keys. Please try again.');
            setIsProcessing(false);
            setStep('verify');
        }
    };

    if (step === 'scan') {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                    <div className="p-4 bg-slate-950 flex justify-between items-center border-b border-slate-800">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <Smartphone size={20} className="text-cyan-400" />
                            Link to Existing Node
                        </h3>
                        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
                    </div>

                    {error && (
                        <div className="mx-4 mt-4 p-3 bg-red-950/50 border border-red-500/30 rounded-lg text-red-300 text-xs text-center">
                            {error}
                        </div>
                    )}

                    <div className="p-6 space-y-4">
                        <div className="bg-slate-800/50 p-4 rounded-xl text-center space-y-2">
                            <Wifi size={32} className="text-cyan-400 mx-auto" />
                            <p className="text-slate-300 text-sm">
                                Open <strong>Settings → Node QR</strong> on your master node, then scan it here.
                            </p>
                            <p className="text-slate-500 text-xs">
                                Make sure both devices are on the same WiFi network.
                            </p>
                        </div>

                        <QRScanner onScan={handleQRScan} onClose={onClose} />
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'verify') {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
                    <div className="p-4 bg-slate-950 flex justify-between items-center border-b border-slate-800">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <Key size={20} className="text-amber-400" />
                            Verify Identity
                        </h3>
                        <button onClick={() => { setStep('scan'); setError(''); }} className="text-slate-400 hover:text-white text-xs">Back</button>
                    </div>

                    <div className="p-6 space-y-5">
                        {/* Connection Info */}
                        <div className="bg-emerald-950/30 border border-emerald-500/30 p-4 rounded-xl">
                            <div className="flex items-center gap-2 mb-2">
                                <ShieldCheck size={16} className="text-emerald-400" />
                                <span className="text-emerald-300 font-bold text-sm">Node Found</span>
                            </div>
                            <div className="text-xs space-y-1 text-slate-400 font-mono">
                                <div>Owner: <span className="text-white">{linkData?.name}</span></div>
                                <div>LAN: <span className="text-cyan-400">{linkData?.masterIp}:{linkData?.apiPort}</span></div>
                                {linkData?.address && (
                                    <div>Onion: <span className="text-onion-400">{linkData.address.substring(0, 20)}...</span></div>
                                )}
                            </div>
                        </div>

                        {/* Seed Phrase Input */}
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Enter your 12-word secret phrase:</label>
                            <textarea
                                value={mnemonicInput}
                                onChange={e => setMnemonicInput(e.target.value)}
                                placeholder="word1 word2 word3 ..."
                                className="w-full h-28 bg-slate-950 border border-slate-800 rounded-lg p-4 text-white font-mono text-sm focus:outline-none focus:border-amber-500 resize-none"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-950/50 border border-red-500/30 rounded-lg text-red-300 text-xs text-center">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleVerify}
                            disabled={isProcessing || !mnemonicInput.trim()}
                            className="w-full py-4 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                        >
                            {isProcessing && <Loader2 size={16} className="animate-spin" />}
                            Verify & Connect
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // step === 'linking'
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-8 text-center space-y-4">
                <Loader2 size={48} className="animate-spin text-cyan-400 mx-auto" />
                <h3 className="text-white font-bold text-lg">Connecting to Node...</h3>
                <p className="text-slate-400 text-sm">
                    Linking to <span className="text-cyan-400 font-mono">{linkData?.masterIp}</span>
                </p>
            </div>
        </div>
    );
};

export default MobileLinkModal;
