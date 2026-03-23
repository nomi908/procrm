/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { UserProfile } from './types';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Products } from './components/Products';
import { Invoices } from './components/Invoices';
import { Users } from './components/Users';
import { LogIn, Loader2, Mail, Lock, AlertCircle, Settings } from 'lucide-react';
import { safeFetch } from './lib/utils';
import { Setup } from './components/Setup';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  function pathToTab(pathname: string) {
    // Normalize to: "/products", "/invoices", "/dashboard", "/team"
    const normalized = pathname.replace(/\/+$/, '') || '/';
    switch (normalized) {
      case '/':
      case '/dashboard':
        return 'dashboard';
      case '/products':
        return 'products';
      case '/invoices':
        return 'invoices';
      case '/team':
      case '/users': // backwards-compat if someone used /users
        return 'users';
      default:
        return 'dashboard';
    }
  }

  const [activeTab, setActiveTab] = useState(() =>
    typeof window === 'undefined' ? 'dashboard' : pathToTab(window.location.pathname)
  );
  const [showSetup, setShowSetup] = useState(false);
  
  // Login Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Sync UI tab with the current URL (so deep links like /products work).
    const syncTabFromLocation = () => {
      setActiveTab(pathToTab(window.location.pathname));
    };

    window.addEventListener('popstate', syncTabFromLocation);
    // Run once on mount (and after login gating below, since this runs regardless).
    syncTabFromLocation();

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchProfile(currentUser.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      window.removeEventListener('popstate', syncTabFromLocation);
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', uid)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Profile doesn't exist, create it
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const newProfile: UserProfile = {
              uid: user.id,
              email: user.email || '',
              displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
              role: 'viewer', // Default role, only backend should elevate
              createdAt: new Date().toISOString(),
            };
            const { error: insertError } = await supabase
              .from('profiles')
              .insert([newProfile]);
            
            if (insertError) throw insertError;
            setProfile(newProfile);
          }
        } else if (error.message.includes("Could not find the table 'public.profiles'")) {
          setError("Database tables are missing. Please run the SQL setup script in your project dashboard.");
          setLoading(false);
          return;
        } else {
          throw error;
        }
      } else {
        setProfile(data as UserProfile);
      }
    } catch (err: any) {
      console.error('Error fetching profile:', err);
      setError(err.message || 'Failed to load user profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginLoading(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => supabase.auth.signOut();

  const isConfigured = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-4">
        {showSetup ? (
          <Setup onBack={() => setShowSetup(false)} />
        ) : (
          <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
            <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <LogIn className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-zinc-900 text-center mb-2">Javed Sanitary Login</h1>
            <p className="text-zinc-500 text-center mb-8">Sign in to your account</p>

            {!isConfigured && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-xl">
                <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-1">
                  <AlertCircle className="w-4 h-4" />
                  Configuration Required
                </div>
                <p className="text-xs text-amber-600">
                  Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables to enable authentication.
                </p>
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-red-600 text-sm font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-10 pr-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading || !isConfigured}
                className="w-full py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loginLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign In
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-zinc-100 text-center">
              <button 
                onClick={() => setShowSetup(true)}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-900 transition-colors flex items-center justify-center gap-1.5 mx-auto"
              >
                <Settings className="w-3 h-3" />
                System Setup
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Layout 
      profile={profile} 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      onLogout={handleLogout}
    >
      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'products' && <Products profile={profile} />}
      {activeTab === 'invoices' && <Invoices profile={profile} />}
      {activeTab === 'users' && profile.role === 'admin' && <Users profile={profile} />}
      {activeTab === 'users' && profile.role !== 'admin' && <Dashboard />}
    </Layout>
  );
}

