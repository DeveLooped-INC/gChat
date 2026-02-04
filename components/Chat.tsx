import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Contact, Message, UserProfile, ToastMessage, Group, AppRoute, NotificationCategory, MediaMetadata, Post } from '../types';
import { Search, Send, Lock, ShieldCheck, MoreVertical, Paperclip, MessageSquare, Check, CheckCheck, Clock, WifiOff, Trash2, Ban, Bomb, EyeOff, X, Users, Plus, CheckSquare, Settings, UserMinus, UserPlus, Bell, BellOff, Edit2, Mic, Video, Camera as CameraIcon, Smile, ThumbsUp, ThumbsDown, CornerDownRight, Globe, UserCheck, Quote } from 'lucide-react';
import { fileToBase64, formatBytes, getTransferConfig, SOCIAL_REACTIONS, DM_REACTIONS, formatUserIdentity } from '../utils';
import { MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENT_SIZE_MB, MAX_CHAT_MEDIA_DURATION } from '../constants';
import GroupSettingsModal from './GroupSettingsModal';
import { MediaRecorder, MediaPlayer } from './MediaComponents';
import { saveMedia } from '../services/mediaStorage';
import CameraModal from './CameraModal';
import UserInfoModal, { UserInfoTarget } from './UserInfoModal';

