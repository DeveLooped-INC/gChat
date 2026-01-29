
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
  const [privacy, setPrivacy] = useState<'public' | 'friends'>('public');
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
  }, [initialState, posts, onConsumeInitialState, addToast]);

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
                          <p className="text-sm text-slate-200 whitespace-pre-wrap">{comment.content}</p>
                          
                          <div className="flex items-center gap-3 mt-2">
                              <div className="flex items-center gap-1 bg-slate-800 rounded-full px-2 py-0.5">
                                  <button onClick={() => onCommentVote(postId, comment.id, 'up')} disabled={isMyComment} className={`hover:text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-500'}`}><ThumbsUp size={12} /></button>
                                  <span className={`text-[10px] ${upVotes > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{upVotes || 0}</span>
                                  <div className="w-px h-3 bg-slate-700 mx-1"></div>
                                  <button onClick={() => onCommentVote(postId, comment.id, 'down')} disabled={isMyComment} className={`hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'down' ? 'text-red-400' : 'text-slate-500'}`}><ThumbsDown size={12} /></button>
                              </div>
                              <button onClick={() => setReplyingTo({postId, commentId: comment.id})} className="text-xs text-slate-500 hover:text-white flex items-center gap-1">
                                  <MessageCircle size={12} /> Reply
                              </button>
                              <div className="flex gap-1">
                                  {SOCIAL_REACTIONS.slice(0, 3).map(emoji => (
                                      <button key={emoji} onClick={() => onCommentReaction(postId, comment.id, emoji)} disabled={isMyComment} className="text-[10px] hover:scale-125 transition-transform opacity-50 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed">{emoji}</button>
                                  ))}
                              </div>
                          </div>
                          {reactionEntries.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                  {reactionEntries.map(([emoji, users]) => users.length > 0 && (
                                      <span key={emoji} className="bg-slate-800 text-[10px] px-1.5 rounded-full text-slate-400 border border-slate-700">{emoji} {users.length}</span>
                                  ))}
                              </div>
                          )}
                      </div>
                      {comment.replies && comment.replies.length > 0 && (
                          <div className="mt-1">
                              {comment.replies.map(reply => (
                                  <RecursiveComment key={reply.id} comment={reply} postId={postId} depth={depth + 1} />
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  };

  return (
    <div className="h-full overflow-y-auto w-full max-w-2xl mx-auto p-4 md:p-8 space-y-6 pb-20 relative">
        {/* Header / Filter Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-2">
                {viewingPost ? (
                    <button onClick={() => setViewingPost(null)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft size={20} /> Back to Feed
                    </button>
                ) : (
                    <>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Globe className="text-onion-500" />
                        {selectedAuthorId ? 'User Feed' : (feedFilter === 'public' ? 'Global Mesh' : 'Friends Circle')}
                    </h2>
                    {selectedAuthorId && (
                        <button onClick={() => setSelectedAuthorId(null)} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded hover:text-white"><X size={12} /></button>
                    )}
                    </>
                )}
            </div>
            
            {!viewingPost && (
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <button onClick={() => setShowBroadcastModal(true)} className="flex-1 md:flex-none bg-onion-600 hover:bg-onion-500 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-onion-900/20">
                        <Radio size={18} /> Broadcast
                    </button>
                    <button onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-lg border ${showFilters ? 'bg-slate-800 border-onion-500 text-onion-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'}`}>
                        <Filter size={20} />
                    </button>
                    <button onClick={onGlobalSync} className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-emerald-400" title="Sync">
                        <RefreshCw size={20} />
                    </button>
                </div>
            )}
        </div>

        {/* Filters Panel */}
        {showFilters && !viewingPost && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4 animate-in slide-in-from-top-2">
                <div className="flex gap-2">
                    <button onClick={() => setFeedFilter('public')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${feedFilter === 'public' ? 'bg-onion-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>Public Mesh</button>
                    <button onClick={() => setFeedFilter('friends')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${feedFilter === 'friends' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>Friends Only</button>
                </div>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                    <Search size={16} className="text-slate-500" />
                    <input type="text" placeholder="Search topics or tags..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent border-none outline-none text-white text-sm w-full placeholder-slate-600" />
                </div>
                <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-500">Sort by:</span>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="bg-slate-950 border border-slate-800 text-white rounded px-2 py-1 outline-none focus:border-onion-500">
                            <option value="recent">Recent</option>
                            <option value="likes">Top Rated</option>
                        </select>
                    </div>
                </div>
            </div>
        )}

        {/* Broadcast Modal */}
        {showBroadcastModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 rounded-t-2xl">
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <Radio size={18} className="text-onion-500" />
                            {sharingPost ? 'Share Broadcast' : 'New Broadcast'}
                        </h3>
                        <button onClick={() => { setShowBroadcastModal(false); resetPostForm(); }} className="text-slate-400 hover:text-white"><X size={20} /></button>
                    </div>
                    
                    <div className="p-4 overflow-y-auto space-y-4">
                        <div className="flex gap-2 mb-2">
                            <button onClick={() => setPrivacy('public')} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors flex items-center justify-center gap-2 ${privacy === 'public' ? 'bg-onion-900/20 border-onion-500 text-onion-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                                <Globe size={16} /> Public
                            </button>
                            <button onClick={() => setPrivacy('friends')} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors flex items-center justify-center gap-2 ${privacy === 'friends' ? 'bg-indigo-900/20 border-indigo-500 text-indigo-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                                <Users size={16} /> Friends
                            </button>
                        </div>

                        {/* Shared Post Preview */}
                        {sharingPost && (
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 opacity-80 pointer-events-none">
                                <div className="flex items-center gap-2 mb-2">
                                    <Quote size={12} className="text-slate-500" />
                                    <span className="text-xs font-bold text-slate-400">Replying to {sharingPost.authorName}</span>
                                </div>
                                <p className="text-sm text-slate-300 line-clamp-2">{sharingPost.content}</p>
                            </div>
                        )}

                        <textarea 
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="What's happening on the mesh?"
                            className="w-full h-32 bg-slate-950 border border-slate-800 rounded-xl p-4 text-white resize-none focus:outline-none focus:border-onion-500 transition-colors"
                        />

                        {/* Media Preview */}
                        {attachedImage && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black">
                                <img src={attachedImage} alt="Preview" className="max-h-48 w-full object-contain" />
                                <button onClick={() => setAttachedImage(null)} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full hover:bg-red-600 transition-colors"><X size={16}/></button>
                            </div>
                        )}
                        {attachedMedia && (
                            <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-3 flex items-center gap-3">
                                {attachedMedia.type === 'audio' ? <Mic size={24} className="text-onion-400" /> : <Video size={24} className="text-blue-400" />}
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-white">{attachedMedia.type === 'audio' ? 'Audio Clip' : 'Video Clip'}</p>
                                    <p className="text-xs text-slate-500">{formatBytes(attachedMedia.size)}</p>
                                </div>
                                <button onClick={() => setAttachedMedia(null)} className="text-slate-500 hover:text-red-400"><Trash2 size={18}/></button>
                            </div>
                        )}

                        {/* Tools */}
                        {!recordingMode ? (
                            <div className="flex gap-2">
                                <button onClick={() => setShowCamera(true)} className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors" title="Photo"><CameraIcon size={20} /></button>
                                <button onClick={() => setRecordingMode('video')} className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors" title="Video"><Video size={20} /></button>
                                <button onClick={() => setRecordingMode('audio')} className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors" title="Audio"><Mic size={20} /></button>
                                <button onClick={triggerFileSelect} className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors" title="File"><FileText size={20} /></button>
                                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                            </div>
                        ) : (
                            <MediaRecorder type={recordingMode} maxDuration={MAX_POST_MEDIA_DURATION} onCapture={handleMediaCapture} onCancel={() => setRecordingMode(null)} />
                        )}
                        
                        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                            <MapPin size={16} className="text-slate-500" />
                            <input type="text" placeholder="Add location (optional)" value={postLocation} onChange={(e) => setPostLocation(e.target.value)} className="bg-transparent border-none outline-none text-white text-sm w-full placeholder-slate-600" />
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-800 bg-slate-950/50 rounded-b-2xl">
                        <button onClick={handlePostSubmit} disabled={isProcessing || (!content.trim() && !attachedImage && !attachedMedia && !sharingPost)} className="w-full bg-onion-600 hover:bg-onion-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            {isProcessing ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                            {sharingPost ? 'Share Now' : 'Broadcast Now'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Post List */}
        <div className="space-y-6">
            {displayedPosts.length === 0 && (
                <div className="text-center py-20 text-slate-500">
                    <Globe size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No broadcasts found.</p>
                    <p className="text-sm mt-2">Connect with peers or adjust filters.</p>
                </div>
            )}

            {displayedPosts.map(post => {
                const isExpanded = expandedPostId === post.id;
                const isHidden = hiddenOverrideIds.has(post.id);
                const isEdited = post.isEdited;
                const upVotes = Object.values(post.votes).filter(v => v === 'up').length;
                const downVotes = Object.values(post.votes).filter(v => v === 'down').length;
                const myVote = post.votes[user.id];
                const commentCount = post.comments;
                const { handle, suffix } = formatUserIdentity(post.authorName);
                const isMine = post.authorId === user.id;
                const isMenuOpen = activeMenuId === post.id;
                const isEditing = editingPostId === post.id;
                const isReactionPickerOpen = activeReactionPicker?.postId === post.id && !activeReactionPicker.commentId;

                if (isHidden) return (
                    <div key={post.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex justify-between items-center opacity-70">
                        <span className="text-sm text-slate-500 italic">Post hidden</span>
                        <button onClick={() => toggleHide(post.id)} className="text-xs text-onion-400 hover:underline">Show</button>
                    </div>
                );

                return (
                    <div key={post.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 shadow-lg group">
                        {/* Header */}
                        <div className="p-4 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                {post.authorAvatar ? (
                                    <img src={post.authorAvatar} onClick={() => openUserInfo(post)} alt={post.authorName} className="w-10 h-10 rounded-full bg-slate-800 object-cover border border-slate-700 cursor-pointer" />
                                ) : (
                                    <div onClick={() => openUserInfo(post)} className="w-10 h-10 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-white font-bold cursor-pointer shadow-inner">
                                        {handle.charAt(0)}
                                    </div>
                                )}
                                <div>
                                    <h3 onClick={() => openUserInfo(post)} className="font-bold text-slate-200 cursor-pointer hover:underline flex items-center gap-1">
                                        {handle}
                                        <span className="text-slate-500 font-mono text-xs font-normal opacity-70">{suffix}</span>
                                    </h3>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <span>{new Date(post.timestamp).toLocaleDateString()}</span>
                                        <span>•</span>
                                        {post.privacy === 'public' ? <Globe size={12} /> : <Users size={12} />}
                                        {post.location && (
                                            <>
                                                <span>•</span>
                                                <span className="flex items-center gap-1"><MapPin size={10} /> {post.location}</span>
                                            </>
                                        )}
                                        {isEdited && <span className="italic ml-1">(edited)</span>}
                                        {post.isOrphaned && <span className="text-amber-500 flex items-center gap-1 ml-1"><Link2Off size={10} /> Orphaned</span>}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="relative">
                                <button onClick={(e) => handleMenuClick(e, post.id)} className="text-slate-500 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors">
                                    <MoreHorizontal size={20} />
                                </button>
                                {isMenuOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-10 overflow-hidden animate-in zoom-in-95">
                                        <button onClick={() => toggleHide(post.id)} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"><Eye size={16} /> Hide</button>
                                        {isMine && <button onClick={() => startEditing(post)} className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"><Edit2 size={16} /> Edit</button>}
                                        {isMine && <button onClick={() => handleDelete(post.id)} className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-slate-800 hover:text-red-300 flex items-center gap-2"><Trash2 size={16} /> Delete</button>}
                                        <button onClick={() => handleVerifyHash(post)} className="w-full text-left px-4 py-3 text-sm text-emerald-400 hover:bg-slate-800 hover:text-emerald-300 flex items-center gap-2 border-t border-slate-800"><ShieldCheck size={16} /> Verify Integrity</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="px-4 pb-2">
                            {isEditing ? (
                                <div className="space-y-2">
                                    <textarea value={editContentText} onChange={(e) => setEditContentText(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-onion-500 min-h-[100px]" />
                                    <div className="flex justify-end gap-2">
                                        <button onClick={cancelEditing} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancel</button>
                                        <button onClick={() => saveEditing(post.id)} className="px-3 py-1.5 bg-onion-600 rounded text-xs text-white font-bold hover:bg-onion-500">Save</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                                    {post.hashtags && post.hashtags.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {post.hashtags.map(tag => (
                                                <span key={tag} className="text-onion-400 text-sm hover:underline cursor-pointer">#{tag}</span>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Attachments */}
                        {post.imageUrl && (
                            <div className="mt-2 w-full bg-black max-h-96 overflow-hidden flex items-center justify-center cursor-pointer" onClick={() => window.open(post.imageUrl, '_blank')}>
                                <img src={post.imageUrl} alt="Post content" className="w-full h-full object-contain" />
                            </div>
                        )}
                        {post.media && (
                            <div className="mt-2 px-4">
                                <MediaPlayer media={post.media} peerId={user.homeNodeOnion} autoPlay={false} onNotification={addToast} />
                            </div>
                        )}

                        {/* Shared Post Embedding */}
                        {post.sharedPostId && (
                            <div className="mx-4 mt-2 p-3 bg-slate-950 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 transition-colors" onClick={() => handleViewSharedPost(post)}>
                                {post.sharedPostSnapshot ? (
                                    <>
                                        <div className="flex items-center gap-2 mb-1">
                                            <Quote size={14} className="text-slate-500" />
                                            <span className="text-sm font-bold text-slate-300">{formatUserIdentity(post.sharedPostSnapshot.authorName).handle}</span>
                                            <span className="text-xs text-slate-600">• {new Date(post.sharedPostSnapshot.timestamp).toLocaleDateString()}</span>
                                        </div>
                                        <p className="text-sm text-slate-400 line-clamp-3">{post.sharedPostSnapshot.content}</p>
                                        {post.sharedPostSnapshot.imageUrl && <div className="mt-2 h-32 rounded bg-slate-900 overflow-hidden"><img src={post.sharedPostSnapshot.imageUrl} className="w-full h-full object-cover opacity-50" /></div>}
                                    </>
                                ) : (
                                    <div className="flex items-center justify-center py-4 text-slate-600 gap-2"><Link2Off size={16} /><span>Original post unavailable</span></div>
                                )}
                            </div>
                        )}

                        {/* Actions Bar */}
                        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between mt-2">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1 bg-slate-950 rounded-full px-3 py-1.5 border border-slate-800">
                                    <button onClick={() => onLike(post.id)} disabled={isMine} className={`hover:text-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'up' ? 'text-emerald-400' : 'text-slate-500'}`}><ThumbsUp size={18} /></button>
                                    <span className={`text-sm font-medium ${upVotes > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{upVotes || 0}</span>
                                    <div className="w-px h-4 bg-slate-800 mx-2"></div>
                                    <button onClick={() => onDislike(post.id)} disabled={isMine} className={`hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myVote === 'down' ? 'text-red-400' : 'text-slate-500'}`}><ThumbsDown size={18} /></button>
                                </div>

                                <button onClick={() => toggleComments(post.id)} className={`flex items-center gap-2 text-sm transition-colors ${isExpanded ? 'text-onion-400' : 'text-slate-500 hover:text-white'}`}>
                                    <MessageCircle size={18} />
                                    <span>{commentCount}</span>
                                </button>

                                <button onClick={() => onShare(post.id)} className="text-slate-500 hover:text-blue-400 transition-colors" title="Share"><Repeat size={18} /></button>
                            </div>

                            {/* Reactions */}
                            <div className="relative">
                                <div className="flex items-center gap-2">
                                    {Object.entries(post.reactions || {}).map(([emoji, users]) => users.length > 0 && (
                                        <span key={emoji} onClick={() => !isMine && onPostReaction(post.id, emoji)} className={`text-xs px-2 py-1 rounded-full border transition-all ${users.includes(user.id) ? 'bg-onion-900/30 border-onion-500/50 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'} ${isMine ? 'cursor-default' : 'cursor-pointer hover:bg-slate-800'}`}>{emoji} {users.length}</span>
                                    ))}
                                    <button onClick={(e) => { e.stopPropagation(); setActiveReactionPicker({postId: post.id}); }} disabled={isMine} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isMine ? 'text-slate-700 cursor-not-allowed' : 'text-slate-500 hover:bg-slate-800 hover:text-yellow-400'}`}><Smile size={18} /></button>
                                </div>
                                {isReactionPickerOpen && (
                                    <div className="absolute bottom-full right-0 mb-2 bg-slate-900 border border-slate-700 rounded-full shadow-xl flex p-1 z-50 gap-1 animate-in zoom-in-95">
                                        {SOCIAL_REACTIONS.map(emoji => (
                                            <button key={emoji} onClick={() => { onPostReaction(post.id, emoji); setActiveReactionPicker(null); }} className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 rounded-full text-lg transition-transform hover:scale-125">{emoji}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Comments Section */}
                        {isExpanded && (
                            <div className="bg-slate-950 border-t border-slate-800 p-4 animate-in slide-in-from-top-2">
                                {/* Comment Input */}
                                <div className="flex gap-3 mb-6">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">{user.displayName.charAt(0)}</div>
                                    <div className="flex-1">
                                        {replyingTo && replyingTo.postId === post.id && (
                                            <div className="flex justify-between items-center bg-slate-900 border border-slate-800 rounded-t-lg px-3 py-1.5 text-xs">
                                                <span className="text-onion-400 font-bold">Replying to comment...</span>
                                                <button onClick={() => setReplyingTo(null)} className="text-slate-500 hover:text-white"><X size={14} /></button>
                                            </div>
                                        )}
                                        <div className={`flex items-center gap-2 bg-slate-900 border border-slate-800 ${replyingTo?.postId === post.id ? 'rounded-b-lg border-t-0' : 'rounded-lg'} px-3 py-2 focus-within:border-onion-500 transition-colors`}>
                                            <input 
                                                type="text" 
                                                placeholder="Write a secure comment..." 
                                                value={commentText} 
                                                onChange={(e) => setCommentText(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment(post.id)}
                                                className="bg-transparent border-none outline-none text-sm text-white w-full placeholder-slate-600"
                                            />
                                            <button onClick={() => handleSubmitComment(post.id)} disabled={!commentText.trim()} className="text-onion-500 hover:text-onion-400 disabled:opacity-50 disabled:cursor-not-allowed"><Send size={16} /></button>
                                        </div>
                                    </div>
                                </div>

                                {/* Comments List */}
                                <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                                    {post.commentsList && post.commentsList.length > 0 ? (
                                        post.commentsList.map(comment => (
                                            <RecursiveComment key={comment.id} comment={comment} postId={post.id} />
                                        ))
                                    ) : (
                                        <div className="text-center text-slate-600 py-4 text-sm italic">No comments yet. Be the first to verify this block.</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            
            {hasMorePosts && (
                <div className="flex justify-center pt-6">
                    <button onClick={() => setVisiblePostsCount(prev => prev + 10)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-2 rounded-full text-sm font-bold transition-colors shadow-lg">Load More Broadcasts</button>
                </div>
            )}
        </div>

        {/* Floating Scroll Top (Hidden for now, maybe add later) */}
        
        {/* Modals */}
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
                onMessage={(id) => { onNavigateToChat(id); setUserInfoTarget(null); }}
                onViewPosts={(id) => { onViewUserPosts(id); setUserInfoTarget(null); }}
                posts={posts}
            />
        )}
    </div>
  );
};

export default Feed;
