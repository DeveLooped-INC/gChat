
import React, { useState, useRef } from 'react';
import { Contact, UserProfile, ToastMessage, ConnectionRequest, Post, NotificationCategory, AvailablePeer } from '../types';
import { UserPlus, MapPin, Trash2, QrCode, Upload, Camera, Copy, Check, UserCheck, XCircle, Users, Activity, Server, Radio } from 'lucide-react';
import IdentityModal from './IdentityModal';
import QRScanner from './QRScanner';
import jsQR from 'jsqr';
import UserInfoModal, { UserInfoTarget } from './UserInfoModal';
import { formatUserIdentity } from '../utils';
import NodeInfoModal, { NodeInfoTarget } from './NodeInfoModal';

interface ContactsProps {
    currentUser: UserProfile;
    contacts: Contact[];
    requests: ConnectionRequest[];
    discoveredPeers?: AvailablePeer[];
    onAcceptRequest: (req: ConnectionRequest) => void;
    onDeclineRequest: (id: string) => void;
    onAddContact: (pubKey: string, homeNode: string, name: string) => void;
    onDeleteContact: (id: string) => void;
    addToast: (t: string, m: string, type: ToastMessage['type'], category?: NotificationCategory) => void;
    onNavigateToChat: (id: string) => void;
    onFollowUser: (id: string, node?: string) => void;
    onUnfollowUser: (id: string, node?: string) => void;
    onViewUserPosts: (userId: string) => void;
    posts: Post[];
}

