
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Post, UserProfile, ToastMessage, Contact, MediaMetadata, Comment } from '../types';
import { MessageCircle, Share2, Shield, Wifi, Globe, MoreHorizontal, ShieldCheck, Loader2, Lock, Cpu, Send, WifiOff, Image as ImageIcon, X, Users, Repeat, User, ThumbsDown, Camera as CameraIcon, Eye, Trash2, Edit2, Save, XCircle, Mic, Video, FileText, Radio, MapPin, Filter, Search, TrendingUp, Hash, ChevronDown, Clock, Smile, ThumbsUp, CornerDownRight, AlertTriangle, Archive, FileArchive, Link2Off, Quote, RefreshCw, ArrowLeft, Play, ExternalLink, Ban } from 'lucide-react';
import { fileToBase64, getTransferConfig, SOCIAL_REACTIONS, formatUserIdentity } from '../utils';
import { MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENT_SIZE_MB, MAX_POST_MEDIA_DURATION } from '../constants';
import { signData, verifySignature } from '../services/cryptoService';
import CameraModal from './CameraModal';
import { MediaRecorder, MediaPlayer } from './MediaComponents';
import { saveMedia } from '../services/mediaStorage';
import UserInfoModal, { UserInfoTarget } from './UserInfoModal';

interface FeedProps {
  posts: Post[];
  contacts: Contact[];
  onPost: (post: Post) => void;
  onLike: (postId: string) => void;
  onDislike: (postId: string) => void;
  onComment: (postId: string, content: string, parentCommentId?: string) => void;
  onCommentVote: (postId: string, commentId: string, type: 'up' | 'down') => void;
  onCommentReaction: (postId: string, commentId: string, emoji: string) => void;
  onPostReaction: (postId: string, emoji: string) => void;
  onShare: (postId: string) => void;
  onNavigateToChat: (contactId: string) => void;
  onDeletePost: (postId: string) => void;
  onEditPost: (postId: string, newContent: string) => void;
  onSavePost?: (postId: string) => void; 
  onGlobalSync?: () => void;
  onFollowUser: (id: string, node?: string) => void;
  onUnfollowUser: (id: string, node?: string) => void;
  onConnectUser: (target: UserInfoTarget) => void;
  onViewUserPosts: (userId: string) => void;
  user: UserProfile;
  addToast: (title: string, message: string, type: ToastMessage['type']) => void;
  isOnline: boolean;
  initialState?: { filter: 'public' | 'friends'; authorId?: string } | null;
  onConsumeInitialState?: () => void;
}

