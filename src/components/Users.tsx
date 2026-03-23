import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile, UserRole } from '../types';
import { cn } from '../lib/utils';
import { 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  Search, 
  Plus,
  X,
  Loader2,
  Mail,
  Lock,
  UserPlus,
  Clock,
  Trash2
} from 'lucide-react';
import { safeFetch } from '../lib/utils';

interface UsersProps {
  profile: UserProfile;
}

export function Users({ profile }: UsersProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleLoading, setRoleLoading] = useState<string | null>(null);
  
  // Add User State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('viewer');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const isAdmin = profile.role === 'admin';

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('createdAt', { ascending: false });
        
        if (error) throw error;
        if (data) setUsers(data as UserProfile[]);
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();

    const subscription = supabase
      .channel('profiles-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setUsers(prev => [payload.new as UserProfile, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setUsers(prev => prev.map(u => u.uid === payload.new.uid ? payload.new as UserProfile : u));
        } else if (payload.eventType === 'DELETE') {
          setUsers(prev => prev.filter(u => u.uid !== payload.old.uid));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || addLoading) return;
    setAddError('');
    setEmailError(false);

    // Validation
    if (!newDisplayName.trim()) {
      setAddError('Full name is required.');
      return;
    }
    if (!newEmail.trim() || !validateEmail(newEmail)) {
      setAddError('A valid email address is required.');
      setEmailError(true);
      return;
    }
    if (newPassword.length < 6) {
      setAddError('Password must be at least 6 characters.');
      return;
    }

    setAddLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;
      
      if (!idToken) throw new Error('Not authenticated');

      const response = await safeFetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          displayName: newDisplayName,
          role: newRole
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create user');

      // Manually add user to state as fallback for real-time
      const newUser: UserProfile = {
        uid: result.uid,
        email: newEmail,
        displayName: newDisplayName,
        role: newRole,
        createdAt: new Date().toISOString()
      };
      setUsers(prev => [newUser, ...prev]);

      setShowAddModal(false);
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('viewer');
    } catch (error: any) {
      console.error('Error adding user:', error);
      setAddError(error.message);
    } finally {
      setAddLoading(false);
    }
  };

  const updateRole = async (userId: string, role: UserRole) => {
    if (!isAdmin || roleLoading) return;
    setRoleLoading(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;
      
      if (!idToken) throw new Error('Not authenticated');

      const response = await safeFetch('/api/admin/update-role', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ userId, role })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update role');

      // Manually update role in state as fallback for real-time
      setUsers(prev => prev.map(u => u.uid === userId ? { ...u, role } : u));
    } catch (error: any) {
      console.error('Error updating role:', error);
    } finally {
      setRoleLoading(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!isAdmin || deleteLoading) return;

    setDeleteLoading(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;
      
      if (!idToken) throw new Error('Not authenticated');

      const response = await safeFetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ userId })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete user');

      // Manually remove user from state as fallback for real-time
      setUsers(prev => prev.filter(u => u.uid !== userId));
    } catch (error: any) {
      console.error('Error deleting user:', error);
    } finally {
      setDeleteLoading(null);
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin': return <ShieldAlert className="w-4 h-4 text-red-500" />;
      case 'manager': return <ShieldCheck className="w-4 h-4 text-blue-500" />;
      default: return <Shield className="w-4 h-4 text-zinc-400" />;
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-16 h-16 text-red-100 mb-4" />
        <h2 className="text-2xl font-bold text-zinc-900">Access Denied</h2>
        <p className="text-zinc-500">Only administrators can manage team permissions.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Team Management</h1>
          <p className="text-zinc-500">Manage user roles and system permissions.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Team Member
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          placeholder="Search team members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
        />
      </div>

      {/* Users Table */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Member</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredUsers.map((user) => (
                <tr key={user.uid} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center border border-zinc-200">
                        <span className="text-zinc-600 font-medium">{user.displayName[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{user.displayName}</p>
                        <p className="text-xs text-zinc-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getRoleIcon(user.role)}
                      <span className={cn(
                        "text-xs font-bold uppercase tracking-wider",
                        user.role === 'admin' ? "text-red-600" : 
                        user.role === 'manager' ? "text-blue-600" : "text-zinc-500"
                      )}>
                        {user.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <Clock className="w-3 h-3" />
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={user.role}
                        onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                        disabled={user.uid === profile.uid || !!roleLoading} // Can't change own role
                        className="text-xs font-medium bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 disabled:opacity-50"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                      {roleLoading === user.uid && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
                      
                      {isAdmin && user.uid !== profile.uid && (
                        <button
                          onClick={() => handleDeleteUser(user.uid)}
                          disabled={!!deleteLoading}
                          className="p-1.5 text-zinc-400 hover:text-red-600 transition-colors disabled:opacity-50"
                          title="Delete User"
                        >
                          {deleteLoading === user.uid ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-zinc-900" />
                <h2 className="text-xl font-bold text-zinc-900">Add Team Member</h2>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="p-6 space-y-4">
              {addError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  {addError}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Full Name</label>
                <input
                  required
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Email Address</label>
                <div className="relative">
                  <Mail className={cn(
                    "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors",
                    emailError ? "text-red-400" : "text-zinc-400"
                  )} />
                  <input
                    required
                    type="email"
                    value={newEmail}
                    onChange={(e) => {
                      setNewEmail(e.target.value);
                      if (emailError) setEmailError(false);
                    }}
                    placeholder="john@company.com"
                    className={cn(
                      "w-full pl-10 pr-4 py-2 border rounded-xl focus:outline-none focus:ring-2 transition-all",
                      emailError 
                        ? "border-red-300 bg-red-50/30 focus:ring-red-500/10 focus:border-red-400" 
                        : "border-zinc-200 focus:ring-zinc-900/5 focus:border-zinc-900"
                    )}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Initial Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    required
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5"
                >
                  <option value="viewer">Viewer (Read Only)</option>
                  <option value="manager">Manager (Edit Products/Invoices)</option>
                  <option value="admin">Admin (Full Access)</option>
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 border border-zinc-200 text-zinc-600 rounded-xl font-medium hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {addLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
