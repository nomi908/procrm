import React from 'react';
import { AlertCircle, X, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false,
  variant = 'danger'
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-2 rounded-lg shrink-0",
              variant === 'danger' ? "bg-red-50 text-red-600" :
              variant === 'warning' ? "bg-amber-50 text-amber-600" :
              "bg-blue-50 text-blue-600"
            )}>
              <AlertCircle className="w-6 h-6" />
            </div>
            <p className="text-zinc-600 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="px-6 py-4 bg-zinc-50 flex gap-3">
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-zinc-200 text-zinc-600 rounded-xl hover:bg-zinc-100 font-medium disabled:opacity-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={cn(
              "flex-1 py-2 px-4 text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors",
              variant === 'danger' ? "bg-red-600 hover:bg-red-700" :
              variant === 'warning' ? "bg-amber-600 hover:bg-amber-700" :
              "bg-zinc-900 hover:bg-zinc-800"
            )}
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
