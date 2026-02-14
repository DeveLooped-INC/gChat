import React from 'react';
import { NotificationItem, NotificationCategory } from '../types';
import { CheckCircle, Info, AlertTriangle, AlertCircle, Bell, Check, Trash2, ExternalLink, Settings } from 'lucide-react';
import NotificationSettingsModal from './NotificationSettingsModal';

const formatTimeAgo = (timestamp: number | string): string => {
    const time = new Date(timestamp).getTime();
    if (isNaN(time)) return 'Unknown date';

    const seconds = Math.floor((Date.now() - time) / 1000);

    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
};

interface NotificationsProps {
    notifications: NotificationItem[];
    onClear: () => void;
    onMarkRead: () => void;
    onNotificationClick: (item: NotificationItem) => void;
    mutedCategories: NotificationCategory[];
    onToggleMute: (category: NotificationCategory) => void;
}

const Notifications: React.FC<NotificationsProps> = ({ notifications, onClear, onMarkRead, onNotificationClick, mutedCategories, onToggleMute }) => {
    const [showSettings, setShowSettings] = React.useState(false);
    const [, setTick] = React.useState(0);

    // Re-render every 60s to keep relative times current
    React.useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(timer);
    }, []);

    const getIcon = (type: NotificationItem['type']) => {
        switch (type) {
            case 'success': return <CheckCircle size={20} className="text-emerald-500" />;
            case 'warning': return <AlertTriangle size={20} className="text-amber-500" />;
            case 'error': return <AlertCircle size={20} className="text-red-500" />;
            default: return <Info size={20} className="text-blue-500" />;
        }
    };

    const getBorderColor = (type: NotificationItem['type']) => {
        switch (type) {
            case 'success': return 'border-emerald-500/30';
            case 'warning': return 'border-amber-500/30';
            case 'error': return 'border-red-500/30';
            default: return 'border-blue-500/30';
        }
    };

    const getBgColor = (read: boolean) => {
        return read ? 'bg-slate-900' : 'bg-slate-800';
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-2xl mx-auto p-4 md:p-8 flex flex-col relative">
            <NotificationSettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                mutedCategories={mutedCategories}
                onToggleMute={onToggleMute}
            />

            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-slate-800 rounded-xl">
                        <Bell size={24} className="text-onion-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Notifications</h2>
                        <p className="text-slate-400 text-sm">Recent system events and alerts</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
                        title="Notification Settings"
                    >
                        <Settings size={16} /> <span className="hidden sm:inline">Settings</span>
                    </button>
                    <div className="w-px h-8 bg-slate-700 mx-1"></div>
                    <button
                        onClick={onMarkRead}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
                        title="Mark all as read"
                    >
                        <Check size={16} /> <span className="hidden sm:inline">Mark Read</span>
                    </button>
                    <button
                        onClick={onClear}
                        className="flex items-center gap-2 bg-slate-800 hover:bg-red-900/30 text-slate-300 hover:text-red-400 px-3 py-2 rounded-lg text-sm transition-colors"
                        title="Clear history"
                    >
                        <Trash2 size={16} /> <span className="hidden sm:inline">Clear</span>
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 space-y-3 pb-20">
                {notifications.length === 0 && (
                    <div className="text-center py-20 text-slate-500 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                        <Bell size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No notifications yet.</p>
                    </div>
                )}

                {notifications.map(item => (
                    <div
                        key={item.id}
                        onClick={() => onNotificationClick(item)}
                        className={`p-4 rounded-xl border ${getBorderColor(item.type)} ${getBgColor(item.read)} transition-all flex gap-4 animate-in fade-in slide-in-from-bottom-2 ${item.linkRoute ? 'cursor-pointer hover:bg-slate-750 hover:border-slate-600' : ''}`}
                    >
                        <div className="mt-1 shrink-0">
                            {getIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                                <h3 className={`text-sm font-bold flex items-center gap-2 ${item.read ? 'text-slate-300' : 'text-white'}`}>
                                    {item.title}
                                    {item.linkRoute && <ExternalLink size={12} className="opacity-50" />}
                                </h3>
                                <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2">
                                    {formatTimeAgo(item.timestamp)}
                                </span>
                            </div>
                            <p className={`text-xs mt-1 leading-relaxed ${item.read ? 'text-slate-500' : 'text-slate-300'}`}>
                                {item.message}
                            </p>
                        </div>
                        {!item.read && (
                            <div className="w-2 h-2 rounded-full bg-onion-500 mt-2 shrink-0" />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Notifications;