interface ChatProps {
  contacts: Contact[];
  groups: Group[];
  messages: Message[];
  activeChatId: string | null;
  onSendMessage: (text: string, contactId: string, isEphemeral: boolean, attachment?: string, media?: MediaMetadata, replyToId?: string, privacy?: 'public' | 'connections') => void;
  onSendTyping: (contactId: string) => void;
  onReadMessage: (contactId: string) => void;
  onClearHistory: (contactId: string) => void;
  onReactMessage: (contactId: string, messageId: string, emoji: string) => void;
  onVoteMessage: (contactId: string, messageId: string, type: 'up' | 'down') => void;
  onCreateGroup: (name: string, memberIds: string[]) => void;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroup: (group: Group) => void;
  onAddMemberToGroup: (groupId: string, contactId: string) => void;
  onToggleGroupMute: (groupId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  typingContactId: string | null;
  addToast: (title: string, message: string, type: ToastMessage['type'], category?: NotificationCategory) => void;
  isOnline: boolean;
  user: UserProfile;
  onFollowUser: (id: string, node?: string) => void;
  onUnfollowUser: (id: string, node?: string) => void;
  onViewUserPosts: (userId: string) => void;
  posts: Post[];
}

const Chat: React.FC<ChatProps> = ({
  contacts,
  groups = [],
  messages,
  activeChatId,
  onSendMessage,
  onSendTyping,
  onReadMessage,
  onClearHistory,
  onReactMessage,
  onVoteMessage,
  onCreateGroup,
  onDeleteGroup,
  onUpdateGroup,
  onAddMemberToGroup,
  onToggleGroupMute,
  onLeaveGroup,
  typingContactId,
  addToast,
  isOnline,
  user,
  onFollowUser,
  onUnfollowUser,
  onViewUserPosts,
  posts
}) => {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(activeChatId || null);
  const [inputText, setInputText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [isEphemeralMode, setIsEphemeralMode] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [activeReactionId, setActiveReactionId] = useState<string | null>(null);

  // New States for Social Features
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  // Default privacy is now 'connections' (Friends Only)
  const [messagePrivacy, setMessagePrivacy] = useState<'public' | 'connections'>('connections');

  // Media Recording State
  const [recordingMode, setRecordingMode] = useState<'audio' | 'video' | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Group Creation State
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  // Group Settings State - ID reference to prevent stale objects
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // User Info Modal
  const [userInfoTarget, setUserInfoTarget] = useState<UserInfoTarget | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef<number>(0);

  useEffect(() => {
    if (activeChatId) {
      setSelectedChatId(activeChatId);
    }
  }, [activeChatId]);

  const activeContact = contacts.find(c => c.id === selectedChatId);
  const activeGroup = (groups || []).find(g => g.id === selectedChatId);

  // Derive the group object for the modal to ensure it reacts to updates (like Mute toggles)
  const currentEditingGroup = useMemo(() => {
    if (!editingGroupId) return null;
    return groups.find(g => g.id === editingGroupId) || null;
  }, [groups, editingGroupId]);

  // Determine which reaction set to use
  const availableReactions = activeGroup ? SOCIAL_REACTIONS : DM_REACTIONS;

  const isTyping = activeContact?.id === typingContactId;

  const threadMessages = useMemo(() => {
    return messages
      .filter(m => m.threadId === selectedChatId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, selectedChatId]);

  const unreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    messages.forEach(m => {
      if (!m.isMine && !m.read) {
        counts[m.threadId] = (counts[m.threadId] || 0) + 1;
      }
    });
    return counts;
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threadMessages, isTyping, isEphemeralMode, attachment, recordingMode, replyingToMessage]);

  // READ STATUS EFFECT
  useEffect(() => {
    const hasUnread = threadMessages.some(m => !m.isMine && !m.read);
    if (selectedChatId && hasUnread) {
      onReadMessage(selectedChatId);
    }
  }, [selectedChatId, threadMessages, onReadMessage]);

  useEffect(() => {
    setIsEphemeralMode(false);
    setAttachment(null);
    setEditingGroupId(null);
    setRecordingMode(null);
    setActiveReactionId(null);
    setReplyingToMessage(null);
    setMessagePrivacy('connections'); // Reset to default on chat change
  }, [selectedChatId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000 && activeContact && !activeGroup) {
      onSendTyping(activeContact.id);
      lastTypingSentRef.current = now;
    }
  };

  const handleSend = () => {
    if ((!inputText.trim() && !attachment) || (!activeContact && !activeGroup)) return;
    if (selectedChatId) {
      onSendMessage(
        inputText,
        selectedChatId,
        isEphemeralMode,
        attachment || undefined,
        undefined,
        replyingToMessage?.id,
        messagePrivacy
      );
      setInputText('');
      setAttachment(null);
      setReplyingToMessage(null);
    }
  };

  const handleMediaCapture = async (blob: Blob, previewUrl: string, duration: number) => {
    if (selectedChatId) {
      const mediaId = crypto.randomUUID();
      const accessKey = crypto.randomUUID();
      await saveMedia(mediaId, blob, accessKey);
      const metadata: MediaMetadata = {
        id: mediaId,
        type: recordingMode!,
        mimeType: blob.type,
        size: blob.size,
        duration: duration,
        chunkCount: Math.ceil(blob.size / getTransferConfig(blob.size).chunkSize),
        thumbnail: undefined,
        accessKey
      };
      onSendMessage("", selectedChatId, isEphemeralMode, undefined, metadata, replyingToMessage?.id, messagePrivacy);
      setRecordingMode(null);
      setReplyingToMessage(null);
    }
  };

  const handleCameraCapture = (base64: string) => { setAttachment(base64); };
  const handleKeyPress = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const handleOptionClick = (action: 'clear' | 'ephemeral' | 'group-settings') => {
    if (action === 'clear' && selectedChatId) { if (window.confirm('Delete all messages?')) onClearHistory(selectedChatId); }
    else if (action === 'ephemeral') setIsEphemeralMode(!isEphemeralMode);
    else if (action === 'group-settings' && activeGroup) setEditingGroupId(activeGroup.id);
    setShowMenu(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && selectedChatId) {
      const file = e.target.files[0];

      // Safety Check: Block executables
      const unsafeExtensions = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.jar', '.scr', '.com', '.pif'];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (unsafeExtensions.includes(ext)) {
        addToast('Blocked', 'Executable files are not allowed for security reasons.', 'error', 'admin');
        return;
      }

      const isImage = file.type.startsWith('image/');

      if (isImage && file.size <= MAX_ATTACHMENT_SIZE_BYTES) {
        try { const base64 = await fileToBase64(file); setAttachment(base64); } catch (err) { addToast('Error', 'Failed to process attachment.', 'error'); }
        return;
      }

      try {
        const mediaId = crypto.randomUUID();
        const accessKey = crypto.randomUUID();
        const blob = new Blob([file], { type: file.type || 'application/octet-stream' });
        await saveMedia(mediaId, blob, accessKey);

        const type = file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'file');

        const metadata: MediaMetadata = {
          id: mediaId,
          type,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          duration: 0,
          chunkCount: Math.ceil(file.size / getTransferConfig(file.size).chunkSize),
          accessKey,
          filename: file.name
        };

        onSendMessage("", selectedChatId, isEphemeralMode, undefined, metadata, replyingToMessage?.id, messagePrivacy);
        setReplyingToMessage(null);
      } catch (err) {
        console.error(err);
        addToast('Error', 'Failed to prepare file.', 'error');
      }
    }
  };

  const handleAttachClick = () => fileInputRef.current?.click();
  const toggleMemberSelection = (contactId: string) => { const next = new Set(selectedMembers); if (next.has(contactId)) next.delete(contactId); else next.add(contactId); setSelectedMembers(next); };
  const submitCreateGroup = () => {
    if (!newGroupName.trim()) { addToast("Error", "Group Name required", 'error', 'admin'); return; }
    if (selectedMembers.size === 0) { addToast("Error", "Select at least 1 member", 'error', 'admin'); return; }
    onCreateGroup(newGroupName, Array.from(selectedMembers)); setShowGroupModal(false); setNewGroupName(''); setSelectedMembers(new Set());
  };
  const handleKickMember = (contactId: string) => { if (!currentEditingGroup) return; if (confirm("Remove member?")) { const updated = { ...currentEditingGroup, members: currentEditingGroup.members.filter(m => m !== contactId) }; onUpdateGroup(updated); } };
  const handleBanMember = (contactId: string) => { if (!currentEditingGroup) return; if (confirm("Ban member?")) { const updated = { ...currentEditingGroup, members: currentEditingGroup.members.filter(m => m !== contactId), bannedIds: [...(currentEditingGroup.bannedIds || []), contactId] }; onUpdateGroup(updated); } };

  const getFormattedName = (senderId: string) => {
    if (senderId === 'me' || senderId === user.id) return { handle: 'Me', suffix: null };
    const contact = contacts.find(c => c.id === senderId);
    if (!contact) return { handle: 'Unknown', suffix: null };
    return formatUserIdentity(contact.username || contact.displayName);
  };

  const getPeerOnion = (senderId: string) => { const contact = contacts.find(c => c.id === senderId); return contact?.homeNodes[0]; };
  const toggleReactionMenu = (msgId: string) => { setActiveReactionId(activeReactionId === msgId ? null : msgId); };

  const openUserInfo = (senderId: string) => {
    if (senderId === user.id) return; // Don't open for self in chat context usually
    const contact = contacts.find(c => c.id === senderId);
    setUserInfoTarget({
      id: senderId,
      displayName: contact ? contact.displayName : 'Unknown',
      avatarUrl: contact?.avatarUrl,
      username: contact?.username,
      homeNode: contact?.homeNodes[0]
    });
  };

  // Chat Header Name formatting
  const headerName = useMemo(() => {
    if (activeGroup) return { handle: activeGroup.name, suffix: null };
    if (activeContact) return formatUserIdentity(activeContact.username || activeContact.displayName);
    return { handle: 'Select Chat', suffix: null };
  }, [activeGroup, activeContact]);

  return (
    <div className="flex h-full w-full bg-slate-950 relative overflow-hidden">

      {/* Sidebar */}
      <div className={`w-full md:w-80 border-r border-slate-800 bg-slate-900 flex flex-col ${selectedChatId ? 'hidden md:flex' : 'flex'} `}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center flex-none">
          <h2 className="text-xl font-bold text-white">Messages</h2>
          <button onClick={() => setShowGroupModal(true)} className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-full" title="New Group"><Plus size={20} /></button>
        </div>
        <div className="p-3 bg-slate-900 flex-none">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
            <input type="text" placeholder="Search..." className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-4 text-slate-200 text-xs focus:outline-none focus:border-onion-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups && groups.length > 0 && <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">Groups</div>}
          {(groups || []).map(group => (
            <div key={group.id} onClick={() => setSelectedChatId(group.id)} className={`p-4 hover:bg-slate-800 cursor-pointer transition-colors border-l-4 ${selectedChatId === group.id ? 'bg-slate-800 border-indigo-500' : 'border-transparent'} `}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-900/50 text-indigo-400 flex items-center justify-center border border-indigo-500/30">{group.isMuted ? <BellOff size={18} /> : <Users size={18} />}</div>
                  <div><h3 className="font-medium text-slate-200">{group.name}</h3><p className="text-xs text-slate-500">{group.members.length} members</p></div>
                </div>
                {unreadCounts[group.id] > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{unreadCounts[group.id]}</span>}
              </div></div>
          ))}
          <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase mt-2">Peers</div>
          {contacts.map(contact => {
            const { handle, suffix } = formatUserIdentity(contact.username || contact.displayName);
            return (
              <div key={contact.id} onClick={() => setSelectedChatId(contact.id)} className={`p-4 hover:bg-slate-800 cursor-pointer transition-colors border-l-4 ${selectedChatId === contact.id ? 'bg-slate-800 border-onion-500' : 'border-transparent'} `}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      {contact.avatarUrl ? (
                        <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden border border-slate-600">
                          <img src={contact.avatarUrl} alt={handle} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-white font-bold">{handle.charAt(0)}</div>
                      )}
                      <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${contact.status === 'online' ? 'bg-emerald-500' : 'bg-slate-500'} `} />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-200 flex items-center gap-1">
                        {handle}
                        <span className="text-slate-500 text-[10px] font-mono">{suffix}</span>
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center"><Lock size={10} className="mr-1" /> {contact.connectionType}</p>
                    </div>
                  </div>
                  {unreadCounts[contact.id] > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full self-center">{unreadCounts[contact.id]}</span>}
                </div></div>
            )
          })}
        </div>
      </div>

      {/* Main Chat Area */}
      {selectedChatId ? (
        <div className={`flex-1 flex flex-col h-full ${!selectedChatId ? 'hidden md:flex' : 'flex'} `}>
          {/* Header */}
          <div className={`h-16 flex-none border-b flex items-center justify-between px-6 relative z-20 transition-colors duration-300 ${isEphemeralMode ? 'bg-amber-950/30 border-amber-900/50' : 'bg-slate-900/50 border-slate-800'} `}>
            <div className="flex items-center space-x-3">
              <button className="md:hidden text-slate-400 mr-2" onClick={() => setSelectedChatId(null)}>←</button>
              {activeGroup ? (
                <div className="w-8 h-8 rounded-full bg-indigo-900/50 text-indigo-400 flex items-center justify-center border border-indigo-500/30">{activeGroup.isMuted ? <BellOff size={16} /> : <Users size={16} />}</div>
              ) : (
                <div onClick={() => openUserInfo(activeContact?.id || '')} className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-sm font-bold cursor-pointer hover:bg-slate-600 overflow-hidden border border-slate-600">
                  {activeContact?.avatarUrl ? (
                    <img src={activeContact.avatarUrl} className="w-full h-full object-cover" />
                  ) : (
                    activeContact?.displayName.charAt(0)
                  )}
                </div>
              )}
              <div>
                <h3 onClick={() => { if (!activeGroup) openUserInfo(activeContact?.id || ''); }} className={`font-bold text-slate-100 flex items-center gap-2 ${!activeGroup ? 'cursor-pointer hover:underline' : ''} `}>
                  {headerName.handle}
                  {headerName.suffix && <span className="text-slate-500 font-mono text-xs opacity-70">{headerName.suffix}</span>}
                  {isEphemeralMode && <Bomb size={14} className="text-amber-500" />}
                </h3>
                <div className="flex items-center space-x-2 text-xs">
                  {isEphemeralMode ? <span className="text-amber-500 font-mono">Disappearing Messages ON</span> :
                    <><span className="text-emerald-400 flex items-center"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5" />E2E Encrypted</span>
                      {activeContact && <><span className="text-slate-600">|</span><span className="text-onion-400 font-mono">Route: {activeContact.connectionType} ({activeContact.latencyMs}ms)</span></>}
                      {activeGroup && <><span className="text-slate-600">|</span><span className="text-indigo-400 font-mono">{activeGroup.members.length} Members</span></>}
                    </>
                  }
                </div>
              </div >
            </div >
            {/* Options Menu */}
            < div className="flex items-center space-x-3 text-slate-400 relative" >
              <ShieldCheck size={20} className={isEphemeralMode ? "text-amber-500" : "text-emerald-500"} />
              <button onClick={() => setShowMenu(!showMenu)} className="p-1 hover:text-white transition-colors focus:outline-none"><MoreVertical size={20} /></button>
              {
                showMenu && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 z-50">
                    {!activeGroup && <button onClick={() => handleOptionClick('ephemeral')} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center space-x-2">{isEphemeralMode ? <EyeOff size={16} className="text-amber-500" /> : <Bomb size={16} />}<span>{isEphemeralMode ? 'Disable Disappearing' : 'Enable Disappearing'}</span></button>}
                    {activeGroup && <button onClick={() => handleOptionClick('group-settings')} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center space-x-2"><Settings size={16} /><span>Group Settings</span></button>}
                    <button onClick={() => handleOptionClick('clear')} className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-slate-800 hover:text-red-300 transition-colors flex items-center space-x-2 border-t border-slate-800"><Trash2 size={16} /><span>Clear History</span></button>
                  </div>
                )
              }
            </div >
            {showMenu && <div className="fixed inset-0 z-[-1]" onClick={() => setShowMenu(false)} />}
          </div >

          {/* Messages Area */}
          < div className="flex-1 overflow-y-auto p-6 space-y-4" >
            {
              threadMessages.length === 0 && (
                <div className="text-center text-slate-500 mt-10"><Lock size={48} className="mx-auto mb-4 text-onion-500 opacity-50" /><p>No messages yet.</p><p className="text-sm">Start a secure, encrypted conversation.</p></div>
              )
            }
            {
              threadMessages.map((msg) => {
                const msgContact = contacts.find(c => c.id === msg.senderId);
                const isReactionMenuOpen = activeReactionId === msg.id;
                const replyMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
                const upVotes = Object.values(msg.votes || {}).filter(v => v === 'up').length;
                const downVotes = Object.values(msg.votes || {}).filter(v => v === 'down').length;
                const myVote = (msg.votes || {})[user.id];

                const senderName = getFormattedName(msg.senderId);
                const replySenderName = replyMsg ? getFormattedName(replyMsg.senderId).handle : '';

                return (
                  <div id={`msg-${msg.id}`} key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300 group`}>
                    <div className="flex items-end gap-2 max-w-[85%] md:max-w-md">
                      {!msg.isMine && (
                        <div onClick={() => openUserInfo(msg.senderId)} className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0 cursor-pointer hover:bg-slate-700 transition-colors mb-1 overflow-hidden border border-slate-700">
                          {msgContact?.avatarUrl ? (
                            <img src={msgContact.avatarUrl} className="w-full h-full object-cover" />
                          ) : (
                            msgContact ? msgContact.displayName.charAt(0) : '?'
                          )}
                        </div>
                      )}
                      <div className={`relative flex flex-col ${msg.isMine ? 'items-end' : 'items-start'} flex-1 min-w-0`}>
                        {activeGroup && !msg.isMine && (
                          <span onClick={() => openUserInfo(msg.senderId)} className="text-[10px] text-slate-500 mb-1 ml-1 font-bold cursor-pointer hover:underline flex items-center gap-1">
                            {senderName.handle} <span className="opacity-70 font-mono font-normal">{senderName.suffix}</span>
                          </span>
                        )}

                        {/* Message Bubble */}
                        <div className={`p-4 rounded-2xl shadow-sm relative w-full ${msg.isMine ? 'bg-onion-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none'} ${msg.isEphemeral ? 'border-2 border-dashed border-amber-500/50' : ''}`}>

                          {/* Reply Context */}
                          {replyMsg && (
                            <div className="mb-2 p-2 rounded bg-black/20 border-l-2 border-white/50 text-xs flex flex-col cursor-pointer" onClick={() => {
                              const el = document.getElementById(`msg-${replyMsg.id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}>
                              <span className="font-bold opacity-75">{replySenderName}</span>
                              <span className="truncate opacity-60">{replyMsg.content || 'Media'}</span>
                            </div>
                          )}

                          {/* Media Display */}
                          {msg.media && (
                            <div className="mb-2 w-full">
                              <MediaPlayer media={msg.media} peerId={getPeerOnion(msg.senderId)} onNotification={addToast} />
                            </div>
                          )}
                          {msg.attachmentUrl && (
                            <div className="mb-2 rounded-lg overflow-hidden border border-slate-700/50">
                              <img src={msg.attachmentUrl} alt="attachment" className="w-full h-auto object-cover" />
                            </div>
                          )}

                          {/* Message Content */}
                          {msg.content && <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>}

                          {/* Footer (Reactions + Timestamp) */}
                          <div className={`flex flex-wrap items-center gap-2 mt-2 text-[10px] ${msg.isMine ? 'text-onion-100' : 'text-slate-400'}`}>
                            <span className="opacity-70">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {msg.isMine && (
                              <span className="opacity-70">
                                {msg.read ? <CheckCheck size={14} /> : msg.delivered ? <Check size={14} /> : <Clock size={14} />}
                              </span>
                            )}
                            {/* Reactions Display */}
                            {msg.reactions && Object.entries(msg.reactions).map(([emoji, users]) => (
                              users.length > 0 && (
                                <span key={emoji} className="bg-black/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 border border-white/10">
                                  {emoji} {users.length}
                                </span>
                              )
                            ))}
                            {/* Vote Display */}
                            {(upVotes > 0 || downVotes > 0) && (
                              <div className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded-full border border-white/10">
                                {upVotes > 0 && <span className="text-emerald-300 flex items-center gap-0.5"><ThumbsUp size={10} /> {upVotes}</span>}
                                {downVotes > 0 && <span className="text-red-300 flex items-center gap-0.5"><ThumbsDown size={10} /> {downVotes}</span>}
                              </div>
                            )}
                          </div>

                          {/* Actions Overlay (Hover) */}
                          <div className={`absolute top-0 ${msg.isMine ? '-left-20' : '-right-20'} h-full flex items-center gap-2 transition-opacity px-2 ${isReactionMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <button onClick={() => setReplyingToMessage(msg)} className="p-1.5 bg-slate-700/50 hover:bg-slate-700 rounded-full text-slate-300 hover:text-white transition-colors" title="Reply">
                              <CornerDownRight size={14} />
                            </button>
                            <div className="relative">
                              <button onClick={() => toggleReactionMenu(msg.id)} className="p-1.5 bg-slate-700/50 hover:bg-slate-700 rounded-full text-slate-300 hover:text-white transition-colors" title="React">
                                <Smile size={14} />
                              </button>
                              {/* Reaction Picker Popup */}
                              {isReactionMenuOpen && (
                                <div className={`absolute bottom-full mb-2 ${msg.isMine ? 'right-0' : 'left-0'} bg-slate-900 border border-slate-700 rounded-full shadow-xl flex p-1 z-50 gap-1 animate-in zoom-in-95`}>
                                  {availableReactions.map(emoji => (
                                    <button key={emoji} onClick={() => { onReactMessage(selectedChatId!, msg.id, emoji); setActiveReactionId(null); }} className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full text-lg transition-transform hover:scale-125">
                                      {emoji}
                                    </button>
                                  ))}
                                  <div className="w-px h-6 bg-slate-700 mx-1 self-center" />
                                  <button onClick={() => { onVoteMessage(selectedChatId!, msg.id, 'up'); setActiveReactionId(null); }} className={`w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full transition-colors ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-400'}`}><ThumbsUp size={16} /></button>
                                  <button onClick={() => { onVoteMessage(selectedChatId!, msg.id, 'down'); setActiveReactionId(null); }} className={`w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full transition-colors ${myVote === 'down' ? 'text-red-400' : 'text-slate-400'}`}><ThumbsDown size={16} /></button>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            }

            {/* This block was added based on the instruction, assuming `showAttach` is a new state variable */}
            {/* {showAttach && (
                <div className="absolute bottom-16 left-4 bg-slate-800 border border-slate-700 rounded-lg p-2 shadow-xl animate-in fade-in slide-in-from-bottom-2">
                    <button className="flex items-center gap-2 p-2 hover:bg-slate-700 rounded-md w-full text-slate-200 text-sm mb-1" onClick={() => addToast('Hint', 'Use Add Contact in Contacts tab', 'info', 'admin')}>
                        <UserPlus size={16} /> Share Contact
                    </button>
                </div>
            )} */}
            {
              isTyping && (
                <div className="flex items-center gap-2 ml-4 mb-2 animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center">
                    <span className="animate-pulse text-onion-400 tracking-widest text-lg leading-none pb-2">...</span>
                  </div>
                  <span className="text-xs text-slate-500 italic">Typing...</span>
                </div>
              )
            }

            <div ref={messagesEndRef} />
          </div >

          {/* Input Area */}
          < div className="p-3 bg-slate-900 border-t border-slate-800 flex-none flex flex-col gap-3" >
            {
              recordingMode ? (
                <MediaRecorder type={recordingMode} maxDuration={MAX_CHAT_MEDIA_DURATION} onCapture={handleMediaCapture} onCancel={() => setRecordingMode(null)} />
              ) : (
                <>
                  {attachment && (<div className="flex items-center space-x-2 bg-slate-800 p-2 rounded-lg w-fit"><div className="w-10 h-10 rounded bg-slate-700 overflow-hidden"><img src={attachment} className="w-full h-full object-cover" alt="preview" /></div><span className="text-xs text-slate-300">Image attached</span><button onClick={() => setAttachment(null)} className="text-slate-500 hover:text-white"><X size={14} /></button></div>)}
                  {replyingToMessage && (<div className="flex items-center justify-between bg-slate-800/50 border-l-4 border-onion-500 rounded p-2 text-xs text-slate-300"><div className="flex flex-col"><span className="font-bold text-onion-400">Replying to {getFormattedName(replyingToMessage.senderId).handle}</span><span className="truncate opacity-70 max-w-[200px]">{replyingToMessage.content || 'Media attachment'}</span></div><button onClick={() => setReplyingToMessage(null)} className="text-slate-500 hover:text-white"><X size={16} /></button></div>)}
                  <div className="relative w-full">
                    <textarea value={inputText} onChange={handleInputChange} onKeyDown={handleKeyPress} placeholder={isEphemeralMode ? "Send disappearing message..." : "Type a secure message..."} rows={1} className={`w-full bg-slate-950 border ${isEphemeralMode ? 'border-amber-900 focus:border-amber-500' : 'border-slate-800 focus:border-onion-500'} rounded-xl px-4 py-3 text-slate-200 focus:outline-none transition-colors min-h-[50px] max-h-[120px] resize-none pr-10`} style={{ minHeight: '50px', height: 'auto' }} />
                    {isEphemeralMode && <Bomb size={16} className="absolute right-3 top-4 text-amber-500" />}
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex space-x-1 items-center">
                      <button onClick={() => setRecordingMode('audio')} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full" title="Record Audio"><Mic size={20} /></button>
                      <button onClick={() => setRecordingMode('video')} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full" title="Record Video"><Video size={20} /></button>
                      <button onClick={() => setShowCamera(true)} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full" title="Camera"><CameraIcon size={20} /></button>
                      <button onClick={handleAttachClick} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full" title="Attach File"><Paperclip size={20} /></button>
                      {activeGroup && <div className="h-6 w-px bg-slate-800 mx-1"></div>}
                      {activeGroup && <button onClick={() => !replyingToMessage && setMessagePrivacy(prev => prev === 'public' ? 'connections' : 'public')} disabled={!!replyingToMessage} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors ml-1 ${messagePrivacy === 'public' ? 'bg-slate-800 text-slate-300 hover:text-white' : 'bg-onion-900/50 text-onion-300 border border-onion-500/30'} ${!!replyingToMessage ? 'opacity-50 cursor-not-allowed' : ''}`} title={replyingToMessage ? "Privacy locked to parent message" : (messagePrivacy === 'public' ? "Visible to Group" : "Visible only to Friends in Group")}>{messagePrivacy === 'public' ? <Globe size={12} /> : <UserCheck size={12} />}<span>{messagePrivacy === 'public' ? 'Everyone' : 'Friends Only'}</span>{replyingToMessage && <Lock size={10} className="ml-1" />}</button>}
                      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                    </div>
                    <button onClick={handleSend} disabled={!inputText.trim() && !attachment} className={`p-3 rounded-full transition-all ${(inputText.trim() || attachment) ? 'bg-onion-600 hover:bg-onion-500 text-white shadow-lg shadow-onion-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}><Send size={20} /></button>
                  </div>
                </>
              )}
          </div >
        </div >
      ) : (
        /* Empty State */
        <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-slate-950 text-slate-500">
          <div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-6 shadow-inner"><MessageSquare size={48} className="text-onion-500 opacity-50" /></div>
          <h2 className="text-xl font-bold text-slate-300">Select a Secure Chat</h2>
          <p className="max-w-xs text-center mt-2 text-sm">Choose a trusted peer from the sidebar to start an end-to-end encrypted conversation.</p>
          <div className="mt-8 flex items-center space-x-2 text-xs bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800"><Lock size={12} className="text-emerald-500" /><span>Your messages are onion-routed and private</span></div>
        </div>
      )}

      {
        showGroupModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl m-4">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center"><h3 className="font-bold text-white">New Encrypted Group</h3><button onClick={() => setShowGroupModal(false)}><X className="text-slate-400 hover:text-white" /></button></div>
              <div className="p-6 space-y-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase">Group Name</label><input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 mt-1 text-white focus:border-onion-500 focus:outline-none" placeholder="e.g. Project Alpha" /></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Select Members</label><div className="max-h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800">{contacts.map(contact => (<div key={contact.id} onClick={() => toggleMemberSelection(contact.id)} className="p-3 flex items-center justify-between hover:bg-slate-900 cursor-pointer"><div className="flex items-center space-x-3"><div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">{contact.displayName.charAt(0)}</div><span className="text-sm text-slate-300">{contact.displayName}</span></div>{selectedMembers.has(contact.id) ? (<CheckSquare size={18} className="text-onion-500" />) : (<div className="w-4 h-4 border border-slate-600 rounded" />)}</div>))}{contacts.length === 0 && (<div className="p-4 text-center text-xs text-slate-500">No contacts available.</div>)}</div></div>
                <button onClick={submitCreateGroup} className="w-full bg-onion-600 hover:bg-onion-500 text-white py-3 rounded-xl font-bold transition-colors shadow-lg shadow-onion-900/20">Create Group</button>
              </div>
            </div>
          </div>
        )
      }

      {
        currentEditingGroup && (
          <GroupSettingsModal
            group={currentEditingGroup}
            contacts={contacts}
            currentUser={user}
            onClose={() => setEditingGroupId(null)}
            onUpdateGroup={onUpdateGroup}
            onToggleMute={onToggleGroupMute}
            onLeaveGroup={(id) => { onLeaveGroup(id); setSelectedChatId(null); }}
            onDeleteGroup={(id) => { onDeleteGroup(id); setSelectedChatId(null); }}
            onAddMember={onAddMemberToGroup}
            onKickMember={handleKickMember}
            onBanMember={handleBanMember}
          />
        )
      }

      <CameraModal isOpen={showCamera} onClose={() => setShowCamera(false)} onCapture={handleCameraCapture} />

      {/* User Info Modal */}
      {
        userInfoTarget && (
          <UserInfoModal
            target={userInfoTarget}
            currentUser={user}
            isContact={contacts.some(c => c.id === userInfoTarget.id)}
            isFollowing={user.followingIds?.includes(userInfoTarget.id) || false}
            onClose={() => setUserInfoTarget(null)}
            onConnect={() => { addToast('Hint', 'Use Add Contact in Contacts tab', 'info'); setUserInfoTarget(null); }}
            onFollow={onFollowUser}
            onUnfollow={onUnfollowUser}
            onMessage={(cid) => { setSelectedChatId(cid); setUserInfoTarget(null); }}
            onViewPosts={(uid) => { onViewUserPosts(uid); setUserInfoTarget(null); }}
            posts={posts}
          />
        )
      }

    </div >
  );
};

export default Chat;