const Contacts: React.FC<ContactsProps> = ({
    currentUser, contacts, requests, discoveredPeers = [], onAcceptRequest, onDeclineRequest, onAddContact, onDeleteContact, addToast, onNavigateToChat, onFollowUser, onUnfollowUser, onViewUserPosts, posts
}) => {
    const [showAddModal, setShowAddModal] = useState(false);
    const [showIdentityModal, setShowIdentityModal] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [userInfoTarget, setUserInfoTarget] = useState<UserInfoTarget | null>(null);
    const [nodeInfoTarget, setNodeInfoTarget] = useState<NodeInfoTarget | null>(null);

    // Form State
    const [newPubKey, setNewPubKey] = useState('');
    const [newHomeNode, setNewHomeNode] = useState('');
    const [newName, setNewName] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = () => {
        if (!newPubKey || !newHomeNode || !newName) {
            addToast("Error", "All fields required", 'error');
            return;
        }
        onAddContact(newPubKey, newHomeNode, newName);
        resetForm();
    };

    const resetForm = () => {
        setShowAddModal(false);
        setNewPubKey('');
        setNewHomeNode('');
        setNewName('');
    };

    const handleDelete = (contact: Contact) => {
        if (confirm(`Are you sure you want to remove ${contact.displayName}? This will delete message history.`)) {
            onDeleteContact(contact.id);
        }
    };

    const parseDeepLink = (url: string) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.searchParams.get('action') === 'add-contact') {
                const rawId = urlObj.searchParams.get('id');
                const id = rawId ? rawId.replace(/ /g, '+') : null;

                const node = urlObj.searchParams.get('node');
                const name = urlObj.searchParams.get('name');

                if (id && node && name) {
                    onAddContact(id, node, decodeURIComponent(name));
                    setShowScanner(false);
                    return;
                }
            }
            addToast("Invalid QR", "This code does not contain a valid contact invite.", 'error');
        } catch (e) {
            addToast("Error", "Could not parse QR code data.", 'error');
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height);
                    if (code) {
                        parseDeepLink(code.data);
                    } else {
                        addToast("Error", "No QR code found in image.", 'error');
                    }
                }
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-4xl mx-auto p-4 md:p-8 space-y-6">

            {/* Header Actions */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <div>
                    <h2 className="text-2xl font-bold text-white">My Contacts</h2>
                    <p className="text-slate-400 text-sm">Manage your trusted friend list.</p>
                </div>
                <div className="flex gap-3 w-full md:w-auto">
                    <button
                        onClick={() => setShowIdentityModal(true)}
                        className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                        <QrCode size={18} /> My ID Card
                    </button>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex-1 md:flex-none bg-onion-600 hover:bg-onion-500 text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                        <UserPlus size={18} /> Add Contact
                    </button>
                </div>
            </div>

            {discoveredPeers.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
                        <div>
                            <h3 className="text-white font-bold flex items-center gap-2">
                                <Radio size={16} className="text-onion-400 animate-pulse" />
                                Discovered Nodes
                            </h3>
                            <p className="text-xs text-slate-500">Nearby nodes discovered via gossip protocol</p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 bg-slate-800 px-2 py-1 rounded-full">
                            {discoveredPeers.length} Found
                        </span>
                    </div>

                    <div className="p-4 overflow-x-auto">
                        <div className="flex gap-4 w-max">
                            {discoveredPeers.map(peer => {
                                const { handle } = formatUserIdentity(peer.username || peer.displayName);
                                return (
                                    <button
                                        key={peer.id}
                                        onClick={() => setNodeInfoTarget({
                                            address: peer.id,
                                            alias: peer.displayName,
                                            description: peer.username, // Contains handle/identity
                                            type: 'discovered',
                                            hops: peer.hops,
                                            lastSeen: peer.lastSeen,
                                            via: peer.viaPeerId
                                        })}
                                        className="flex flex-col items-center gap-2 min-w-[80px] group"
                                    >
                                        <div className="relative">
                                            <div className="w-14 h-14 rounded-full bg-slate-800 border-2 border-slate-700 group-hover:border-onion-500 transition-colors overflow-hidden">
                                                <img
                                                    src={`https://robohash.org/${peer.username || peer.displayName}?set=set4&bgset=bg2&size=100x100`}
                                                    alt={peer.displayName}
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                            <div className="absolute -bottom-1 -right-1 bg-slate-900 rounded-full p-0.5">
                                                <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900" />
                                            </div>
                                        </div>
                                        <div className="text-center w-full">
                                            <p className="text-xs font-bold text-slate-300 truncate w-24 group-hover:text-onion-400 transition-colors">
                                                {handle}
                                            </p>
                                            <p className="text-[10px] text-slate-500 truncate w-20 mx-auto">
                                                {peer.hops} Hops
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Pending Requests */}
            {
                requests.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="text-xs font-bold text-onion-400 uppercase tracking-wide">Pending Requests</h3>
                        <div className="grid grid-cols-1 gap-3">
                            {requests.map(req => {
                                const { handle, suffix } = formatUserIdentity(req.fromUsername || req.fromDisplayName);
                                return (
                                    <div key={req.id} className="bg-slate-900 border border-onion-500/30 p-4 rounded-xl flex items-center justify-between animate-in slide-in-from-top-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-onion-400 border border-slate-700">
                                                {handle.charAt(0)}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white flex items-center gap-1">
                                                    {handle}
                                                    <span className="text-[10px] text-slate-500 font-mono font-normal">{suffix}</span>
                                                </h4>
                                                <p className="text-xs text-slate-500">ID: {req.fromUserId.substring(0, 10)}...</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => onAcceptRequest(req)}
                                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                                            >
                                                <UserCheck size={16} /> Accept
                                            </button>
                                            <button
                                                onClick={() => onDeclineRequest(req.id)}
                                                className="bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 px-3 py-1.5 rounded-lg text-sm transition-colors"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            }

            {/* Contacts List */}
            <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {contacts.length === 0 && requests.length === 0 && (
                        <div className="col-span-2 text-center py-10 text-slate-500 border border-dashed border-slate-800 rounded-xl">
                            <UserPlus size={48} className="mx-auto mb-2 opacity-50" />
                            <p>No contacts yet. Add a friend to start chatting.</p>
                        </div>
                    )}
                    {contacts.map(contact => {
                        const { handle, suffix } = formatUserIdentity(contact.username || contact.displayName);
                        return (
                            <div
                                key={contact.id}
                                className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between group cursor-pointer hover:border-slate-700 transition-colors"
                                onClick={() => setUserInfoTarget({
                                    id: contact.id,
                                    displayName: contact.displayName,
                                    username: contact.username,
                                    avatarUrl: contact.avatarUrl,
                                    homeNode: contact.homeNodes[0]
                                })}
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="relative">
                                        {contact.avatarUrl ? (
                                            <img src={contact.avatarUrl} alt={contact.displayName} className="w-10 h-10 rounded-full bg-slate-800 object-cover border border-slate-700" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 shrink-0 border border-slate-700">
                                                {handle.charAt(0)}
                                            </div>
                                        )}
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${contact.status === 'online' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="font-bold text-white truncate group-hover:text-onion-400 transition-colors flex items-center gap-1">
                                            {handle}
                                            <span className="text-[10px] text-slate-500 font-mono font-normal">{suffix}</span>
                                        </h4>
                                        <div className="flex items-center gap-1 text-xs text-slate-500">
                                            <MapPin size={10} />
                                            <span className="truncate">{contact.homeNodes[0]}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(contact); }}
                                    className="text-slate-600 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition-colors"
                                    title="Remove Contact"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* User Info Modal */}
            {
                userInfoTarget && (
                    <UserInfoModal
                        target={userInfoTarget}
                        currentUser={currentUser}
                        isContact={true}
                        isFollowing={currentUser.followingIds?.includes(userInfoTarget.id) || false}
                        onClose={() => setUserInfoTarget(null)}
                        onConnect={() => { }}
                        onFollow={onFollowUser}
                        onUnfollow={onUnfollowUser}
                        onMessage={(cid) => {
                            onNavigateToChat(cid);
                            setUserInfoTarget(null);
                        }}
                        onViewPosts={(uid) => {
                            onViewUserPosts(uid);
                            setUserInfoTarget(null);
                        }}
                        posts={posts}
                    />
                )
            }

            {/* Add Contact Modal and Scanner */}
            {
                showAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
                            <h3 className="text-xl font-bold text-white mb-4">Add New Contact</h3>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <button onClick={() => { setShowAddModal(false); setShowScanner(true); }} className="bg-slate-800 hover:bg-slate-700 text-white p-3 rounded-lg flex flex-col items-center gap-2 transition-colors border border-slate-700">
                                    <Camera size={24} className="text-onion-500" />
                                    <span className="text-xs font-bold">Scan QR</span>
                                </button>
                                <button onClick={() => fileInputRef.current?.click()} className="bg-slate-800 hover:bg-slate-700 text-white p-3 rounded-lg flex flex-col items-center gap-2 transition-colors border border-slate-700">
                                    <Upload size={24} className="text-blue-500" />
                                    <span className="text-xs font-bold">Upload QR Image</span>
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                                </button>
                            </div>
                            <div className="space-y-3">
                                <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-onion-500 outline-none transition-colors" placeholder="Display Name (Handle)" value={newName} onChange={e => setNewName(e.target.value)} />
                                <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white font-mono text-xs focus:border-onion-500 outline-none transition-colors" placeholder="User Public Key (Ed25519)" value={newPubKey} onChange={e => setNewPubKey(e.target.value)} />
                                <input className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white font-mono text-xs focus:border-onion-500 outline-none transition-colors" placeholder="Home Node Address (.onion)" value={newHomeNode} onChange={e => setNewHomeNode(e.target.value)} />
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
                                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancel</button>
                                <button onClick={handleSubmit} className="px-6 py-2 bg-onion-600 rounded-lg text-white font-bold hover:bg-onion-500 transition-colors shadow-lg shadow-onion-900/20">Save Contact</button>
                            </div>
                        </div>
                    </div>
                )
            }


            {showIdentityModal && <IdentityModal type="user" data={{ id: currentUser.id, name: currentUser.displayName, nodeAddress: currentUser.homeNodeOnion }} onClose={() => setShowIdentityModal(false)} />}
            {showScanner && <QRScanner onScan={(data) => parseDeepLink(data)} onClose={() => setShowScanner(false)} />}

            {
                nodeInfoTarget && (
                    <NodeInfoModal
                        target={nodeInfoTarget}
                        onClose={() => setNodeInfoTarget(null)}
                        onConnect={(addr) => addToast("Connecting", `Initiating connection to ${addr}...`, 'info')}
                        onBlock={(addr) => addToast("Blocked", `Node ${addr} blocked.`, 'warning')}
                    />
                )
            }

        </div >
    );
};

export default Contacts;
