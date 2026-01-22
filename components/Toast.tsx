import React, { useEffect } from 'react';
import { ToastMessage } from '../types';
import { X, CheckCircle, Info, AlertTriangle, AlertCircle } from 'lucide-react';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success': return <CheckCircle size={20} className="text-emerald-500" />;
      case 'warning': return <AlertTriangle size={20} className="text-amber-500" />;
      case 'error': return <AlertCircle size={20} className="text-red-500" />;
      default: return <Info size={20} className="text-blue-500" />;
    }
  };

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success': return 'border-emerald-500/50';
      case 'warning': return 'border-amber-500/50';
      case 'error': return 'border-red-500/50';
      default: return 'border-blue-500/50';
    }
  };

  const handleClick = () => {
      if (toast.action) {
          toast.action();
          onDismiss(toast.id);
      }
  };

  return (
    <div 
        onClick={handleClick}
        className={`pointer-events-auto bg-slate-900 border ${getBorderColor()} text-white p-4 rounded-xl shadow-2xl flex items-start gap-3 animate-in slide-in-from-right-full duration-300 ${toast.action ? 'cursor-pointer hover:bg-slate-800' : ''}`}
    >
      <div className="shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1">
        <h4 className="font-semibold text-sm">{toast.title}</h4>
        <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{toast.message}</p>
        {toast.action && (
            <p className="text-[10px] text-slate-500 mt-2 font-bold uppercase tracking-wider">Click to View</p>
        )}
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }} 
        className="text-slate-500 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default ToastContainer;
