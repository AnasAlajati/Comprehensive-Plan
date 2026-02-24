import React, { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  getDocs, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  serverTimestamp,
  setDoc,
  onSnapshot,
  where,
  limit,
  writeBatch,
  updateDoc
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, firebaseConfig, auth } from '../services/firebase';
import { ActivityService, ActivityLog } from '../services/activityService';
import { Trash2, UserPlus, Shield, ShieldAlert, Mail, User as UserIcon, Copy, Check, Key, Circle, Clock, Activity, MapPin, Edit3, Plus, X, ChevronDown, ChevronUp, AlertTriangle, Database, RefreshCw } from 'lucide-react';

interface UserData {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'schedule_editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | 'daily_planner' | 'pending';
  createdAt: any;
  password?: string;
  isOnline?: boolean;
  lastSeen?: any;
  lastActivePage?: string;
  lastActivePageAt?: any;
  lastModification?: {
    action: string;
    entityType: string;
    entityId: string;
    entityName: string;
    details?: string;
    timestamp: any;
  };
}

export const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'schedule_editor' | 'viewer' | 'dyehouse_manager' | 'dyehouse_colors_manager' | 'factory_manager' | 'daily_planner'>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [createdUserCreds, setCreatedUserCreds] = useState<{email: string, password: string} | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Activity tracking states
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userActivities, setUserActivities] = useState<Record<string, ActivityLog[]>>({});
  const [loadingActivities, setLoadingActivities] = useState<string | null>(null);

  // Season Migration states
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationClients, setMigrationClients] = useState<{ id: string; name: string }[] | null>(null);
  const [migrationScanning, setMigrationScanning] = useState(false);
  const [migrationSeasons, setMigrationSeasons] = useState<{ id: string; name: string }[]>([]);
  const [migrationTargetSeasonId, setMigrationTargetSeasonId] = useState('');
  const [migrationConfirmText, setMigrationConfirmText] = useState('');
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);

  // Season Migration: scan clients without a season
  const handleScanMigration = async () => {
    setMigrationScanning(true);
    setMigrationClients(null);
    setMigrationResult(null);
    try {
      // Load seasons
      const seasonsSnap = await getDocs(collection(db, 'Seasons'));
      const seasons = seasonsSnap.docs.map(d => ({ id: d.id, name: (d.data().name as string) || d.id }));
      setMigrationSeasons(seasons);
      if (seasons.length > 0 && !migrationTargetSeasonId) {
        // Default to 2025-summer if it exists, otherwise first
        const summer = seasons.find(s => s.id === '2025-summer');
        setMigrationTargetSeasonId(summer ? summer.id : seasons[0].id);
      }

      // Load clients without createdSeasonId
      const clientsSnap = await getDocs(collection(db, 'CustomerSheets'));
      const missing = clientsSnap.docs
        .filter(d => {
          const data = d.data();
          return !data.createdSeasonId || data.createdSeasonId.trim() === '';
        })
        .map(d => ({ id: d.id, name: (d.data().name as string) || d.id }));
      setMigrationClients(missing);
    } catch (err) {
      console.error('Migration scan error:', err);
      setMigrationResult('❌ Error scanning clients. Check console.');
    }
    setMigrationScanning(false);
  };

  const handleRunMigration = async () => {
    if (!migrationClients || migrationClients.length === 0) return;
    if (!migrationTargetSeasonId) return;
    setMigrationRunning(true);
    setMigrationResult(null);
    try {
      const targetSeason = migrationSeasons.find(s => s.id === migrationTargetSeasonId);
      const seasonName = targetSeason?.name || migrationTargetSeasonId;

      // Batch update in chunks of 500 (Firestore limit)
      const chunkSize = 500;
      for (let i = 0; i < migrationClients.length; i += chunkSize) {
        const chunk = migrationClients.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach(client => {
          const ref = doc(db, 'CustomerSheets', client.id);
          batch.update(ref, {
            createdSeasonId: migrationTargetSeasonId,
            createdSeasonName: seasonName
          });
        });
        await batch.commit();
      }

      setMigrationResult(`✅ Successfully updated ${migrationClients.length} clients to season "${seasonName}".`);
      setMigrationClients([]);
      setMigrationConfirmText('');
    } catch (err) {
      console.error('Migration run error:', err);
      setMigrationResult('❌ Migration failed. Check console.');
    }
    setMigrationRunning(false);
  };

  // Load user activities when expanded
  const loadUserActivities = async (userEmail: string) => {
    if (userActivities[userEmail]) return; // Already loaded
    
    setLoadingActivities(userEmail);
    try {
      const activities = await ActivityService.getUserActivities(userEmail, 10);
      setUserActivities(prev => ({ ...prev, [userEmail]: activities }));
    } catch (err) {
      console.error('Failed to load activities:', err);
    }
    setLoadingActivities(null);
  };

  const toggleUserExpansion = (userId: string, userEmail: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
    } else {
      setExpandedUserId(userId);
      loadUserActivities(userEmail);
    }
  };

  useEffect(() => {
    // Real-time listener for users (to get live online status)
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedUsers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserData[];
      setUsers(fetchedUsers);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching users:", err);
      setError("Failed to load users.");
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const fetchedUsers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as UserData[];
      setUsers(fetchedUsers);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    // Prevent admin from demoting themselves
    const currentUserEmail = auth.currentUser?.email?.toLowerCase();
    if (userId.toLowerCase() === currentUserEmail && newRole !== 'admin') {
      setError("You cannot demote yourself. Ask another admin to change your role.");
      return;
    }
    
    try {
      await setDoc(doc(db, 'users', userId), { role: newRole }, { merge: true });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole as any } : u));
    } catch (err) {
      console.error("Error updating role:", err);
      setError("Failed to update user role.");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail) return;

    setIsAdding(true);
    setError('');
    setCreatedUserCreds(null);

    // 1. Generate Random Password (8 chars: 4 random + 4 random)
    const password = Math.random().toString(36).slice(-4) + Math.random().toString(36).slice(-4) + "!";

    try {
      // Check if user already exists in our list
      const existingUser = users.find(u => u.email.toLowerCase() === newUserEmail.toLowerCase());
      if (existingUser) {
        setError("User with this email already exists in the list.");
        setIsAdding(false);
        return;
      }

      // 2. Create User in Firebase Auth (Secondary App Trick)
      // We use a secondary app instance so we don't log out the current admin
      const secondaryApp = initializeApp(firebaseConfig, "Secondary");
      const secondaryAuth = getAuth(secondaryApp);
      
      let uid = '';
      try {
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newUserEmail, password);
        uid = userCredential.user.uid;
        await signOut(secondaryAuth);
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
           // If they exist in Auth but not in our list, we just add them to the list
           // But we can't give the admin the password since we didn't create it.
           setError("This user already has an account. Added to list, but cannot generate new password.");
           // We proceed to add to Firestore anyway so they can access
        } else {
           throw authErr;
        }
      } finally {
        // Cleanup
        // deleteApp(secondaryApp).catch(console.error); // Optional cleanup
      }

      // 3. Add to Firestore
      const userId = newUserEmail.toLowerCase();
      await setDoc(doc(db, 'users', userId), {
        email: newUserEmail.toLowerCase(),
        displayName: newUserName || newUserEmail.split('@')[0],
        role: newUserRole,
        isOnline: false, // Default to offline on creation
        createdAt: serverTimestamp(),
        uid: uid || null,
        password: password // Storing password as requested
      });

      // 4. Show Credentials (only if we created the auth user)
      if (uid) {
        setCreatedUserCreds({ email: newUserEmail, password });
      }

      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('viewer');
      fetchUsers(); 
    } catch (err: any) {
      console.error("Error adding user:", err);
      setError("Failed to create user: " + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const copyToClipboard = () => {
    if (!createdUserCreds) return;
    const text = `JATI System Login\nEmail: ${createdUserCreds.email}\nPassword: ${createdUserCreds.password}\nLogin at: ${window.location.origin}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to remove this user? They will lose access immediately.")) return;

    try {
      await deleteDoc(doc(db, 'users', userId));
      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      console.error("Error deleting user:", err);
      setError("Failed to delete user.");
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading users...</div>;
  }

  return (
    <div className="max-w-[98%] xl:max-w-[1440px] mx-auto p-4 lg:p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="text-indigo-600" />
            User Management
          </h2>
          <p className="text-slate-500 mt-1">Control who has access to the application.</p>
        </div>
      </div>

      {/* Success Credential Display */}
      {createdUserCreds && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 shadow-sm animate-in fade-in slide-in-from-top-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-100 rounded-full text-green-600">
              <Key size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-green-800 mb-2">User Created Successfully</h3>
              <p className="text-green-700 mb-4 text-sm">
                Please copy these credentials and send them to the user securely. 
                This password will <strong>not be shown again</strong>.
              </p>
              
              <div className="bg-white border border-green-200 rounded-lg p-4 space-y-2 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Email:</span>
                  <span className="text-slate-900 font-semibold select-all">{createdUserCreds.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Password:</span>
                  <span className="text-slate-900 font-bold select-all bg-yellow-50 px-2 rounded">{createdUserCreds.password}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied to Clipboard' : 'Copy Credentials'}
                </button>
                <button
                  onClick={() => setCreatedUserCreds(null)}
                  className="px-4 py-2 text-green-700 hover:bg-green-100 rounded-lg transition-colors text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add User Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <UserPlus size={20} className="text-slate-400" />
          Add New User
        </h3>
        
        <form onSubmit={handleAddUser} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="email"
                required
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="John Doe"
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="w-full md:w-48">
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="viewer">Viewer</option>
              <option value="schedule_editor">Schedule Editor</option>
              <option value="dyehouse_manager">Dyehouse Manager</option>
              <option value="dyehouse_colors_manager">Dyehouse Colors Manager</option>
              <option value="factory_manager">Factory Manager</option>
              <option value="daily_planner">Daily Planner</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isAdding}
            className="w-full md:w-auto px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isAdding ? 'Adding...' : 'Add User'}
          </button>
        </form>
        
        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 text-sm">
            <ShieldAlert size={16} />
            {error}
          </div>
        )}
      </div>

      {/* Users List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 shadow-md">
        <table className="w-full text-left font-medium">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap min-w-[220px]">User</th>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap">Password</th>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap">Status</th>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap">Current Page</th>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap">Last Modification</th>
                <th className="px-6 py-5 font-bold text-slate-700 whitespace-nowrap min-w-[180px]">Role</th>
                <th className="px-6 py-5 font-bold text-slate-700 text-right whitespace-nowrap px-8">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    No users found. Add the first user above.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <React.Fragment key={user.id}>
                  <tr className={`hover:bg-slate-50 transition-colors cursor-pointer ${expandedUserId === user.id ? 'bg-indigo-50' : ''}`}
                      onClick={() => toggleUserExpansion(user.id, user.email)}>
                    <td className="px-6 py-4">
                      {(() => {
                        // Helper to calculate time ago
                        const getLastSeenInfo = (timestamp: any) => {
                          if (!timestamp) return { text: 'Never', isRecent: false };
                          
                          const lastSeen = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
                          const now = new Date();
                          const diffMs = now.getTime() - lastSeen.getTime();
                          const diffMins = Math.floor(diffMs / 60000);
                          const isRecent = diffMins < 3; // 3 minutes threshold

                          let text = '';
                          const diffHours = Math.floor(diffMins / 60);
                          const diffDays = Math.floor(diffHours / 24);

                          if (diffMins < 1) text = 'Just now';
                          else if (diffMins < 60) text = `${diffMins}m ago`;
                          else if (diffHours < 24) text = `${diffHours}h ago`;
                          else if (diffDays < 7) text = `${diffDays}d ago`;
                          else text = lastSeen.toLocaleDateString();

                          return { text, isRecent };
                        };

                        const lastSeenInfo = getLastSeenInfo(user.lastSeen);
                        // Only show Green if online AND active in last 3 mins
                        const isReallyOnline = user.isOnline && lastSeenInfo.isRecent;

                        return (
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                                {user.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isReallyOnline ? 'bg-green-500' : 'bg-slate-300'}`} />
                            </div>
                            <div>
                              <div className="font-medium text-slate-900">{user.displayName}</div>
                              <div className="text-slate-500 text-xs">{user.email}</div>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    {/* Password Column */}
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      {user.password ? (
                        <div className="flex items-center gap-2">
                          <Key className="w-3.5 h-3.5 text-amber-500" />
                          <code className="text-xs font-mono bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-200 select-all">
                            {user.password}
                          </code>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Not stored</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                         const getLastSeenInfo = (timestamp: any) => {
                           if (!timestamp) return { text: 'Never', isRecent: false };
                           const lastSeen = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
                           const now = new Date();
                           const diffMs = now.getTime() - lastSeen.getTime();
                           return { 
                             text: '', // calculated below to avoid dupe code 
                             isRecent: diffMs < 3 * 60 * 1000,
                             diffMins: Math.floor(diffMs / 60000),
                             obj: lastSeen
                           };
                         };
                         const info = getLastSeenInfo(user.lastSeen);
                         const isReallyOnline = user.isOnline && info.isRecent;
                         
                         // Re-calculate text for display
                         let timeText = 'Never';
                         if (user.lastSeen) {
                            const now = new Date();
                            const diffMins = Math.floor((now.getTime() - info.obj.getTime()) / 60000);
                            const diffHours = Math.floor(diffMins / 60);
                            const diffDays = Math.floor(diffHours / 24);
                            if (diffMins < 1) timeText = 'Just now';
                            else if (diffMins < 60) timeText = `${diffMins}m ago`;
                            else if (diffHours < 24) timeText = `${diffHours}h ago`;
                            else if (diffDays < 7) timeText = `${diffDays}d ago`;
                            else timeText = info.obj.toLocaleDateString();
                         }

                         if (isReallyOnline) {
                           return (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              <Circle className="w-2 h-2 fill-current" />
                              Online
                            </span>
                           );
                         } 
                         
                         return (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 w-fit">
                                <Circle className="w-2 h-2" />
                                Offline
                              </span>
                              {user.lastSeen && (
                                <span className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {timeText}
                                </span>
                              )}
                            </div>
                         );
                      })()}
                    </td>
                    {/* Current Page */}
                    <td className="px-6 py-4">
                      {user.lastActivePage ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 w-fit">
                            <MapPin className="w-3 h-3" />
                            {user.lastActivePage}
                          </span>
                          {user.lastActivePageAt && (
                            <span className="text-[10px] text-slate-400 mt-1">
                              {(() => {
                                const ts = user.lastActivePageAt.toDate ? user.lastActivePageAt.toDate() : new Date(user.lastActivePageAt);
                                const diffMins = Math.floor((Date.now() - ts.getTime()) / 60000);
                                if (diffMins < 1) return 'Just now';
                                if (diffMins < 60) return `${diffMins}m ago`;
                                const diffHours = Math.floor(diffMins / 60);
                                if (diffHours < 24) return `${diffHours}h ago`;
                                return ts.toLocaleDateString();
                              })()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No activity yet</span>
                      )}
                    </td>
                    {/* Last Modification */}
                    <td className="px-6 py-4">
                      {user.lastModification ? (
                        <div className="flex flex-col max-w-[200px]">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                              ${user.lastModification.action === 'create' ? 'bg-green-100 text-green-700' : 
                                user.lastModification.action === 'update' ? 'bg-blue-100 text-blue-700' : 
                                user.lastModification.action === 'delete' ? 'bg-red-100 text-red-700' : 
                                'bg-slate-100 text-slate-600'}`}>
                              {user.lastModification.action === 'create' ? <Plus className="w-2.5 h-2.5" /> : 
                               user.lastModification.action === 'update' ? <Edit3 className="w-2.5 h-2.5" /> :
                               user.lastModification.action === 'delete' ? <X className="w-2.5 h-2.5" /> : null}
                              {user.lastModification.action}
                            </span>
                            <span className="text-xs text-slate-600 truncate">{user.lastModification.entityType}</span>
                          </div>
                          <span className="text-xs font-medium text-slate-800 truncate mt-0.5">
                            {user.lastModification.entityName}
                          </span>
                          {user.lastModification.details && (
                            <span className="text-[10px] text-slate-500 truncate">{user.lastModification.details}</span>
                          )}
                          {user.lastModification.timestamp && (
                            <span className="text-[10px] text-slate-400 mt-0.5">
                              {(() => {
                                const ts = user.lastModification.timestamp.toDate ? user.lastModification.timestamp.toDate() : new Date(user.lastModification.timestamp);
                                const diffMins = Math.floor((Date.now() - ts.getTime()) / 60000);
                                if (diffMins < 1) return 'Just now';
                                if (diffMins < 60) return `${diffMins}m ago`;
                                const diffHours = Math.floor(diffMins / 60);
                                if (diffHours < 24) return `${diffHours}h ago`;
                                return ts.toLocaleDateString();
                              })()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No modifications</span>
                      )}
                    </td>
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-indigo-500
                          ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 
                            user.role === 'schedule_editor' ? 'bg-blue-100 text-blue-800' : 
                            user.role === 'dyehouse_manager' ? 'bg-cyan-100 text-cyan-800' :
                            user.role === 'dyehouse_colors_manager' ? 'bg-teal-100 text-teal-800' :
                            user.role === 'factory_manager' ? 'bg-orange-100 text-orange-800' :
                            user.role === 'daily_planner' ? 'bg-green-100 text-green-800' :
                            user.role === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-slate-100 text-slate-800'}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="viewer">Viewer</option>
                        <option value="schedule_editor">Schedule Editor</option>
                        <option value="dyehouse_manager">Dyehouse Manager</option>
                        <option value="dyehouse_colors_manager">Dyehouse Colors Manager</option>
                        <option value="factory_manager">Factory Manager</option>
                        <option value="daily_planner">Daily Planner</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleUserExpansion(user.id, user.email)}
                          className={`p-2 rounded-lg transition-colors ${expandedUserId === user.id ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                          title="View Activity History"
                        >
                          {expandedUserId === user.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove User"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded Activity Row */}
                  {expandedUserId === user.id && (
                    <tr className="bg-indigo-50/50">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="bg-white rounded-lg border border-indigo-100 p-4">
                          <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                            <Activity size={16} className="text-indigo-600" />
                            Recent Activity for {user.displayName}
                          </h4>
                          {loadingActivities === user.email ? (
                            <div className="flex items-center justify-center py-4">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                              <span className="ml-2 text-sm text-slate-500">Loading activities...</span>
                            </div>
                          ) : userActivities[user.email]?.length > 0 ? (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {userActivities[user.email].map((activity, idx) => (
                                <div key={activity.id || idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                                  <div className={`p-1.5 rounded-full ${
                                    activity.action === 'create' ? 'bg-green-100 text-green-600' :
                                    activity.action === 'update' ? 'bg-blue-100 text-blue-600' :
                                    activity.action === 'delete' ? 'bg-red-100 text-red-600' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {activity.action === 'create' ? <Plus size={12} /> :
                                     activity.action === 'update' ? <Edit3 size={12} /> :
                                     activity.action === 'delete' ? <X size={12} /> :
                                     <Activity size={12} />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                        activity.action === 'create' ? 'bg-green-100 text-green-700' :
                                        activity.action === 'update' ? 'bg-blue-100 text-blue-700' :
                                        activity.action === 'delete' ? 'bg-red-100 text-red-700' :
                                        'bg-slate-100 text-slate-600'
                                      }`}>
                                        {activity.action.toUpperCase()}
                                      </span>
                                      <span className="text-xs text-slate-500">{activity.entityType}</span>
                                      <span className="text-xs font-medium text-slate-800">{activity.entityName}</span>
                                    </div>
                                    {activity.details && (
                                      <p className="text-xs text-slate-600 mt-0.5">{activity.details}</p>
                                    )}
                                    {activity.changes && activity.changes.length > 0 && (
                                      <div className="mt-1 text-[10px] text-slate-500">
                                        {activity.changes.map((change, cIdx) => (
                                          <span key={cIdx} className="inline-block mr-2">
                                            <span className="font-medium">{change.field}:</span>{' '}
                                            <span className="line-through text-red-500">{change.oldValue || '-'}</span>{' → '}
                                            <span className="text-green-600">{change.newValue || '-'}</span>
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    {activity.timestamp?.toDate ? (() => {
                                      const ts = activity.timestamp.toDate();
                                      const diffMins = Math.floor((Date.now() - ts.getTime()) / 60000);
                                      if (diffMins < 1) return 'Just now';
                                      if (diffMins < 60) return `${diffMins}m ago`;
                                      const diffHours = Math.floor(diffMins / 60);
                                      if (diffHours < 24) return `${diffHours}h ago`;
                                      const diffDays = Math.floor(diffHours / 24);
                                      if (diffDays < 7) return `${diffDays}d ago`;
                                      return ts.toLocaleDateString();
                                    })() : 'Unknown'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-4 text-sm text-slate-500">
                              <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                              No activity recorded yet
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
      </div>

      {/* ── Data Maintenance ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button
          onClick={() => { setMigrationOpen(v => !v); setMigrationClients(null); setMigrationResult(null); setMigrationConfirmText(''); }}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Database size={18} className="text-amber-600" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-slate-800 text-sm">Data Maintenance</p>
              <p className="text-xs text-slate-500">Fix clients missing a season assignment</p>
            </div>
          </div>
          {migrationOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </button>

        {migrationOpen && (
          <div className="border-t border-slate-200 px-6 py-5 space-y-5">

            {/* Step 1: Scan */}
            <div>
              <p className="text-sm font-medium text-slate-700 mb-1">Step 1 — Scan for clients without a season</p>
              <p className="text-xs text-slate-500 mb-3">This will check all clients in <code className="bg-slate-100 px-1 rounded">CustomerSheets</code> and list those that have no <code className="bg-slate-100 px-1 rounded">createdSeasonId</code>.</p>
              <button
                onClick={handleScanMigration}
                disabled={migrationScanning}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                {migrationScanning
                  ? <><RefreshCw size={14} className="animate-spin" /> Scanning...</>
                  : <><RefreshCw size={14} /> Scan Clients</>}
              </button>
            </div>

            {/* Results list */}
            {migrationClients !== null && (
              <div>
                {migrationClients.length === 0 ? (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                    <Check size={16} /> All clients already have a season assigned. Nothing to migrate.
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                      <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-800">
                        <span className="font-bold">{migrationClients.length} client{migrationClients.length !== 1 ? 's' : ''}</span> found without a season. They will all be assigned the season you choose below.
                      </p>
                    </div>

                    {/* Client list */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                      <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide border-b border-slate-200">
                        Clients to be updated ({migrationClients.length})
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                        {migrationClients.map(c => (
                          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                            <UserIcon size={14} className="text-slate-400 shrink-0" />
                            <span className="text-sm text-slate-800 font-medium">{c.name}</span>
                            <span className="text-xs text-slate-400 ml-auto font-mono">{c.id}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 2: Pick season */}
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">Step 2 — Choose the season to assign</p>
                      <select
                        value={migrationTargetSeasonId}
                        onChange={e => setMigrationTargetSeasonId(e.target.value)}
                        className="w-full max-w-xs px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      >
                        {migrationSeasons.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                        ))}
                      </select>
                    </div>

                    {/* Step 3: Confirm */}
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-700 mb-1">Step 3 — Type <span className="font-mono bg-slate-100 px-1 rounded">CONFIRM</span> to proceed</p>
                      <input
                        type="text"
                        value={migrationConfirmText}
                        onChange={e => setMigrationConfirmText(e.target.value)}
                        placeholder="Type CONFIRM"
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 w-40"
                      />
                    </div>

                    <button
                      onClick={handleRunMigration}
                      disabled={migrationConfirmText !== 'CONFIRM' || migrationRunning || !migrationTargetSeasonId}
                      className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {migrationRunning
                        ? <><RefreshCw size={14} className="animate-spin" /> Migrating...</>
                        : <><Database size={14} /> Run Migration ({migrationClients.length} clients)</>}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Result message */}
            {migrationResult && (
              <div className={`p-3 rounded-lg text-sm font-medium ${migrationResult.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                {migrationResult}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
