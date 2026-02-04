import React from 'react';
import { X, BookOpen, Shield, MessageSquare, Users, Settings, Scan, Globe } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
          <div className="flex items-center space-x-2">
            <BookOpen className="text-onion-400" size={20} />
            <h2 className="text-lg font-bold text-white">gChat Node Manual</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 text-slate-300">

          <section className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Globe className="text-blue-400" size={20} />
              1. Browser-Based Architecture
            </h3>
            <p>
              gChat runs as a local web server on your device.
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-400 ml-2">
              <li><strong>Localhost Only:</strong> The interface runs at <code>http://localhost:3000</code>. It is NOT accessible from the internet, only from your device.</li>
              <li><strong>Real Tor:</strong> A background process manages the Tor connection. Do not close the terminal window running <code>npm start</code>.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Shield className="text-emerald-500" size={20} />
              2. Strict Privacy Mode
            </h3>
            <div className="bg-emerald-900/20 border border-emerald-800 p-4 rounded-lg">
              <p className="text-sm text-emerald-100 mb-2"><strong>Default Policy:</strong> Your node acts as a fortress.</p>
              <ul className="list-disc list-inside space-y-1 text-xs text-emerald-300">
                <li><strong>Unknowns Blocked:</strong> Direct messages from strangers are automatically dropped.</li>
                <li><strong>Trusted Relay:</strong> If a friend shares a post from a stranger, your node downloads the media <em>through</em> your friend (Proxy), keeping your IP hidden from the stranger.</li>
              </ul>
            </div>
            <p className="text-sm mt-2 text-slate-400">
              Your "Account" is a locally generated Ed25519 keypair. Identity is pseudonymous.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Scan className="text-onion-400" size={20} />
              3. Connecting Peers
            </h3>
            <p>
              Because there is no central server, you must exchange addresses to connect.
            </p>
            <div className="grid grid-cols-2 gap-4 my-2">
              <div className="bg-slate-800 p-3 rounded">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="font-bold text-white text-sm">Green Dot</span>
                </div>
                <p className="text-xs text-slate-400">Peer is Online & Verified.</p>
              </div>
              <div className="bg-slate-800 p-3 rounded">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-slate-500"></div>
                  <span className="font-bold text-slate-300 text-sm">Gray Dot</span>
                </div>
                <p className="text-xs text-slate-400">Peer is Offline.</p>
              </div>
            </div>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-400 ml-2">
              <li><strong>Mobile Scan:</strong> Scan a friend's QR code to auto-add them.</li>
              <li><strong>Invite Links:</strong> Share your deep link to connect instantly.</li>
              <li><strong>Avatar Sync:</strong> Profile pictures update automatically when you connect.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <MessageSquare className="text-indigo-400" size={20} />
              4. Secure Chat & Media
            </h3>
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
              <h4 className="font-bold text-white text-sm mb-2">Features:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-400">
                <li><strong>E2E Encryption:</strong> Using NaCl (ChaCha20-Poly1305).</li>
                <li><strong>Mesh Recovery:</strong> If a media file fails to load, gChat queries your Trusted Peers (Friends) to find a copy.</li>
                <li><strong>Ephemeral Mode:</strong> Messages auto-delete after reading.</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="text-slate-400" size={20} />
              5. Node Management
            </h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-400 ml-2">
              <li><strong>Export Keys:</strong> Download your private key. If you clear browser data, this is your ONLY backup.</li>
              <li><strong>Graceful Shutdown:</strong> When you exit, the app waits up to <strong>30s</strong> for peers to acknowledge your departure. Please wait for the "Server Exited" screen.</li>
            </ul>
          </section>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 text-center">
          <p className="text-xs text-slate-500 font-mono">gChat v1.4.0 • Powered by Tor</p>
        </div>

      </div>
    </div>
  );
};

export default HelpModal;