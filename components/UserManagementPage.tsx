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
  setDoc
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, firebaseConfig } from '../services/firebase';
import { Trash2, UserPlus, Shield, ShieldAlert, Mail, User as UserIcon, Copy, Check, Key } from 'lucide-react';

interface UserData {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'editor' | 'viewer' | 'pending';
  createdAt: any;
  password?: string; // Optional: Only for initial display if requested
}

export const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [createdUserCreds, setCreatedUserCreds] = useState<{email: string, password: string} | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchUsers();
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
    <div className="max-w-4xl mx-auto p-6 space-y-8">
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

          <div className="w-full md:w-40">
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold text-slate-700">User</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Role</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Password</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Added</th>
                <th className="px-6 py-4 font-semibold text-slate-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    No users found. Add the first user above.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                          {user.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{user.displayName}</div>
                          <div className="text-slate-500 text-xs">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-indigo-500
                          ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 
                            user.role === 'editor' ? 'bg-blue-100 text-blue-800' : 
                            user.role === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-slate-100 text-slate-800'}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {user.password ? (
                        <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded select-all">
                          {user.password}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Hidden/Set by User</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : 'Just now'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove User"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