const Feed: React.FC<FeedProps> = ({ posts, contacts, onPost, onLike, onDislike, onComment, onCommentVote, onCommentReaction, onPostReaction, onShare, onNavigateToChat, onDeletePost, onEditPost, onSavePost, onGlobalSync, onFollowUser, onUnfollowUser, onConnectUser, onViewUserPosts, user, addToast, isOnline, initialState, onConsumeInitialState }) => {
  const [content, setContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'public' | 'friends'>('public'); 
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);
  const [visiblePostsCount, setVisiblePostsCount] = useState(10);
  const [viewingPost, setViewingPost] = useState<Post | null>(null);
  const [userInfoTarget, setUserInfoTarget] = useState<UserInfoTarget | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'likes'>('recent');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [sharingPost, setSharingPost] = useState<Post | null>(null);
  const [privacy, setPrivacy] = useState<'public' | 'friends'>('friends');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedMedia, setAttachedMedia] = useState<MediaMetadata | null>(null);
  const [postLocation, setPostLocation] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'audio' | 'video' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{postId: string, commentId: string} | null>(null);
  const [commentText, setCommentText] = useState('');
  const [hiddenOverrideIds, setHiddenOverrideIds] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeReactionPicker, setActiveReactionPicker] = useState<{postId: string, commentId?: string} | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContentText, setEditContentText] = useState('');

  useEffect(() => {
      if (initialState) {
          setFeedFilter(initialState.filter);
          setSelectedAuthorId(initialState.authorId || null);
          if (onConsumeInitialState) onConsumeInitialState();
      }
  }, [initialState]);

  useEffect(() => {
    const handleClickOutside = () => {
        setActiveMenuId(null);
        setActiveReactionPicker(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // OPTIMIZED: Memoize processed posts to prevent re-filtering on every render
  const processedPosts = useMemo(() => {
      return (posts || []).filter(post => {
        if (!post) return false;
        if (selectedAuthorId && post.authorId !== selectedAuthorId) return false;
        let visible = false;
        if (feedFilter === 'public') {
            visible = post.privacy === 'public';
        } else {
            visible = post.privacy === 'friends';
        }
        if (!visible) return false;
        
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchesContent = post.content.toLowerCase().includes(q);
            const matchesTags = post.hashtags?.some(tag => tag.toLowerCase().includes(q));
            if (!matchesContent && !matchesTags) return false;
        }
        if (locationFilter) {
            if (!post.location || !post.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
        }
        return true;
      }).sort((a, b) => {
          if (sortBy === 'likes') {
              const scoreA = Object.values(a.votes || {}).filter(v => v === 'up').length;
              const scoreB = Object.values(b.votes || {}).filter(v => v === 'up').length;
              return scoreB - scoreA;
          }
          return b.timestamp - a.timestamp;
      });
  }, [posts, selectedAuthorId, feedFilter, searchQuery, locationFilter, sortBy]);

  const displayedPosts = viewingPost ? [viewingPost] : processedPosts.slice(0, visiblePostsCount);
  const hasMorePosts = !viewingPost && processedPosts.length > visiblePostsCount;

  const handlePostSubmit = () => {
    if (!content.trim() && !attachedImage && !attachedMedia && !sharingPost) return;
    if (!isOnline) { addToast('Network Unavailable', 'Post queued.', 'warning'); resetPostForm(); setShowBroadcastModal(false); return; }
    setIsProcessing(true);
    const timestamp = Date.now();
    const tagsMatch = content.match(/#[a-z0-9_]+/gi);
    const hashtags = tagsMatch ? tagsMatch.map(t => t.substring(1)) : [];
    const postContentPayload = { authorId: user.id, content: content, imageUrl: attachedImage || null, media: attachedMedia || undefined, timestamp: timestamp, location: postLocation || "", hashtags };
    const signature = signData(postContentPayload, user.keys.signing.secretKey);
    const newPost: Post = { id: crypto.randomUUID(), authorId: user.id, authorName: user.displayName, authorAvatar: user.avatarUrl, authorPublicKey: user.keys.signing.publicKey, content: content, imageUrl: attachedImage || undefined, media: attachedMedia || undefined, timestamp: timestamp, votes: {}, shares: 0, comments: 0, commentsList: [], truthHash: signature, privacy: privacy, location: postLocation || undefined, hashtags: hashtags.length > 0 ? hashtags : undefined, sharedPostId: sharingPost?.id, sharedPostSnapshot: sharingPost ? { authorName: sharingPost.authorName, content: sharingPost.content, imageUrl: sharingPost.imageUrl, media: sharingPost.media, timestamp: sharingPost.timestamp } : undefined };
    onPost(newPost); resetPostForm(); setIsProcessing(false); setShowBroadcastModal(false);
  };

  const resetPostForm = () => { setContent(''); setAttachedImage(null); setAttachedMedia(null); setPostLocation(''); setRecordingMode(null); setSharingPost(null); };
  const handleShareClick = (post: Post) => { setSharingPost(post); setPrivacy(post.privacy === 'public' ? 'public' : 'friends'); setShowBroadcastModal(true); };
  const handleMediaCapture = async (blob: Blob, previewUrl: string, duration: number) => { const mediaId = crypto.randomUUID(); const accessKey = crypto.randomUUID(); await saveMedia(mediaId, blob, accessKey); setAttachedMedia({ id: mediaId, type: recordingMode!, mimeType: blob.type, size: blob.size, duration, chunkCount: Math.ceil(blob.size / getTransferConfig(blob.size).chunkSize), thumbnail: undefined, accessKey }); setRecordingMode(null); };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => { 
    if (e.target.files && e.target.files[0]) { 
      const file = e.target.files[0]; 
      
      // Safety Check: Block executables
      const unsafeExtensions = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.jar', '.scr', '.com', '.pif'];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (unsafeExtensions.includes(ext)) {
          addToast('Blocked', 'Executable files are not allowed for security reasons.', 'error');
          return;
      }

      const isImage = file.type.startsWith('image/');
      
      // Small images handled as base64 for better performance in list views
      if (isImage && file.size <= MAX_ATTACHMENT_SIZE_BYTES) { 
        try { 
          const base64 = await fileToBase64(file); 
          setAttachedImage(base64); 
        } catch (err) { 
          addToast('Error', 'Failed to process image.', 'error'); 
        } 
        return; 
      } 
      
      // Large images, videos, audio, and generic files go to Mesh Media Storage
      const mediaId = crypto.randomUUID(); 
      const accessKey = crypto.randomUUID(); 
      const blob = new Blob([file], { type: file.type || 'application/octet-stream' }); 
      await saveMedia(mediaId, blob, accessKey); 
      
      const type = file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'file'); 
      
      setAttachedMedia({ 
        id: mediaId, 
        type, 
        mimeType: file.type || 'application/octet-stream', 
        size: file.size, 
        duration: 0, 
        chunkCount: Math.ceil(file.size / getTransferConfig(file.size).chunkSize), 
        accessKey, 
        filename: file.name 
      }); 
    } 
  };

  const handleCameraCapture = (base64: string) => { setAttachedImage(base64); };
  const triggerFileSelect = () => { fileInputRef.current?.click(); };
  const handleVerifyHash = (post: Post) => { const postPayload = { authorId: post.authorId, content: post.content, imageUrl: post.imageUrl || null, media: post.media || undefined, timestamp: post.timestamp, location: post.location || "", hashtags: post.hashtags || [] }; const isValid = verifySignature(postPayload, post.truthHash, post.authorPublicKey); if (isValid) { addToast('Integrity Verified', 'Ed25519 Signature is VALID. Content is authentic.', 'success'); } else { addToast('Verification Failed', 'Digital signature mismatch. Content may be tampered.', 'error'); } };
  const toggleComments = (postId: string) => { if (expandedPostId === postId) { setExpandedPostId(null); setReplyingTo(null); } else { setExpandedPostId(postId); setCommentText(''); } };
  const handleSubmitComment = (postId: string) => { if (!commentText.trim()) return; if (!isOnline) { addToast('Network Unavailable', 'Comment queued in local outbox.', 'warning'); setCommentText(''); return; } const parentId = replyingTo?.postId === postId ? replyingTo.commentId : undefined; onComment(postId, commentText, parentId); setCommentText(''); setReplyingTo(null); };
  const toggleHide = (postId: string) => { const newSet = new Set(hiddenOverrideIds); if(newSet.has(postId)) newSet.delete(postId); else newSet.add(postId); setHiddenOverrideIds(newSet); };
  const startEditing = (post: Post) => { setEditingPostId(post.id); setEditContentText(post.content); setActiveMenuId(null); };
  const saveEditing = (postId: string) => { if(editContentText.trim()) onEditPost(postId, editContentText); setEditingPostId(null); };
  const handleMenuClick = (e: React.MouseEvent, postId: string) => { e.stopPropagation(); setActiveMenuId(activeMenuId === postId ? null : postId); };
  const handleDelete = (postId: string) => { if(window.confirm("Are you sure you want to delete this broadcast?")) onDeletePost(postId); setActiveMenuId(null); };
  const cancelEditing = () => { setEditingPostId(null); setEditContentText(''); };
  const handleViewSharedPost = (post: Post) => { const fullPost = posts.find(p => p.id === post.sharedPostId); if (fullPost) { setViewingPost(fullPost); } else if (post.sharedPostSnapshot && post.sharedPostId) { const virtualPost: Post = { id: post.sharedPostId, authorId: 'unknown-snapshot', authorName: post.sharedPostSnapshot.authorName, content: post.sharedPostSnapshot.content, imageUrl: post.sharedPostSnapshot.imageUrl, media: post.sharedPostSnapshot.media, timestamp: post.sharedPostSnapshot.timestamp, votes: {}, shares: 0, comments: 0, commentsList: [], truthHash: '', privacy: 'public', authorPublicKey: '', isOrphaned: true }; setViewingPost(virtualPost); addToast("Viewing Snapshot", "This post is being displayed from share data. Some features may be limited if the original is unreachable.", "info"); } };
  const openUserInfo = (post: Post) => { const contact = contacts.find(c => c.id === post.authorId); setUserInfoTarget({ id: post.authorId, displayName: contact ? contact.displayName : post.authorName, avatarUrl: contact?.avatarUrl || post.authorAvatar, username: contact?.username, homeNode: contact?.homeNodes[0] }); };

  const RecursiveComment = ({ comment, postId, depth = 0 }: { comment: Comment, postId: string, depth?: number }) => {
      if (depth > 5) return null;
      const safeReactions = comment.reactions || {};
      const reactionEntries = Object.entries(safeReactions);
      const upVotes = Object.values(comment.votes || {}).filter(v => v === 'up').length;
      const downVotes = Object.values(comment.votes || {}).filter(v => v === 'down').length;
      const myVote = (comment.votes || {})[user.id];
      const isMyComment = comment.authorId === user.id;
      // Format Author
      const { handle, suffix } = formatUserIdentity(comment.authorName || 'Unknown');

      return (
          <div className={`mt-3 ${depth > 0 ? 'ml-3 border-l-2 border-slate-800 pl-3' : ''}`}>
              <div className="flex space-x-3">
                  <div 
                    onClick={() => setUserInfoTarget({ id: comment.authorId, displayName: comment.authorName, avatarUrl: comment.authorAvatar })}
                    className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0 cursor-pointer hover:opacity-80"
                  >
                      {handle.charAt(0)}
                  </div>
                  <div className="flex-1">
                      <div className="bg-slate-800/50 p-3 rounded-lg rounded-tl-none relative group">
                          <div className="flex justify-between items-baseline mb-1">
                              <span className="text-xs text-slate-300 cursor-pointer hover:underline" onClick={() => setUserInfoTarget({ id: comment.authorId, displayName: comment.authorName, avatarUrl: comment.authorAvatar })}>
                                  <span className="font-bold">{handle}</span>
                                  <span className="text-slate-500 opacity-70 font-mono text-[10px]">{suffix}</span>
                              </span>
                              <span className="text-slate-500 text-[10px]">{new Date(comment.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                          <p className="text-sm text-slate-300 leading-relaxed">{comment.content}</p>
                          {reactionEntries.length > 0 && (<div className="flex gap-1 mt-2">{reactionEntries.map(([emoji, users]) => (users && users.length > 0 && (<span key={emoji} className="bg-slate-900/50 text-[10px] px-1.5 py-0.5 rounded-full text-slate-400 border border-slate-700/50">{emoji} {users.length}</span>)))}</div>)}
                      </div>
                      <div className="flex items-center gap-4 mt-1 ml-1">
                          <button onClick={() => onCommentVote(postId, comment.id, 'up')} disabled={isMyComment} className={`flex items-center gap-1 text-xs hover:text-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-500'}`}><ThumbsUp size={12} /><span>{upVotes || 0}</span></button>
                          <button onClick={() => onCommentVote(postId, comment.id, 'down')} disabled={isMyComment} className={`flex items-center gap-1 text-xs hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'down' ? 'text-red-400' : 'text-slate-500'}`}><ThumbsDown size={12} />{downVotes > 0 && <span>{downVotes}</span>}</button>
                          <div className="relative">
                              <button onClick={(e) => { e.stopPropagation(); if(isMyComment) return; setActiveReactionPicker(activeReactionPicker?.commentId === comment.id ? null : { postId, commentId: comment.id }); }} disabled={isMyComment} className={`flex items-center gap-1 text-xs text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}><Smile size={12} /></button>
                              {activeReactionPicker?.commentId === comment.id && (<div className="absolute bottom-full left-0 mb-2 bg-slate-900 border border-slate-700 rounded-full shadow-xl flex p-1 z-20 animate-in zoom-in-95 duration-200 gap-1">{SOCIAL_REACTIONS.map(emoji => (<button key={emoji} onClick={() => { onCommentReaction(postId, comment.id, emoji); setActiveReactionPicker(null); }} className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full text-lg transition-transform hover:scale-125">{emoji}</button>))}</div>)}
                          </div>
                          <button onClick={() => setReplyingTo({ postId, commentId: comment.id })} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors"><div className="flex items-center gap-1"><CornerDownRight size={12} /><span>Reply</span></div></button>
                      </div>
                      {comment.replies && comment.replies.map(reply => (<RecursiveComment key={reply.id} comment={reply} postId={postId} depth={depth + 1} />))}
                  </div>
              </div>
          </div>
      );
  };

  return (
    <div className="h-full overflow-y-auto w-full">
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      
      {/* ... (Header and Broadcast Modal remain same) ... */}
      <div className="flex gap-2 items-center">
        {viewingPost ? (
            <button onClick={() => setViewingPost(null)} className="bg-slate-900 border border-slate-800 text-white px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-slate-800 transition-colors w-full"><ArrowLeft size={18} /><span>Back to Feed</span></button>
        ) : (
            <>
                <div className="flex-1 flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                    <button onClick={() => { setFeedFilter('public'); setSelectedAuthorId(null); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2 ${feedFilter === 'public' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}><Globe size={16} /><span className="hidden sm:inline">Global</span></button>
                    <button onClick={() => { setFeedFilter('friends'); setSelectedAuthorId(null); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2 ${feedFilter === 'friends' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}><Users size={16} /><span className="hidden sm:inline">Friends</span></button>
                </div>
                {onGlobalSync && (<button onClick={onGlobalSync} className="p-3 rounded-xl border transition-colors bg-slate-900 border-slate-800 text-slate-400 hover:text-onion-400 hover:border-onion-500/50" title="Sync Network (Public Feed)"><RefreshCw size={20} /></button>)}
                <button onClick={() => setShowFilters(!showFilters)} className={`p-3 rounded-xl border transition-colors ${showFilters ? 'bg-slate-800 border-onion-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`} title="Filter Feed"><Filter size={20} /></button>
                <button onClick={() => setShowBroadcastModal(true)} className="bg-onion-600 hover:bg-onion-500 text-white px-4 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all shadow-lg shadow-onion-900/20"><Radio size={20} /><span className="hidden sm:inline">Broadcast</span></button>
            </>
        )}
      </div>

      {!viewingPost && showFilters && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 animate-in slide-in-from-top-2 duration-200 space-y-3">
              <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"><Search size={16} className="text-slate-500" /><input type="text" placeholder="Filter by text or #hashtag..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent flex-1 text-sm text-white focus:outline-none"/></div>
              <div className="flex gap-2"><div className="flex-1 flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"><MapPin size={16} className="text-slate-500" /><input type="text" placeholder="Location..." value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="bg-transparent flex-1 text-sm text-white focus:outline-none"/></div><button onClick={() => setSortBy(sortBy === 'recent' ? 'likes' : 'recent')} className="flex items-center space-x-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 transition-colors text-sm">{sortBy === 'recent' ? <Clock size={16} className="text-slate-400" /> : <TrendingUp size={16} className="text-onion-400" />}<span className="text-slate-300">{sortBy === 'recent' ? 'Latest' : 'Popular'}</span></button></div>
          </div>
      )}

      {selectedAuthorId && (<div className="flex items-center justify-between bg-indigo-900/20 border border-indigo-500/30 p-3 rounded-xl animate-in fade-in"><span className="text-sm text-indigo-300">Filtering by specific author</span><button onClick={() => setSelectedAuthorId(null)} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-white">Clear Filter</button></div>)}

      {/* Broadcast Modal - Identical to previous */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50"><h3 className="font-bold text-white flex items-center gap-2"><Radio size={18} className="text-onion-500" />{sharingPost ? 'Share Broadcast' : 'New Broadcast'}</h3><button onClick={() => { setShowBroadcastModal(false); setSharingPost(null); }}><X className="text-slate-400 hover:text-white" /></button></div>
                <div className="p-4 relative">
                    {isProcessing && (<div className="absolute inset-0 bg-slate-900/90 z-20 flex flex-col items-center justify-center font-mono text-sm space-y-3 rounded-2xl"><Loader2 className="animate-spin text-onion-500" size={32} /><div className="text-onion-300">Signing content...</div><div className="flex space-x-2 text-slate-500 text-xs"><Cpu size={12} /><span>Ed25519</span></div></div>)}
                    {recordingMode ? (<div className="mb-4"><MediaRecorder type={recordingMode} maxDuration={MAX_POST_MEDIA_DURATION} onCapture={handleMediaCapture} onCancel={() => setRecordingMode(null)} /></div>) : (<div className="space-y-4"><div className="flex space-x-3">{user.avatarUrl ? (<img src={user.avatarUrl} alt="Me" className="w-10 h-10 rounded-full bg-slate-800 object-cover flex-shrink-0" />) : (<div className="w-10 h-10 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex-shrink-0 flex items-center justify-center font-bold text-white">{user.displayName.charAt(0)}</div>)}<div className="flex-1 space-y-2"><textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={isProcessing} placeholder={isOnline ? (sharingPost ? "Add a thought..." : "What's on your mind? Use #hashtags for visibility.") : "You are offline. Posts will be queued."} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-onion-500 resize-none h-32" /><div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"><MapPin size={14} className="text-slate-500" /><input type="text" value={postLocation} onChange={(e) => setPostLocation(e.target.value)} placeholder="Add Location (Optional)" className="bg-transparent flex-1 text-xs text-white focus:outline-none" /></div></div></div>{sharingPost && (<div className="ml-13 pl-12"><div className="border border-slate-700 bg-slate-900/50 rounded-lg p-3 text-sm"><div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800/50"><Repeat size={14} className="text-onion-400" />{sharingPost.authorAvatar ? (<img src={sharingPost.authorAvatar} className="w-5 h-5 rounded-full object-cover" alt="" />) : (<div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 font-bold">{sharingPost.authorName.charAt(0)}</div>)}<span className="font-bold text-slate-300">{sharingPost.authorName}</span></div><p className="text-slate-400 line-clamp-3">{sharingPost.content}</p></div></div>)}{attachedImage && (<div className="ml-13 pl-12 relative group w-fit"><img src={attachedImage} alt="Attachment" className="h-24 w-auto rounded-lg border border-slate-700" /><button onClick={() => setAttachedImage(null)} className="absolute -top-1 -right-1 bg-slate-800 text-white rounded-full p-0.5 border border-slate-600 hover:bg-red-500 transition-colors"><X size={14} /></button></div>)}{attachedMedia && (<div className="ml-13 pl-12 relative group w-full"><div className="relative"><MediaPlayer media={attachedMedia} /><button onClick={() => setAttachedMedia(null)} className="absolute top-2 right-2 bg-slate-800 text-white rounded-full p-1 border border-slate-600 hover:bg-red-500 transition-colors z-10"><X size={16} /></button></div></div>)}</div>)}
                </div>
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between items-center"><div className="flex space-x-2"><input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" /><button onClick={() => setRecordingMode('audio')} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors" title="Record Audio"><Mic size={20} /></button><button onClick={() => setRecordingMode('video')} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors" title="Record Video"><Video size={20} /></button><button onClick={triggerFileSelect} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors" title="Upload Media"><FileText size={20} /></button><button onClick={() => setShowCamera(true)} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors" title="Camera"><CameraIcon size={20} /></button><button onClick={() => setPrivacy(prev => prev === 'public' ? 'friends' : 'public')} className="px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors flex items-center space-x-1 ml-2">{privacy === 'public' ? <Globe size={14} className="text-emerald-400" /> : <Lock size={14} className="text-onion-400" />}<span>{privacy === 'public' ? 'Public' : 'Friends'}</span></button></div><button onClick={handlePostSubmit} disabled={(!content.trim() && !attachedImage && !attachedMedia && !sharingPost) || isProcessing} className={`px-6 py-2 rounded-xl text-sm font-bold transition-colors flex items-center space-x-2 ${isOnline ? 'bg-onion-600 hover:bg-onion-500 text-white disabled:opacity-50' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}>{isOnline ? (sharingPost ? 'Share' : 'Post') : <><WifiOff size={14}/><span>Queue</span></>}</button></div>
            </div>
        </div>
      )}
      <CameraModal isOpen={showCamera} onClose={() => setShowCamera(false)} onCapture={handleCameraCapture} />

      {!viewingPost && (
        <div className="flex items-center space-x-2 text-slate-600 text-xs font-mono justify-center">
            <div className="h-px bg-slate-800 w-12" /><Globe size={12} className={isOnline ? "text-emerald-500" : "text-slate-600"} /><span>{isOnline ? 'MESH NETWORK SYNCED' : 'LOCAL CACHE MODE'}</span><div className="h-px bg-slate-800 w-12" />
        </div>
      )}

      {!viewingPost && displayedPosts.length === 0 && (
         <div className="text-center py-10 opacity-50">{feedFilter === 'friends' ? (<div className="flex flex-col items-center"><Lock size={48} className="text-slate-600 mb-2" /><p className="text-slate-400">No encrypted friend packets found.</p></div>) : (<div className="flex flex-col items-center"><Globe size={48} className="text-slate-600 mb-2" /><p className="text-slate-400">No public broadcasts available.</p></div>)}</div>
      )}

      {/* Posts */}
      {displayedPosts.map((post) => {
         const upVotes = Object.values(post.votes || {}).filter(v => v === 'up').length;
         const downVotes = Object.values(post.votes || {}).filter(v => v === 'down').length;
         const myVote = (post.votes || {})[user.id];
         const isOwner = post.authorId === user.id;
         const authorContact = contacts.find(c => c.id === post.authorId);
         const authorOnion = isOwner ? undefined : authorContact?.homeNodes[0];
         const postReactionEntries = Object.entries(post.reactions || {});
         let referencedPost = post.sharedPostId ? posts.find(p => p.id === post.sharedPostId) : null;
         if (!referencedPost && post.sharedPostSnapshot) {
             referencedPost = { ...post.sharedPostSnapshot, id: post.sharedPostId!, authorId: 'unknown', authorPublicKey: '', votes: {}, shares: 0, comments: 0, commentsList: [], truthHash: '', privacy: 'public', isOrphaned: true } as Post;
         }
         
         const ratio = downVotes / (upVotes + 1);
         const isBlocked = ratio > 3.0 || (ratio > 2.0 && feedFilter === 'public');
         const isFlagged = !isBlocked && ratio > 2.0;
         const isHidden = !hiddenOverrideIds.has(post.id) && isFlagged;
         const isEditing = editingPostId === post.id;

         // IDENTITY FORMATTING
         const { handle, suffix } = formatUserIdentity(post.authorName);

         return (
        <div key={post.id} className={`bg-slate-900 rounded-xl border overflow-hidden shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500 relative ${isBlocked ? 'border-red-900/30' : post.isOrphaned && !post.isSaved ? 'border-amber-500/50' : 'border-slate-800'}`}>
          {/* Header - Always Visible */}
          {post.isOrphaned && !post.isSaved && !isBlocked && (<div className="bg-amber-900/30 border-b border-amber-500/30 p-2 flex items-center justify-between"><div className="flex items-center space-x-2 text-xs text-amber-200"><AlertTriangle size={14} className="text-amber-500" /><span><strong>Orphaned Content:</strong> Source node deleted or inactive.</span></div>{onSavePost && (<button onClick={() => onSavePost(post.id)} className="flex items-center space-x-1 bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded text-xs font-bold transition-colors"><Archive size={12} /><span>Save Forever</span></button>)}</div>)}
          {isHidden && (<div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6"><Shield size={48} className="text-amber-500 mb-3" /><h3 className="text-white font-bold text-lg">Community Flagged</h3><p className="text-slate-400 text-sm mb-4 max-w-xs">This broadcast has a high downvote ratio. It may contain spam or low-quality content.</p><button onClick={() => toggleHide(post.id)} className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors"><Eye size={16} /><span>View Anyway</span></button></div>)}
          
          <div className={`p-4 flex justify-between items-start ${isBlocked ? 'opacity-50' : ''}`}>
            <div className="flex space-x-3">
              {post.authorAvatar ? (
                  <img src={post.authorAvatar} alt={post.authorName} onClick={() => !isBlocked && openUserInfo(post)} className="w-10 h-10 rounded-full bg-slate-700 object-cover cursor-pointer hover:opacity-80 transition-opacity" />
              ) : (
                <div onClick={() => !isBlocked && openUserInfo(post)} className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:bg-slate-600 transition-colors">{handle.charAt(0)}</div>
              )}
              <div>
                <p onClick={() => !isBlocked && openUserInfo(post)} className="text-slate-200 text-sm cursor-pointer hover:underline flex items-center gap-1.5">
                    <span className="font-semibold">{handle}</span>
                    <span className="text-slate-500 opacity-70 font-mono text-[10px]">{suffix}</span>
                    {post.isOrphaned && !post.isSaved && !isBlocked && (<span title="Broken Link (Orphaned)" className="flex items-center"><Link2Off size={14} className="text-amber-500" /></span>)}
                    {post.isSaved && !isBlocked && (<span className="bg-emerald-900/50 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded border border-emerald-700/50 flex items-center gap-0.5"><FileArchive size={10} /> Saved</span>)}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span>{new Date(post.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  {post.location && (<span className="flex items-center gap-0.5 text-slate-400"><MapPin size={10} /> {post.location}</span>)}
                  {post.authorId === user.id ? (<div className="flex items-center space-x-1 text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded"><Cpu size={10} /><span className="font-mono">Local-Node</span></div>) : (<div className="flex items-center space-x-1 text-emerald-400 bg-emerald-400/5 px-1.5 py-0.5 rounded"><Wifi size={10} /><span className="font-mono">LAN-Route</span></div>)}
                  {post.privacy === 'public' && (<Globe size={10} className="text-slate-600" />)}
                  {post.privacy === 'friends' && (<Lock size={10} className="text-onion-500/70" />)}
                  {post.isEdited && (<span className="text-slate-600 italic">(Edited)</span>)}
                </div>
              </div>
            </div>
            
            {!isBlocked && isOwner && (<div className="relative"><button onClick={(e) => handleMenuClick(e, post.id)} className="text-slate-500 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors"><MoreHorizontal size={20} /></button>{activeMenuId === post.id && (<div className="absolute right-0 mt-2 w-32 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-30 animate-in fade-in zoom-in-95 duration-100 overflow-hidden"><button onClick={() => startEditing(post)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"><Edit2 size={14} /><span>Edit Post</span></button><button onClick={() => handleDelete(post.id)} className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-slate-800 hover:text-red-300 flex items-center gap-2 border-t border-slate-800"><Trash2 size={14} /><span>Delete</span></button></div>)}</div>)}
          </div>

          {/* Content Body - Conditional for Blocked */}
          {isBlocked ? (
             <div className="px-4 pb-6 pt-2 text-center">
                 <div className="bg-slate-950/50 border border-red-900/30 rounded-xl p-4 flex flex-col items-center justify-center space-y-2">
                     <div className="p-2 bg-red-950/50 rounded-full">
                         <Ban size={20} className="text-red-500" />
                     </div>
                     <h3 className="text-red-400 font-bold text-sm">Post Blocked</h3>
                     <p className="text-xs text-slate-500 max-w-[200px]">This content is hidden due to overwhelming community disapproval.</p>
                 </div>
             </div>
          ) : (
             <>
                <div className="px-4 pb-3 space-y-3">
                    {isEditing ? (
                        <div className="space-y-2"><textarea value={editContentText} onChange={(e) => setEditContentText(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 text-sm focus:outline-none focus:border-onion-500 min-h-[80px]" /><div className="flex justify-end gap-2"><button onClick={cancelEditing} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 rounded flex items-center gap-1"><XCircle size={12} /> Cancel</button><button onClick={() => saveEditing(post.id)} className="px-3 py-1.5 text-xs text-white bg-onion-600 hover:bg-onion-500 rounded flex items-center gap-1"><Save size={12} /> Save</button></div></div>
                    ) : (<div className="text-slate-300 leading-relaxed whitespace-pre-wrap">{post.content.split(/(\s+)/).map((part, i) => { if (part.startsWith('#')) { return <span key={i} className="text-onion-400 font-medium">{part}</span>; } return part; })}</div>)}
                    {referencedPost && (
                        <div onClick={() => handleViewSharedPost(post)} className="border border-slate-700 bg-slate-950/50 rounded-lg p-3 mt-2 hover:border-slate-600 transition-colors cursor-pointer group">
                            <div className="flex items-center gap-2 mb-2 border-b border-slate-800 pb-2"><Quote size={14} className="text-onion-400" />{referencedPost.authorAvatar ? (<img src={referencedPost.authorAvatar} alt={referencedPost.authorName} className="w-5 h-5 rounded-full object-cover bg-slate-800" />) : (<div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400">{referencedPost.authorName.charAt(0)}</div>)}
                            <span className="text-xs text-slate-300"><span className="font-bold">{formatUserIdentity(referencedPost.authorName).handle}</span></span>
                            <span className="text-[10px] text-slate-500">{new Date(referencedPost.timestamp).toLocaleDateString()}</span><div className="ml-auto text-onion-500 opacity-0 group-hover:opacity-100 transition-opacity"><ExternalLink size={12} /></div></div><p className="text-sm text-slate-400 line-clamp-4">{referencedPost.content}</p>{(referencedPost.media || referencedPost.imageUrl) && (<div className="mt-2 h-32 w-full bg-slate-900 rounded-md overflow-hidden relative flex items-center justify-center border border-slate-800 group-hover:border-onion-500/30 transition-colors">{referencedPost.imageUrl ? (<img src={referencedPost.imageUrl} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" alt="Shared content" />) : (<div className="flex flex-col items-center text-slate-500 group-hover:text-onion-400 transition-colors">{referencedPost.media?.type === 'video' ? <Video size={32} /> : <Mic size={32} />}<span className="text-xs font-bold mt-2">Click to view media</span></div>)}</div>)}</div>
                    )}
                    {post.sharedPostId && !referencedPost && (<div className="border border-slate-700 bg-slate-900/30 rounded-lg p-3 mt-2 flex items-center gap-2 text-slate-500 italic text-xs"><AlertTriangle size={14} /><span>Original post unavailable or deleted.</span></div>)}
                </div>
                {post.media && (<div className="px-4 pb-2"><MediaPlayer media={post.media} peerId={authorOnion} onNotification={addToast} /></div>)}
                {post.imageUrl && (<div className="relative h-64 w-full bg-slate-950 group"><img src={post.imageUrl} alt="Post content" className="w-full h-full object-cover" /><div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs text-white font-mono flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity"><Shield size={10} /><span>Encrypted Media</span></div></div>)}
                {postReactionEntries.length > 0 && (<div className="px-4 pb-2 flex flex-wrap gap-1">{postReactionEntries.map(([emoji, users]) => (users && users.length > 0 && (<span key={emoji} className="bg-slate-800/50 text-xs px-2 py-1 rounded-full text-slate-300 border border-slate-700/50 flex items-center gap-1">{emoji} <span className="font-bold">{users.length}</span></span>)))}</div>)}
             </>
          )}

          <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <div onClick={() => handleVerifyHash(post)} className="mb-4 flex items-center space-x-2 text-[10px] text-slate-600 font-mono bg-slate-950/50 p-1.5 rounded border border-slate-800/50 cursor-pointer hover:bg-slate-900 hover:border-onion-500/50 transition-colors group"><span className="text-onion-500">TRUTH_HASH:</span><span className="truncate w-32">{post.truthHash}</span><ShieldCheck size={10} className="text-emerald-500 group-hover:scale-125 transition-transform" /></div>
            <div className="flex justify-between items-center text-slate-400 relative">
              <div className="flex space-x-4">
                <button onClick={() => !isBlocked && onLike(post.id)} disabled={isOwner || isBlocked} className={`flex items-center space-x-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'up' ? 'text-emerald-400' : 'hover:text-emerald-400'}`}><ThumbsUp size={18} className={myVote === 'up' ? 'fill-current' : ''} /><span>{upVotes > 0 ? upVotes : 'Like'}</span></button>
                <button onClick={() => !isBlocked && onDislike(post.id)} disabled={isOwner || isBlocked} className={`flex items-center space-x-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'down' ? 'text-red-400' : 'hover:text-red-400'}`}><ThumbsDown size={18} className={myVote === 'down' ? 'fill-current' : ''} />{downVotes > 0 && <span>{downVotes}</span>}</button>
                <button onClick={() => !isBlocked && toggleComments(post.id)} disabled={isBlocked} className={`flex items-center space-x-1 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${expandedPostId === post.id ? 'text-blue-400' : ''}`}><MessageCircle size={18} /><span>{post.comments > 0 ? post.comments : 'Comment'}</span></button>
                <button onClick={() => !isBlocked && handleShareClick(post)} disabled={isBlocked} className="flex items-center space-x-1 hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Share2 size={18} /><span>{post.shares > 0 ? post.shares : 'Share'}</span></button>
                <button onClick={(e) => { e.stopPropagation(); if (isOwner || isBlocked) return; setActiveReactionPicker(activeReactionPicker?.postId === post.id && !activeReactionPicker.commentId ? null : { postId: post.id }); }} disabled={isOwner || isBlocked} className={`flex items-center space-x-1 transition-colors ${isOwner ? 'opacity-50 cursor-not-allowed text-slate-600' : 'hover:text-amber-400'} disabled:cursor-not-allowed`}><Smile size={18} /></button>
              </div>
              {activeReactionPicker?.postId === post.id && !activeReactionPicker.commentId && (<div className="absolute bottom-10 left-0 bg-slate-900 border border-slate-700 rounded-full shadow-xl flex p-1 z-50 gap-1 animate-in zoom-in-95">{SOCIAL_REACTIONS.map(emoji => (<button key={emoji} onClick={() => { onPostReaction(post.id, emoji); setActiveReactionPicker(null); }} className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full text-lg transition-transform hover:scale-125">{emoji}</button>))}</div>)}
            </div>
            {expandedPostId === post.id && (
              <div className="bg-slate-955/50 border-t border-slate-800 p-4 animate-in slide-in-from-top-2">
                 <div className="space-y-4 mb-4">{post.commentsList && post.commentsList.length > 0 ? (post.commentsList.map(comment => (<RecursiveComment key={comment.id} comment={comment} postId={post.id} />))) : (<div className="text-center text-slate-600 text-xs py-4 italic">No comments yet. Be the first!</div>)}</div>
                 {!replyingTo && (<div className="flex gap-3 pt-2 border-t border-slate-800"><div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">{user.displayName.charAt(0)}</div><div className="flex-1"><textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment..." className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-200 text-sm focus:outline-none focus:border-onion-500 resize-none h-16" /><div className="flex justify-end mt-2"><button onClick={() => handleSubmitComment(post.id)} disabled={!commentText.trim()} className="px-4 py-1.5 bg-onion-600 hover:bg-onion-500 text-white text-xs font-bold rounded-lg disabled:opacity-50">Comment</button></div></div></div>)}
                 {replyingTo && replyingTo.postId === post.id && (<div className="flex gap-3 pt-2 border-t border-slate-800 animate-in fade-in"><div className="flex-1 bg-slate-900 p-3 rounded-lg border border-onion-500/50"><div className="flex justify-between mb-2 text-xs text-onion-400"><span>Replying to thread...</span><button onClick={() => setReplyingTo(null)}><X size={14}/></button></div><textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a reply..." className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 text-sm h-16" autoFocus /><div className="flex justify-end mt-2"><button onClick={() => handleSubmitComment(post.id)} className="px-4 py-1.5 bg-onion-600 text-white text-xs font-bold rounded">Reply</button></div></div></div>)}
              </div>
            )}
          </div>
        </div>
         );
      })}
      {hasMorePosts && (<div className="flex justify-center pt-4 pb-8"><button onClick={() => setVisiblePostsCount(prev => prev + 10)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-2 rounded-full text-sm font-medium transition-colors">Load More</button></div>)}
      <div className="h-16 md:hidden"></div>
      {userInfoTarget && (<UserInfoModal target={userInfoTarget} currentUser={user} isContact={contacts.some(c => c.id === userInfoTarget.id)} isFollowing={user.followingIds?.includes(userInfoTarget.id) || false} onClose={() => setUserInfoTarget(null)} onConnect={(t) => { onConnectUser(t); setUserInfoTarget(null); }} onFollow={onFollowUser} onUnfollow={onUnfollowUser} onMessage={(cid) => { onNavigateToChat(cid); setUserInfoTarget(null); }} onViewPosts={(uid) => { onViewUserPosts(uid); setUserInfoTarget(null); }} />)}
    </div>
    </div>
  );
};

export default Feed;
