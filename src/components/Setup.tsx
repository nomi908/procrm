import React, { useState } from 'react';
import { Shield, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { safeFetch } from '../lib/utils';

interface SetupProps {
  onBack: () => void;
}

export function Setup({ onBack }: SetupProps) {
  const [bootstrapKey, setBootstrapKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const response = await safeFetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapKey })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Bootstrap failed');

      setSuccess(true);
    } catch (err: any) {
      console.error('Bootstrap error:', err);
      setError(err.message || 'An error occurred during bootstrap.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-8 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-semibold text-zinc-900 mb-2">System Bootstrapped!</h1>
        <p className="text-zinc-500 mb-8">
          The initial admin account has been created. You can now sign in with the default credentials.
        </p>
        <div className="bg-zinc-50 p-4 rounded-xl text-left mb-8 space-y-2">
          <p className="text-[10px] text-zinc-400 mt-2 italic">
            * These can be customized via INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables.
          </p>
        </div>
        <button
          onClick={onBack}
          className="w-full py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-all"
        >
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors mb-6 text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Login
      </button>

      <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Shield className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-2xl font-semibold text-zinc-900 text-center mb-2">System Setup</h1>
      <p className="text-zinc-500 text-center mb-8">Initialize the administrative account</p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm font-medium">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <form onSubmit={handleBootstrap} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-700">Bootstrap Key</label>
          <input
            required
            type="password"
            value={bootstrapKey}
            onChange={(e) => setBootstrapKey(e.target.value)}
            placeholder="Enter your ADMIN_BOOTSTRAP_KEY"
            className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
          />
          <p className="text-[10px] text-zinc-400 mt-1">
            This key must match the <strong>ADMIN_BOOTSTRAP_KEY</strong> set in your environment variables.
          </p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Initialize System
        </button>
      </form>
    </div>
  );
}
