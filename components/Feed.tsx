
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Post, UserProfile, ToastMessage, Contact, MediaMetadata, Comment } from '../types';
import { MessageCircle, Share2, Shield, Wifi, Globe, MoreHorizontal, ShieldCheck, Loader2, Lock, Cpu, Send, WifiOff, Image as ImageIcon, X, Users, Repeat, User, ThumbsDown, Camera as CameraIcon, Eye, Trash2, Edit2, Save, XCircle, Mic, Video, FileText, Radio, MapPin, Filter, Search, TrendingUp, Hash, ChevronDown, Clock, Smile, ThumbsUp, CornerDownRight, AlertTriangle, Archive, FileArchive, Link2Off, Quote, RefreshCw, ArrowLeft, Play, ExternalLink, Ban } from 'lucide-react';
import { fileToBase64, getTransferConfig, SOCIAL_REACTIONS, formatUserIdentity, formatBytes } from '../utils';
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
  initialState?: { filter: 'public' | 'friends'; authorId?: string; postId?: string } | null;
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
          if (initialState.postId) {
              const targetPost = posts.find(p => p.id === initialState.postId);
              if (targetPost) {
                  setViewingPost(targetPost);
              } else {
                  addToast("Not Found", "The post you are looking for is not in your feed history.", "warning");
              }
          } else {
              setFeedFilter(initialState.filter);
              setSelectedAuthorId(initialState.authorId || null);
          }
          if (onConsumeInitialState) onConsumeInitialState();
      }
  }, [initialState, posts]);

  useEffect(() => {
    const handleClickOutside = () => {
        setActiveMenuId(null);
        setActiveReactionPicker(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

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
      
      const unsafeExtensions = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.jar', '.scr', '.com', '.pif'];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (unsafeExtensions.includes(ext)) {
          addToast('Blocked', 'Executable files are not allowed for security reasons.', 'error');
          return;
      }

      const isImage = file.type.startsWith('image/');
      
      if (isImage && file.size <= MAX_ATTACHMENT_SIZE_BYTES) { 
        try { 
          const base64 = await fileToBase64(file); 
          setAttachedImage(base64); 
        } catch (err) { 
          addToast('Error', 'Failed to process image.', 'error'); 
        } 
        return; 
      } 
      
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
                          <button onClick={() => onCommentVote(postId, comment.id, 'up')} disabled={isMyComment} className={`flex items-center gap-1 text-[10px] ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}><ThumbsUp size={12} /> {upVotes > 0 && upVotes}</button>
                          <button onClick={() => onCommentVote(postId, comment.id, 'down')} disabled={isMyComment} className={`flex items-center gap-1 text-[10px] ${myVote === 'down' ? 'text-red-400' : 'text-slate-500 hover:text-red-400'}`}><ThumbsDown size={12} /> {downVotes > 0 && downVotes}</button>
                          <button onClick={() => setReplyingTo({postId, commentId: comment.id})} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-white"><MessageCircle size={12} /> Reply</button>
                          <div className="relative">
                              <button 
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveReactionPicker(prev => (prev?.commentId === comment.id) ? null : { postId, commentId: comment.id });
                                  }}
                                  className={`text-slate-500 hover:text-yellow-400 ${activeReactionPicker?.commentId === comment.id ? 'text-yellow-400' : ''}`}
                              >
                                  <Smile size={12} />
                              </button>
                              {activeReactionPicker?.commentId === comment.id && (
                                  <div className="absolute left-0 bottom-full mb-1 flex bg-slate-900 border border-slate-700 rounded-full p-1 gap-1 shadow-xl z-10 animate-in zoom-in-95">
                                      {SOCIAL_REACTIONS.map(emoji => (
                                          <button 
                                              key={emoji} 
                                              onClick={(e) => {
                                                  e.stopPropagation();
                                                  onCommentReaction(postId, comment.id, emoji);
                                                  setActiveReactionPicker(null);
                                              }} 
                                              className="hover:scale-125 transition-transform text-sm"
                                          >
                                              {emoji}
                                          </button>
                                      ))}
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
              {/* Replies */}
              {(comment.replies || []).map(reply => <RecursiveComment key={reply.id} comment={reply} postId={postId} depth={depth + 1} />)}
          </div>
      );
  };

  return (
    <div className="h-full overflow-y-auto w-full max-w-2xl mx-auto p-4 md:p-8 space-y-6 pb-24">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Globe size={24} className="text-onion-400" /> Social Feed
            </h2>
            <div className="flex gap-2">
                <button onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-onion-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                    <Filter size={20} />
                </button>
                <button onClick={() => setShowBroadcastModal(true)} className="bg-onion-600 hover:bg-onion-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors">
                    <Send size={18} /> <span className="hidden sm:inline">Broadcast</span>
                </button>
            </div>
        </div>

        {/* Filter Bar */}
        {showFilters && (
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-4 animate-in slide-in-from-top-2">
                <div className="flex gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
                        <input type="text" placeholder="Search content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-white focus:outline-none focus:border-onion-500" />
                    </div>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none">
                        <option value="recent">Recent</option>
                        <option value="likes">Top Rated</option>
                    </select>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setFeedFilter('public')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${feedFilter === 'public' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Public</button>
                    <button onClick={() => setFeedFilter('friends')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${feedFilter === 'friends' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Friends Only</button>
                </div>
            </div>
        )}

        {/* Selected Author Banner */}
        {selectedAuthorId && (
            <div className="bg-indigo-900/30 border border-indigo-500/50 p-3 rounded-xl flex justify-between items-center text-indigo-200">
                <span className="text-sm">Viewing posts by specific user</span>
                <button onClick={() => { setSelectedAuthorId(null); setViewingPost(null); }} className="text-xs hover:text-white flex items-center gap-1"><X size={14} /> Clear</button>
            </div>
        )}

        {/* Viewing Single Post */}
        {viewingPost && (
            <div className="mb-4">
                <button onClick={() => setViewingPost(null)} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 transition-colors">
                    <ArrowLeft size={18} /> Back to Feed
                </button>
            </div>
        )}

        {/* Post List */}
        <div className="space-y-4">
            {displayedPosts.map(post => {
                const isMyPost = post.authorId === user.id;
                const score = Object.values(post.votes).filter(v => v === 'up').length - Object.values(post.votes).filter(v => v === 'down').length;
                const myVote = post.votes[user.id];
                const { handle, suffix } = formatUserIdentity(post.authorName);

                return (
                    <div key={post.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg transition-all hover:border-slate-700">
                        {/* Header */}
                        <div className="p-4 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div onClick={() => openUserInfo(post)} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-300 cursor-pointer hover:bg-slate-700">
                                    {post.authorAvatar ? <img src={post.authorAvatar} className="w-full h-full object-cover rounded-full" /> : handle.charAt(0)}
                                </div>
                                <div>
                                    <div onClick={() => openUserInfo(post)} className="font-bold text-white cursor-pointer hover:underline flex items-center gap-1">
                                        {handle}
                                        <span className="text-slate-500 text-xs font-normal font-mono">{suffix}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-2">
                                        <span>{new Date(post.timestamp).toLocaleString()}</span>
                                        {post.privacy === 'friends' ? <Users size={12} /> : <Globe size={12} />}
                                        {post.isEdited && <span>(edited)</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="relative">
                                <button onClick={(e) => handleMenuClick(e, post.id)} className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-800"><MoreHorizontal size={20} /></button>
                                {activeMenuId === post.id && (
                                    <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                                        {isMyPost ? (
                                            <>
                                                <button onClick={() => startEditing(post)} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"><Edit2 size={14} /> Edit Post</button>
                                                <button onClick={() => handleDelete(post.id)} className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 flex items-center gap-2"><Trash2 size={14} /> Delete</button>
                                            </>
                                        ) : (
                                            <button onClick={() => handleVerifyHash(post)} className="w-full text-left px-4 py-3 text-sm text-emerald-400 hover:bg-slate-700 hover:text-emerald-300 flex items-center gap-2"><ShieldCheck size={14} /> Verify Integrity</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="px-4 pb-2">
                            {editingPostId === post.id ? (
                                <div className="space-y-2">
                                    <textarea value={editContentText} onChange={e => setEditContentText(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-onion-500 h-32" />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={cancelEditing} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white">Cancel</button>
                                        <button onClick={() => saveEditing(post.id)} className="px-3 py-1.5 bg-onion-600 text-white text-sm rounded hover:bg-onion-500">Save</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                                    {post.imageUrl && <img src={post.imageUrl} alt="Content" className="mt-3 rounded-lg w-full max-h-96 object-cover border border-slate-800" />}
                                    {post.media && <div className="mt-3"><MediaPlayer media={post.media} peerId={contacts.find(c => c.id === post.authorId)?.homeNodes[0]} onNotification={addToast} /></div>}
                                    
                                    {/* Shared Post Render */}
                                    {(post.sharedPostId || post.sharedPostSnapshot) && (
                                        <div className="mt-3 border border-slate-700 rounded-lg p-3 bg-slate-950/50 cursor-pointer hover:bg-slate-950" onClick={() => handleViewSharedPost(post)}>
                                            <div className="text-xs text-slate-500 flex items-center gap-1 mb-1"><Repeat size={12} /> Shared Broadcast</div>
                                            {post.sharedPostSnapshot ? (
                                                <div>
                                                    <div className="font-bold text-sm text-slate-300">{post.sharedPostSnapshot.authorName}</div>
                                                    <div className="text-xs text-slate-400 truncate">{post.sharedPostSnapshot.content}</div>
                                                </div>
                                            ) : (
                                                <div className="text-xs text-slate-500 italic">Original post content loading...</div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer / Actions */}
                        <div className="px-4 py-3 bg-slate-950/30 border-t border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center bg-slate-800/50 rounded-full p-1">
                                    <button onClick={() => onLike(post.id)} className={`p-1.5 rounded-full hover:bg-slate-700 transition-colors ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-400'}`}><ThumbsUp size={18} /></button>
                                    <span className={`text-sm font-bold px-2 ${score > 0 ? 'text-emerald-400' : score < 0 ? 'text-red-400' : 'text-slate-500'}`}>{score}</span>
                                    <button onClick={() => onDislike(post.id)} className={`p-1.5 rounded-full hover:bg-slate-700 transition-colors ${myVote === 'down' ? 'text-red-400' : 'text-slate-400'}`}><ThumbsDown size={18} /></button>
                                </div>
                                <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors">
                                    <MessageCircle size={18} /> <span className="text-sm font-medium">{post.comments}</span>
                                </button>
                                <button onClick={() => handleShareClick(post)} className="text-slate-400 hover:text-white transition-colors"><Share2 size={18} /></button>
                            </div>
                            
                            {/* Reactions */}
                            <div className="flex items-center gap-2">
                                {Object.entries(post.reactions || {}).map(([emoji, users]) => (
                                    users.length > 0 && <span key={emoji} className="text-sm bg-slate-800 px-2 py-1 rounded-full text-slate-300">{emoji} {users.length}</span>
                                ))}
                                <div className="relative">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveReactionPicker(prev => (prev?.postId === post.id && !prev.commentId) ? null : { postId: post.id });
                                        }}
                                        className={`p-1 rounded hover:bg-slate-800 transition-colors ${activeReactionPicker?.postId === post.id && !activeReactionPicker.commentId ? 'text-yellow-400' : 'text-slate-400 hover:text-yellow-400'}`}
                                    >
                                        <Smile size={18} />
                                    </button>
                                    {activeReactionPicker?.postId === post.id && !activeReactionPicker.commentId && (
                                        <div className="absolute right-0 bottom-full mb-2 flex bg-slate-900 border border-slate-700 rounded-full p-2 gap-2 shadow-xl z-10 animate-in zoom-in-95">
                                            {SOCIAL_REACTIONS.map(emoji => (
                                                <button 
                                                    key={emoji} 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onPostReaction(post.id, emoji);
                                                        setActiveReactionPicker(null);
                                                    }} 
                                                    className="hover:scale-125 transition-transform text-lg"
                                                >
                                                    {emoji}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Comments Section */}
                        {expandedPostId === post.id && (
                            <div className="border-t border-slate-800 bg-slate-950 p-4">
                                <div className="space-y-4 mb-4 max-h-96 overflow-y-auto">
                                    {post.commentsList.map(comment => (
                                        <RecursiveComment key={comment.id} comment={comment} postId={post.id} />
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    {replyingTo?.postId === post.id && (
                                        <div className="flex items-center bg-slate-800 text-xs text-slate-300 px-2 rounded-l">Replying... <button onClick={() => setReplyingTo(null)} className="ml-2 hover:text-white"><X size={12} /></button></div>
                                    )}
                                    <input 
                                        type="text" 
                                        placeholder={replyingTo?.postId === post.id ? "Write a reply..." : "Write a comment..."}
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment(post.id)}
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-onion-500"
                                    />
                                    <button onClick={() => handleSubmitComment(post.id)} className="bg-onion-600 hover:bg-onion-500 text-white p-2 rounded-lg"><Send size={16} /></button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            
            {/* Load More Trigger */}
            {hasMorePosts && (
                <button onClick={() => setVisiblePostsCount(prev => prev + 10)} className="w-full py-4 bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors font-bold text-sm">
                    Load More Broadcasts
                </button>
            )}
            
            {displayedPosts.length === 0 && (
                <div className="text-center py-20 text-slate-500 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
                    <Globe size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No broadcasts found.</p>
                    <p className="text-sm">Try adjusting filters or connecting to more peers.</p>
                </div>
            )}
        </div>

        {/* Create Post Modal */}
        {showBroadcastModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2"><Radio size={18} className="text-onion-500" /> {sharingPost ? 'Share Broadcast' : 'New Broadcast'}</h3>
                        <button onClick={() => setShowBroadcastModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
                    </div>
                    <div className="p-4 space-y-4">
                        <textarea 
                            value={content} 
                            onChange={(e) => setContent(e.target.value)} 
                            placeholder="What's happening on the mesh?" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white h-32 focus:outline-none focus:border-onion-500 resize-none"
                        />
                        
                        {/* Attachments Preview */}
                        {attachedImage && (
                            <div className="relative w-fit">
                                <img src={attachedImage} className="h-24 rounded-lg border border-slate-700" />
                                <button onClick={() => setAttachedImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><X size={12} /></button>
                            </div>
                        )}
                        {attachedMedia && (
                            <div className="flex items-center gap-2 bg-slate-800 p-2 rounded-lg w-fit">
                                <FileText size={16} className="text-indigo-400" />
                                <span className="text-xs text-slate-300">{formatBytes(attachedMedia.size)}</span>
                                <button onClick={() => setAttachedMedia(null)} className="text-slate-500 hover:text-white"><X size={14} /></button>
                            </div>
                        )}
                        {sharingPost && (
                            <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 opacity-70">
                                <div className="text-xs font-bold text-slate-300">{sharingPost.authorName}</div>
                                <div className="text-xs text-slate-400 truncate">{sharingPost.content}</div>
                            </div>
                        )}

                        <div className="flex justify-between items-center pt-2">
                            <div className="flex gap-2">
                                <button onClick={() => setRecordingMode('audio')} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><Mic size={18} /></button>
                                <button onClick={() => setRecordingMode('video')} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><Video size={18} /></button>
                                <button onClick={() => setShowCamera(true)} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><CameraIcon size={18} /></button>
                                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg"><ImageIcon size={18} /></button>
                                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                            </div>
                            <div className="flex items-center gap-2">
                                <select value={privacy} onChange={(e) => setPrivacy(e.target.value as any)} className="bg-slate-950 text-slate-300 text-sm border border-slate-800 rounded-lg px-2 py-1.5 focus:outline-none">
                                    <option value="public">Public (Global)</option>
                                    <option value="friends">Friends Only</option>
                                </select>
                                <button onClick={handlePostSubmit} disabled={isProcessing} className="bg-onion-600 hover:bg-onion-500 text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-50 flex items-center gap-2">
                                    {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Post
                                </button>
                            </div>
                        </div>
                        
                        {recordingMode && (
                            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                                <MediaRecorder type={recordingMode} maxDuration={MAX_POST_MEDIA_DURATION} onCapture={handleMediaCapture} onCancel={() => setRecordingMode(null)} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        <CameraModal isOpen={showCamera} onClose={() => setShowCamera(false)} onCapture={handleCameraCapture} />
        
        {userInfoTarget && (
            <UserInfoModal 
                target={userInfoTarget}
                currentUser={user}
                isContact={contacts.some(c => c.id === userInfoTarget.id)}
                isFollowing={user.followingIds?.includes(userInfoTarget.id) || false}
                onClose={() => setUserInfoTarget(null)}
                onConnect={onConnectUser}
                onFollow={onFollowUser}
                onUnfollow={onUnfollowUser}
                onMessage={(cid) => { onNavigateToChat(cid); setUserInfoTarget(null); }}
                onViewPosts={(uid) => { onViewUserPosts(uid); setUserInfoTarget(null); }}
                posts={posts}
            />
        )}
    </div>
  );
};

export default Feed;
