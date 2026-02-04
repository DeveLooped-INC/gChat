
import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, ArrowRight, Lock, Server, Loader2, RefreshCw, Upload, UserPlus, LogIn, Key, Copy, Check, Trash2, AlertTriangle, Cpu, FileArchive, X, Users } from 'lucide-react';
import { UserProfile } from '../types';
import { networkService } from '../services/networkService';
import { loadWordlist, generateMnemonic, validateMnemonic, keysFromMnemonic } from '../services/mnemonicService';
import { generateTripcode } from '../services/cryptoService';
import { restoreMigrationPackage } from '../services/migrationService';
import { storageService } from '../services/storage';
import { kvService } from '../services/kv';
import { clearMediaCache } from '../services/mediaStorage';

interface OnboardingProps {
    onComplete: (profile: UserProfile) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const [nodeStep, setNodeStep] = useState<'intro' | 'booting' | 'ready'>('intro');
    const [nodeOnion, setNodeOnion] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);

    const [authMode, setAuthMode] = useState<'menu' | 'create' | 'login' | 'recovery-details' | 'import'>('menu');
    const [mnemonic, setMnemonic] = useState<string[]>([]);
    const [mnemonicInput, setMnemonicInput] = useState('');

    // Profile Data
    const [handle, setHandle] = useState(''); // Replaces general username/displayName logic

    // Internal State
    const [recoveredKeys, setRecoveredKeys] = useState<any>(null);
    const [calculatedTripcode, setCalculatedTripcode] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [wordlistLoaded, setWordlistLoaded] = useState(false);

    // Mismatch State
    const [showMismatchWarning, setShowMismatchWarning] = useState(false);
    const [mismatchData, setMismatchData] = useState<{ derivedId: string, ownerId: string, guestName?: string } | null>(null);

    // Import State
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importPassword, setImportPassword] = useState('');
    const [importError, setImportError] = useState('');

    const importFileInputRef = useRef<HTMLInputElement>(null);

    // Port Warning
    const isCorrectPort = window.location.port === '3000';

    useEffect(() => {
        loadWordlist().then(success => {
            if (success) setWordlistLoaded(true);
            else console.warn("Failed to load security wordlist.");
        });

        networkService.onLog = (msg) => {
            setLogs(prev => {
                const newLogs = [...prev, msg];
                if (newLogs.length > 50) return newLogs.slice(newLogs.length - 50);
                return newLogs;
            });
        };

        const unsubscribe = networkService.subscribeToStatus((isOnline, id) => {
            if (isOnline && id) {
                setNodeOnion(id);
                setNodeStep(currentStep => {
                    if (currentStep !== 'ready') return 'ready';
                    return currentStep;
                });
            }
        });

        networkService.init('init');

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    // When mnemonic is generated or entered, calculate keys and tripcode immediately for preview
    useEffect(() => {
        const calc = async () => {
            if (authMode === 'create' && mnemonic.length === 12) {
                const keys = await keysFromMnemonic(mnemonic.join(' '));
                setCalculatedTripcode(generateTripcode(keys.signing.publicKey));
            }
        };
        calc();
    }, [mnemonic, authMode]);

    const startBoot = () => {
        setNodeStep('booting');
        networkService.init('init');
    };

    const generateNewIdentity = () => {
        const phrase = generateMnemonic(12);
        setMnemonic(phrase);
        setAuthMode('create');
    };

    const handleLogin = async () => {
        if (!mnemonicInput.trim()) return;
        setIsProcessing(true);

        const phrase = mnemonicInput.trim().toLowerCase().split(/\s+/);
        if (!validateMnemonic(phrase)) {
            alert("Invalid Seed Phrase. Please check your words.");
            setIsProcessing(false);
            return;
        }

        const keys = await keysFromMnemonic(phrase.join(' '));
        const userId = keys.signing.publicKey;
        const tripcode = generateTripcode(userId);
        setCalculatedTripcode(tripcode);

        // SAFETY CHECK: Does this match the Node Owner?
        try {
            const nodeOwnerId = await kvService.get<string>('gchat_node_owner');

            if (nodeOwnerId && nodeOwnerId !== userId) {
                // Attempt to find guest name from local registry
                const registry = await kvService.get<any>('gchat_profile_registry') || {};
                const guestName = registry[userId]?.displayName;

                setMismatchData({ derivedId: userId, ownerId: nodeOwnerId, guestName });
                setShowMismatchWarning(true);
                setIsProcessing(false);
                return;
            }

            proceedWithLogin(keys, userId);
        } catch (e) {
            console.error("Login Check failed", e);
            setIsProcessing(false);
        }
    };

    const proceedWithLogin = async (keys: any, userId: string) => {
        // Check if we have local metadata for this user
        const registry = await kvService.get<any>('gchat_profile_registry') || {};
        const storedMeta = registry[userId];

        if (storedMeta) {
            // Known user on this device - restore immediately
            // Note: We use the stored displayName (Handle) and reconstruct the full unique username
            await finalizeUser(keys, storedMeta.displayName, storedMeta.avatarUrl, storedMeta.bio);
        } else {
            // Unknown user (new browser) - ask for details
            setRecoveredKeys(keys);
            setAuthMode('recovery-details');
            setIsProcessing(false);
        }
    };

    const handleRecoveryDetailsSubmit = async () => {
        if (!handle) return;
        setIsProcessing(true);
        await finalizeUser(recoveredKeys, handle);
    };

    const handleCreate = async () => {
        if (!handle) return;
        setIsProcessing(true);
        const phraseStr = mnemonic.join(' ');
        const keys = await keysFromMnemonic(phraseStr);
        await finalizeUser(keys, handle);
    };

    const handleFactoryReset = async () => {
        if (window.confirm("CRITICAL WARNING: This will wipe ALL local data, messages, contacts, and posts. Your node identity will be lost unless you have your seed phrase. Are you sure?")) {
            setIsProcessing(true);
            try {
                // 1. Wipe Backend (Deletes Tor Service & Data)
                // This should also handle clearing IndexedDB, Media Cache, and KV storage
                await networkService.factoryReset();
            } catch (e) {
                console.error("Backend reset failed (maybe already offline):", e);
            }

            // 2. Clear IndexedDB
            await storageService.deleteEverything();
            // 3. Clear Media Cache
            await clearMediaCache();
            // 4. Clear LocalStorage
            localStorage.clear();

            // 5. Hard Reload
            window.location.reload();
        }
    };

    const handleResetOwner = async () => {
        if (confirm("This will clear the 'Node Owner' lock. The next user to login will become the Admin. Do this only if you are locked out of settings.")) {
            await kvService.del('gchat_node_owner');
            alert("Owner lock cleared. Please login again.");
            window.location.reload();
        }
    };

    const handleImportMigration = async () => {
        if (!importFile || !importPassword) return;
        setIsProcessing(true);
        setImportError('');

        try {
            await restoreMigrationPackage(importFile, importPassword);
            window.location.reload(); // Reload to pick up restored storage
        } catch (e: any) {
            console.error(e);
            setImportError(e.message || "Failed to restore backup. Check password.");
            setIsProcessing(false);
        }
    };

    const finalizeUser = async (keys: any, chosenHandle: string, finalAvatar?: string, finalBio?: string) => {
        try {
            const userId = keys.signing.publicKey;
            const tripcode = generateTripcode(userId);

            // The "Username" is now the unique combination
            const uniqueUsername = `${chosenHandle}.${tripcode}`;

            const bio = finalBio || 'Secured by Tor';

            // --- PROFILE PERSISTENCE ---

            // --- PROFILE PERSISTENCE ---

            // 1. Update Registry (Store handle, avatar, AND bio)
            const registry = await kvService.get<any>('gchat_profile_registry') || {};
            const existingEntry = registry[userId] || {};

            registry[userId] = {
                ...existingEntry, // Preserve existing fields like isDiscoverable
                displayName: chosenHandle,
                username: uniqueUsername,
                avatarUrl: finalAvatar,
                bio: bio
            };
            await kvService.set('gchat_profile_registry', registry);

            // 2. Check for Admin Status (Node Ownership)
            let nodeOwnerId = await kvService.get<string>('gchat_node_owner');
            let isAdmin = false;

            if (!nodeOwnerId) {
                await kvService.set('gchat_node_owner', userId);
                nodeOwnerId = userId;
                isAdmin = true;
            } else if (nodeOwnerId === userId) {
                isAdmin = true;
            }

            const profile: UserProfile = {
                id: userId,
                username: uniqueUsername, // Globally Unique ID
                displayName: chosenHandle, // Human Readable Handle
                bio: bio,
                avatarUrl: finalAvatar,
                keys,
                isAdmin,
                homeNodeOnion: nodeOnion || 'offline',
                createdAt: Date.now(),
                followersCount: existingEntry.followersCount || 0,
                followingIds: existingEntry.followingIds || [],
                isDiscoverable: existingEntry.isDiscoverable,
                privacySettings: {
                    isPrivateProfile: false,
                    showBioPublicly: true,
                    showFollowersPublicly: true
                }
            };

            await kvService.set('gchat_user_profile', profile);

            onComplete(profile);
        } catch (e) {
            console.error(e);
            alert("Failed to generate identity.");
            setIsProcessing(false);
        }
    };

    const copyMnemonic = () => {
        navigator.clipboard.writeText(mnemonic.join(' '));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // --- RENDER ---

    if (nodeStep !== 'ready') {
        return (
            <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">

                    {nodeStep === 'intro' && (
                        <div className="p-8 text-center space-y-6 overflow-y-auto">
                            <div className="w-20 h-20 bg-onion-500 rounded-2xl mx-auto flex items-center justify-center shadow-[0_0_30px_rgba(217,70,239,0.4)]">
                                <Server className="text-white w-10 h-10" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold text-white mb-2">gChat Node</h1>
                                <p className="text-slate-400">Initialize Local Tor Relay</p>
                            </div>
                            <button
                                onClick={startBoot}
                                className="w-full py-4 bg-onion-600 hover:bg-onion-500 text-white rounded-xl font-bold flex items-center justify-center space-x-2 transition-all shadow-lg shadow-onion-900/20"
                            >
                                <span>Bootstrap Node</span>
                                <ArrowRight size={20} />
                            </button>
                        </div>
                    )}

                    {nodeStep === 'booting' && (
                        <div className="p-8 space-y-6 flex flex-col h-full">
                            <div className="flex items-center justify-between mb-4 shrink-0">
                                <span className="text-slate-500 font-mono text-sm">Bootstrapping Tor Daemon...</span>
                                <Loader2 size={16} className="animate-spin text-onion-500" />
                            </div>

                            <div
                                ref={logContainerRef}
                                className="bg-black rounded-lg p-4 font-mono text-xs flex-1 overflow-y-auto border border-slate-800 shadow-inner"
                            >
                                {logs.map((log, i) => (
                                    <div key={i} className={`mb-1 break-all ${log.includes('ERROR') ? 'text-red-500' : 'text-slate-400'
                                        }`}>
                                        {log}
                                    </div>
                                ))}
                            </div>
                            <p className="text-center text-xs text-slate-500 shrink-0">This may take up to 60s on first run.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // --- GUEST LOGIN MODAL ---
    if (showMismatchWarning && mismatchData) {
        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
                <div className="bg-slate-900 border border-indigo-500/50 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
                    <div className="flex items-center gap-3 mb-4 text-indigo-400">
                        <Users size={32} />
                        <h2 className="text-xl font-bold">Guest Login</h2>
                    </div>

                    <p className="text-slate-300 text-sm mb-4 leading-relaxed">
                        You are logging in as a <strong>Guest User</strong> on this node.
                    </p>

                    <div className="bg-black/50 p-3 rounded-lg font-mono text-xs space-y-2 mb-4">
                        <div>
                            <span className="text-slate-500 block">Node Owner:</span>
                            <span className="text-slate-400 break-all">{mismatchData.ownerId.substring(0, 16)}...</span>
                        </div>
                        <div className="border-t border-slate-800 pt-2">
                            <span className="text-slate-500 block">Your ID:</span>
                            <span className="text-indigo-400 break-all">{mismatchData.derivedId.substring(0, 16)}...</span>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => { setShowMismatchWarning(false); setMismatchData(null); }}
                            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-colors"
                        >
                            Back
                        </button>
                        <button
                            onClick={async () => {
                                const keys = await keysFromMnemonic(mnemonicInput.trim().toLowerCase().split(/\s+/).join(' '));
                                proceedWithLogin(keys, mismatchData.derivedId);
                            }}
                            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-colors"
                        >
                            Login as {mismatchData.guestName || 'Guest'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center p-4">

            {/* PORT WARNING */}
            {!isCorrectPort && (
                <div className="w-full max-w-lg mb-4 bg-red-950/50 border border-red-500/50 p-4 rounded-xl flex items-start gap-3 shrink-0">
                    <AlertTriangle className="text-red-500 shrink-0" size={24} />
                    <div>
                        <h3 className="text-red-200 font-bold text-sm">DATA MISMATCH WARNING</h3>
                        <p className="text-red-300/80 text-xs mt-1">
                            You are connected to port <strong>{window.location.port}</strong> instead of 3000.
                        </p>
                    </div>
                </div>
            )}

            <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 shrink-0">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <ShieldCheck className="text-emerald-500" size={20} />
                        User Identity
                    </h2>
                    {authMode !== 'menu' && (
                        <button onClick={() => { setAuthMode('menu'); setImportError(''); }} className="text-slate-400 hover:text-white text-xs">Back</button>
                    )}
                </div>

                {authMode === 'menu' && (
                    <div className="p-8 space-y-4 overflow-y-auto">
                        <p className="text-slate-400 text-center mb-6">Your node is online. Login or create a user identity.</p>

                        <button
                            onClick={generateNewIdentity}
                            disabled={!wordlistLoaded}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
                        >
                            <UserPlus size={20} />
                            <span>Create New User</span>
                        </button>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setAuthMode('login')}
                                disabled={!wordlistLoaded}
                                className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50"
                            >
                                <LogIn size={20} />
                                <span className="text-sm">Phrase Login</span>
                            </button>

                            <button
                                onClick={() => setAuthMode('import')}
                                className="w-full py-4 bg-indigo-900/50 hover:bg-indigo-900 border border-indigo-500/30 text-indigo-300 hover:text-white rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all"
                            >
                                <FileArchive size={20} />
                                <span className="text-sm">Import Backup</span>
                            </button>
                        </div>

                        <div className="pt-6 border-t border-slate-800 mt-6 flex flex-col items-center gap-3">
                            <span className="text-xs text-onion-400 font-mono">Node: {nodeOnion}</span>

                            <div className="flex gap-4">
                                <button
                                    onClick={handleResetOwner}
                                    className="flex items-center gap-1 text-[10px] text-amber-500/70 hover:text-amber-500 transition-colors"
                                >
                                    <Cpu size={10} />
                                    Clear Owner Lock
                                </button>

                                <button
                                    onClick={handleFactoryReset}
                                    className="flex items-center gap-1 text-[10px] text-red-500/70 hover:text-red-500 transition-colors"
                                >
                                    <AlertTriangle size={10} />
                                    Factory Reset Node
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {authMode === 'import' && (
                    <div className="p-8 space-y-6 overflow-y-auto">
                        <div className="bg-indigo-950/30 border border-indigo-500/30 p-4 rounded-lg text-center">
                            <h3 className="text-indigo-300 font-bold mb-1">Restore from Backup</h3>
                        </div>
                        <div className="space-y-4">
                            <button
                                onClick={() => importFileInputRef.current?.click()}
                                className="w-full border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-6 flex flex-col items-center gap-2 text-slate-400 hover:text-indigo-300 transition-colors"
                            >
                                <Upload size={24} />
                                <span className="text-sm font-medium">{importFile ? importFile.name : "Select .zip File"}</span>
                                <input type="file" ref={importFileInputRef} className="hidden" accept=".zip" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                            </button>
                            <input type="password" placeholder="Decryption Password" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500" />
                        </div>
                        {importError && <div className="text-xs text-red-400 bg-red-950/20 p-2 rounded border border-red-500/20 text-center">{importError}</div>}
                        <button onClick={handleImportMigration} disabled={isProcessing || !importFile || !importPassword} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">{isProcessing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}<span>Restore & Restart</span></button>
                    </div>
                )}

                {authMode === 'create' && (
                    <div className="p-8 space-y-6 overflow-y-auto">
                        <div className="bg-amber-900/20 border border-amber-500/30 p-4 rounded-lg">
                            <h3 className="text-amber-400 font-bold text-sm mb-2 flex items-center gap-2">
                                <Key size={16} /> Secret Recovery Phrase
                            </h3>
                            <div className="grid grid-cols-3 gap-2 mb-4">
                                {mnemonic.map((word, i) => (
                                    <span key={i} className="text-xs font-mono bg-black/50 text-slate-300 p-1.5 rounded text-center">
                                        {i + 1}. {word}
                                    </span>
                                ))}
                            </div>
                            <button
                                onClick={copyMnemonic}
                                className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded flex items-center justify-center gap-2"
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? 'Copied' : 'Copy to Clipboard'}
                            </button>
                            <p className="text-[10px] text-amber-200/70 mt-2 text-center">
                                WARNING: Write these words down. This is your ONLY way to login.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Your Public Handle</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Neo, Trinity"
                                    value={handle}
                                    onChange={e => {
                                        const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15);
                                        setHandle(val);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                                />
                            </div>

                            {/* ID Preview */}
                            <div className="bg-black/40 p-3 rounded-lg border border-slate-800 text-center">
                                <p className="text-xs text-slate-500 mb-1">Your Unique Network ID</p>
                                <div className="text-lg">
                                    <span className="font-bold text-white">{handle || '...'}</span>
                                    <span className="text-slate-500 font-mono text-sm">.{calculatedTripcode || '??????'}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleCreate}
                            disabled={isProcessing || !handle}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isProcessing && <Loader2 size={16} className="animate-spin" />}
                            Initialize User
                        </button>
                    </div>
                )}

                {authMode === 'login' && (
                    <div className="p-8 space-y-6 overflow-y-auto">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Enter your 12-word recovery phrase:</label>
                            <textarea
                                value={mnemonicInput}
                                onChange={e => setMnemonicInput(e.target.value)}
                                placeholder="word1 word2 word3 ..."
                                className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-4 text-white font-mono text-sm focus:outline-none focus:border-emerald-500 resize-none"
                            />
                        </div>

                        <button
                            onClick={handleLogin}
                            disabled={isProcessing || !mnemonicInput}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isProcessing && <Loader2 size={16} className="animate-spin" />}
                            Login
                        </button>
                    </div>
                )}

                {authMode === 'recovery-details' && (
                    <div className="p-8 space-y-6 overflow-y-auto">
                        <div className="text-center space-y-2">
                            <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                                <Check size={24} className="text-emerald-500" />
                            </div>
                            <h3 className="text-lg font-bold text-white">Keys Recovered</h3>
                            <p className="text-sm text-slate-400">
                                Your crypto keys are valid. Please confirm your public handle.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <input
                                type="text"
                                placeholder="Display Name / Handle"
                                value={handle}
                                onChange={e => {
                                    const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 15);
                                    setHandle(val);
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                            />

                            <div className="bg-black/40 p-3 rounded-lg border border-slate-800 text-center">
                                <p className="text-xs text-slate-500 mb-1">Restored Identity</p>
                                <div className="text-lg">
                                    <span className="font-bold text-white">{handle || '...'}</span>
                                    <span className="text-slate-500 font-mono text-sm">.{calculatedTripcode}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleRecoveryDetailsSubmit}
                            disabled={isProcessing || !handle}
                            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isProcessing && <Loader2 size={16} className="animate-spin" />}
                            Complete Recovery
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Onboarding;
