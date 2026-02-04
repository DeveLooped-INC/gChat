
import React, { useState } from 'react';
import { Group, UserProfile, Contact } from '../types';
import { X, Settings, Edit2, BellOff, ShieldCheck, UserMinus, Ban, Trash2 } from 'lucide-react';

interface GroupSettingsModalProps {
  group: Group;
  contacts: Contact[];
  currentUser: UserProfile;
  onClose: () => void;
  onUpdateGroup: (group: Group) => void;
  onToggleMute: (groupId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddMember: (groupId: string, contactId: string) => void;
  onKickMember: (contactId: string) => void;
  onBanMember: (contactId: string) => void;
}

const GroupSettingsModal: React.FC<GroupSettingsModalProps> = ({
  group,
  contacts,
  currentUser,
  onClose,
  onUpdateGroup,
  onToggleMute,
  onLeaveGroup,
  onDeleteGroup,
  onAddMember,
  onKickMember,
  onBanMember
}) => {
  const [localName, setLocalName] = useState(group.name);
  
  // Safe Access for Legacy Groups
  const admins = group.admins || [];
  const settings = group.settings || { allowMemberInvite: true, allowMemberNameChange: false };
  
  const isGroupAdmin = admins.includes(currentUser.id) || group.ownerId === currentUser.id;
  const isGroupOwner = group.ownerId === currentUser.id;

  const handleNameBlur = () => {
      if (localName.trim() !== group.name) {
          onUpdateGroup({ ...group, name: localName });
      }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85dvh] h-auto animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 flex-none rounded-t-2xl">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Settings size={18} /> Group Settings
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-full transition-colors">
            <X className="text-slate-400 hover:text-white" size={20} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          
          {/* Name Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Group Name</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={handleNameBlur}
                disabled={!isGroupAdmin && !settings.allowMemberNameChange}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-onion-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
              {(isGroupAdmin || settings.allowMemberNameChange) && (
                <div className="p-2 text-slate-500"><Edit2 size={16} /></div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Mute Notifications</div>
                <div className="text-xs text-slate-500">Stop receiving toasts</div>
              </div>
              <button 
                onClick={() => onToggleMute(group.id)}
                className={`w-10 h-5 rounded-full relative transition-colors ${group.isMuted ? 'bg-onion-600' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${group.isMuted ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {isGroupAdmin && (
              <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                <div>
                  <div className="text-sm font-medium text-white">Allow Invites</div>
                  <div className="text-xs text-slate-500">Members can add others</div>
                </div>
                <button 
                  onClick={() => onUpdateGroup({ 
                    ...group, 
                    settings: { ...settings, allowMemberInvite: !settings.allowMemberInvite } 
                  })}
                  className={`w-10 h-5 rounded-full relative transition-colors ${settings.allowMemberInvite ? 'bg-emerald-600' : 'bg-slate-700'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${settings.allowMemberInvite ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )}
          </div>

          {/* Members List */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Members ({group.members.length})</label>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800 max-h-48 overflow-y-auto">
              {group.members.map(memberId => {
                const isMe = memberId === currentUser.id;
                const isAdmin = admins.includes(memberId);
                const isOwner = group.ownerId === memberId;
                const contact = contacts.find(c => c.id === memberId);
                const displayName = isMe ? 'Me' : (contact?.displayName || 'Unknown');

                return (
                  <div key={memberId} className="p-3 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
                        {displayName.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm text-slate-200 flex items-center gap-1">
                          {displayName}
                          {isOwner && <ShieldCheck size={12} className="text-onion-500" />}
                          {isAdmin && !isOwner && <ShieldCheck size={12} className="text-indigo-400" />}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate w-24">
                          {memberId.substring(0, 8)}...
                        </div>
                      </div>
                    </div>
                    
                    {isGroupAdmin && !isMe && !isOwner && (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => onKickMember(memberId)}
                          className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded"
                          title="Kick Member"
                        >
                          <UserMinus size={14} />
                        </button>
                        <button 
                          onClick={() => onBanMember(memberId)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded"
                          title="Ban Member"
                        >
                          <Ban size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {(isGroupAdmin || settings.allowMemberInvite) && (
              <div className="mt-3">
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300 outline-none focus:border-onion-500 transition-colors"
                  onChange={(e) => {
                    if(e.target.value) {
                      onAddMember(group.id, e.target.value);
                      e.target.value = "";
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>+ Add Member</option>
                  {contacts
                    .filter(c => !group.members.includes(c.id))
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            {!isGroupOwner && (
                <button 
                    onClick={() => {
                        onClose();
                        onLeaveGroup(group.id);
                    }}
                    className="w-full py-3 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center gap-2 transition-colors"
                >
                    <UserMinus size={16} />
                    Leave Group
                </button>
            )}
            
            {isGroupOwner && (
                <button 
                onClick={() => {
                    if(confirm("Delete group for everyone? This action is irreversible.")) {
                        onClose();
                        onDeleteGroup(group.id);
                    }
                }}
                className="w-full py-3 rounded-xl bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/30 flex items-center justify-center gap-2 transition-colors"
                >
                    <Trash2 size={16} />
                    Delete Group (Owner)
                </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default GroupSettingsModal;
    