import React from 'react';
import { HardDrive, FileArchive, Download, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';

export interface BackupTabProps {
    migrationPassword: string | null;
    isMigrating: boolean;
    passwordCopied: boolean;
    handleMigrateUser: () => void;
    copyPassword: () => void;
    handleFactoryReset: () => void;
}

const BackupTab: React.FC<BackupTabProps> = ({
    migrationPassword, isMigrating, passwordCopied, handleMigrateUser, copyPassword, handleFactoryReset
}) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            {/* Data Migration */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-2">
                    <HardDrive className="text-indigo-400" size={24} />
                    <h2 className="text-lg font-bold text-white">Data Migration</h2>
                </div>
                <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-6 text-center">
                    <FileArchive className="mx-auto text-indigo-400 mb-3" size={48} />
                    <h3 className="text-white font-bold mb-2">Create Encrypted Backup</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
                        Export your entire node state, including keys, contacts, and history.
                        The backup is encrypted with a generated password.
                    </p>

                    {migrationPassword ? (
                        <div className="bg-slate-900 p-4 rounded-xl border border-indigo-500 max-w-xs mx-auto animate-in zoom-in-95">
                            <p className="text-xs text-indigo-400 uppercase font-bold mb-2">Backup Password (Save This!)</p>
                            <div className="flex items-center justify-between bg-black/50 p-2 rounded border border-slate-700 mb-3">
                                <code className="text-white font-mono text-sm">{migrationPassword}</code>
                                <button onClick={copyPassword} className="text-slate-400 hover:text-white"><Copy size={16} /></button>
                            </div>
                            <div className="text-xs text-green-400 flex items-center justify-center gap-1">
                                <Check size={12} /> File Downloaded
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={handleMigrateUser}
                            disabled={isMigrating}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 mx-auto transition-colors disabled:opacity-50"
                        >
                            {isMigrating ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                            <span>Generate Backup</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-red-950/20 rounded-xl border border-red-900/50 p-6">
                <div className="flex items-center space-x-3 mb-6 border-b border-red-900/30 pb-2">
                    <AlertTriangle className="text-red-500" size={24} />
                    <h2 className="text-lg font-bold text-red-500">Danger Zone</h2>
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-white font-bold">Factory Reset Node</h3>
                        <p className="text-red-400/70 text-sm">Wipes all data, keys, and identity. Irreversible.</p>
                    </div>
                    <button
                        onClick={handleFactoryReset}
                        className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                    >
                        Reset Everything
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BackupTab;
