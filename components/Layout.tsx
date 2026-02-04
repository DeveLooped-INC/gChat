
import React from 'react';
import { 
  MessageSquare, 
  Globe, 
  Users, 
  Settings, 
  ShieldCheck, 
  Menu,
  X,
  WifiOff,
  HelpCircle,
  Bell
} from 'lucide-react';
import { AppRoute, UserProfile } from '../types';
import { formatUserIdentity } from '../utils';

interface LayoutProps {
  children: React.ReactNode;
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onToggleHelp: () => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  user: UserProfile;
  isOnline: boolean;
  chatUnreadCount?: number;
  contactsUnreadCount?: number;
  feedUnreadCount?: number;
  settingsUnreadCount?: number;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeRoute, 
  onNavigate, 
  onToggleHelp, 
  onLogout, 
  onOpenProfile, 
  user, 
  isOnline, 
  chatUnreadCount = 0, 
  contactsUnreadCount = 0,
  feedUnreadCount = 0,
  settingsUnreadCount = 0
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const { handle, suffix } = formatUserIdentity(user.username);

  const NavItem = ({ route, icon: Icon, label, count }: { route: AppRoute; icon: any; label: string; count?: number }) => (
    <button
      onClick={() => {
        onNavigate(route);
        setMobileMenuOpen(false);
      }}
      className={`flex items-center justify-between w-full p-3 rounded-lg transition-all duration-200 ${
        activeRoute === route 
          ? 'bg-onion-600/20 text-onion-400 border border-onion-600/30' 
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
      }`}
    >
      <div className="flex items-center space-x-3">
        <Icon size={20} />
        <span className="font-medium">{label}</span>
      </div>
      {count !== undefined && count > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {count > 99 ? '99+' : count}
          </span>
      )}
    </button>
  );

  return (
    <div className="flex h-[100dvh] bg-slate-950 overflow-hidden font-sans text-slate-200">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 flex-col bg-slate-900 border-r border-slate-800">
        <div className="p-6 flex items-center space-x-3">
          <div className="w-8 h-8 bg-onion-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(217,70,239,0.3)]">
            <ShieldCheck className="text-white" size={20} />
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">gChat</h1>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <div className="text-xs font-bold text-slate-500 uppercase px-3 py-2">Menu</div>
          <NavItem route={AppRoute.FEED} icon={Globe} label="Social Feed" count={feedUnreadCount} />
          <NavItem route={AppRoute.CHAT} icon={MessageSquare} label="Chats" count={chatUnreadCount} />
          <NavItem route={AppRoute.CONTACTS} icon={Users} label="My Contacts" count={contactsUnreadCount} />
          <NavItem route={AppRoute.NOTIFICATIONS} icon={Bell} label="Notifications" />
          <NavItem route={AppRoute.NODE_SETTINGS} icon={Settings} label="Settings" count={settingsUnreadCount} />

          <div className="pt-4 mt-auto">
            <button
              onClick={onToggleHelp}
              className="flex items-center space-x-3 w-full p-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-emerald-400 transition-all duration-200"
            >
              <HelpCircle size={20} />
              <span className="font-medium">Help & Manual</span>
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
          <div 
            onClick={onOpenProfile}
            className="flex items-center space-x-3 cursor-pointer hover:bg-slate-800/50 p-2 rounded-lg transition-colors -mx-2"
          >
             {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="User" className="w-10 h-10 rounded-full bg-slate-800 object-cover shadow-lg border border-slate-700" />
             ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-onion-400 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg">
                  {handle.charAt(0)}
                </div>
             )}
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{handle}</p>
              <div className="flex items-center gap-1">
                 {user.isAdmin && <ShieldCheck size={10} className="text-onion-400" />}
                 <p className="text-xs text-slate-500 truncate font-mono">{suffix}</p>
              </div>
            </div>
          </div>
          <div className={`mt-3 flex items-center space-x-2 text-xs px-2 py-1 rounded-full w-fit transition-colors ${
            isOnline 
              ? 'text-emerald-400 bg-emerald-400/10' 
              : 'text-red-400 bg-red-400/10'
          }`}>
            {isOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Node Online</span>
              </>
            ) : (
              <>
                <WifiOff size={10} />
                <span>Node Offline</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-onion-500 rounded-lg flex items-center justify-center">
            <ShieldCheck className="text-white" size={18} />
          </div>
          <span className="font-bold text-lg">gChat</span>
        </div>
        <div className="flex items-center space-x-4">
             {chatUnreadCount > 0 && (
                <div className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                </div>
             )}
             {feedUnreadCount > 0 && (
                <div className="bg-onion-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {feedUnreadCount > 99 ? '99+' : feedUnreadCount}
                </div>
             )}
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-slate-400 hover:text-white"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-950 z-40 md:hidden pt-20 px-4">
          <nav className="space-y-4">
            <div className="text-xs font-bold text-slate-500 uppercase px-2">Menu</div>
            <NavItem route={AppRoute.FEED} icon={Globe} label="Social Feed" count={feedUnreadCount} />
            <NavItem route={AppRoute.CHAT} icon={MessageSquare} label="Chats" count={chatUnreadCount} />
            <NavItem route={AppRoute.CONTACTS} icon={Users} label="Contacts" count={contactsUnreadCount} />
            <NavItem route={AppRoute.NOTIFICATIONS} icon={Bell} label="Notifications" />
            <NavItem route={AppRoute.NODE_SETTINGS} icon={Settings} label="Settings" count={settingsUnreadCount} />
            
            <div className="border-t border-slate-800 pt-4 mt-4 space-y-4">
                <button
                onClick={() => {
                    onOpenProfile();
                    setMobileMenuOpen(false);
                }}
                className="flex items-center space-x-3 w-full p-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-indigo-400 transition-all duration-200"
                >
                <Users size={20} />
                <span className="font-medium">My Profile</span>
                </button>
                <button
                onClick={() => {
                    onToggleHelp();
                    setMobileMenuOpen(false);
                }}
                className="flex items-center space-x-3 w-full p-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-emerald-400 transition-all duration-200"
                >
                <HelpCircle size={20} />
                <span className="font-medium">Help & Manual</span>
                </button>
            </div>
          </nav>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden md:pt-0 pt-16 relative">
        <div className="w-full h-full max-w-5xl mx-auto flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
