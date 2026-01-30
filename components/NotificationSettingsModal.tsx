import React from 'react';
import { X, CheckCircle, Info, AlertTriangle, Server, MessageSquare, Radio } from 'lucide-react';
import { NotificationCategory } from '../types';

interface NotificationSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mutedCategories: NotificationCategory[];
    onToggleMute: (category: NotificationCategory) => void;
}

const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({ isOpen, onClose, mutedCategories = [], onToggleMute }) => {
    if (!isOpen) return null;

    const categories: { id: NotificationCategory, label: string, description: string, icon: React.ReactNode, color: string }[] = [
        {
            id: 'admin',
            label: 'Administrative',
            description: 'New node signals, connections, sync updates, and system alerts.',
            icon: <Server size={18} />,
            color: 'text-emerald-500'
        },
        {
            id: 'social',
            label: 'Social Feed',
            description: 'New comments, replies, votes, reactions, and broadcasts.',
            icon: <Radio size={18} />,
            color: 'text-indigo-500'
        },
        {
            id: 'chat',
            label: 'Chat',
            description: 'Direct messages, group invites, and chat mentions.',
            icon: <MessageSquare size={18} />,
            color: 'text-onion-500'
        },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl m-4">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        Notification Settings
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
                </div>
                <div className="p-2">
                    <div className="p-4 text-xs text-slate-400 bg-slate-800/50 rounded-lg mb-4 mx-4 mt-4">
                        <div className="flex gap-2">
                            <Info size={16} className="shrink-0" />
                            <p>Toggle switches to mute specific notification content. Muted items will definitely appear in your list but won't pop up as toasts.</p>
                        </div>
                    </div>

                    <div className="space-y-1 px-4 pb-6">
                        {categories.map(cat => {
                            const isMuted = mutedCategories.includes(cat.id);
                            return (
                                <div key={cat.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-1 ${cat.color}`}>{cat.icon}</div>
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-200">{cat.label}</h4>
                                            <p className="text-xs text-slate-500">{cat.description}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => onToggleMute(cat.id)}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${!isMuted ? 'bg-onion-600' : 'bg-slate-700'}`}
                                        title={isMuted ? "Unmute" : "Mute"}
                                    >
                                        <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${!isMuted ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NotificationSettingsModal;
