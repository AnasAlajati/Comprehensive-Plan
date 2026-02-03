/**
 * Activity Service - Tracks user actions and page visits
 * 
 * This service provides centralized activity logging for:
 * 1. Page navigation tracking (lastActivePage)
 * 2. Modification logging (what users create/edit/delete)
 */

import { 
  collection, 
  doc, 
  setDoc, 
  addDoc,
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';

// Activity types
export type ActivityAction = 'create' | 'update' | 'delete' | 'view' | 'login' | 'logout';
export type EntityType = 'machine' | 'order' | 'fabric' | 'plan' | 'yarn' | 'sample' | 'user' | 'dyehouse' | 'other';

export interface ActivityLog {
  id?: string;
  userId: string;
  userEmail: string;
  userName: string;
  action: ActivityAction;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  details?: string;
  changes?: { field: string; oldValue: any; newValue: any }[];
  timestamp: any;
  page?: string;
}

export interface UserActivity {
  lastActivePage: string;
  lastActivePageAt: any;
  recentActivities: ActivityLog[];
}

// Page name mapping for better display
const PAGE_NAMES: Record<string, string> = {
  'excel': 'Machine Schedule',
  'planning': 'Planning Schedule',
  'maintenance': 'Maintenance Dashboard',
  'real-maintenance': 'Maintenance Page',
  'idle': 'Idle Machines',
  'orders': 'Client Orders',
  'compare': 'Compare Days',
  'history': 'Production History',
  'fabric-history': 'Fabric History',
  'yarn-inventory': 'Yarn Inventory',
  'dyehouse-inventory': 'Dyehouse Inventory',
  'dyehouse-directory': 'Dyehouse Directory',
  'sample-tracking': 'Sample Tracking',
  'fabrics': 'Fabrics Page',
  'machines': 'Machines Page',
  'users': 'User Management'
};

export const ActivityService = {
  /**
   * Update user's current page (called on navigation)
   */
  async trackPageView(userEmail: string, pageName: string): Promise<void> {
    if (!userEmail) return;
    
    const email = userEmail.toLowerCase();
    const displayName = PAGE_NAMES[pageName] || pageName;
    
    try {
      await setDoc(doc(db, 'users', email), {
        lastActivePage: displayName,
        lastActivePageKey: pageName,
        lastActivePageAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('Failed to track page view:', err);
    }
  },

  /**
   * Log an activity (create/update/delete actions)
   */
  async logActivity(
    userEmail: string,
    userName: string,
    action: ActivityAction,
    entityType: EntityType,
    entityId: string,
    entityName: string,
    details?: string,
    changes?: { field: string; oldValue: any; newValue: any }[]
  ): Promise<void> {
    if (!userEmail) return;

    try {
      const activityData: Omit<ActivityLog, 'id'> = {
        userId: userEmail.toLowerCase(),
        userEmail: userEmail.toLowerCase(),
        userName: userName || userEmail.split('@')[0],
        action,
        entityType,
        entityId: String(entityId),
        entityName: entityName || entityId,
        details,
        changes: changes || [],
        timestamp: serverTimestamp()
      };

      // Add to global activityLogs collection
      await addDoc(collection(db, 'activityLogs'), activityData);

      // Also update user's lastModification for quick access
      await setDoc(doc(db, 'users', userEmail.toLowerCase()), {
        lastModification: {
          action,
          entityType,
          entityId: String(entityId),
          entityName,
          details,
          timestamp: serverTimestamp()
        }
      }, { merge: true });

    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  },

  /**
   * Get recent activities for a specific user
   */
  async getUserActivities(userEmail: string, limitCount: number = 10): Promise<ActivityLog[]> {
    if (!userEmail) return [];

    try {
      const q = query(
        collection(db, 'activityLogs'),
        where('userEmail', '==', userEmail.toLowerCase()),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLog[];

    } catch (err) {
      console.error('Failed to fetch user activities:', err);
      return [];
    }
  },

  /**
   * Get all recent activities (for admin view)
   */
  async getAllRecentActivities(limitCount: number = 50): Promise<ActivityLog[]> {
    try {
      const q = query(
        collection(db, 'activityLogs'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityLog[];

    } catch (err) {
      console.error('Failed to fetch all activities:', err);
      return [];
    }
  },

  /**
   * Helper to format changes for display
   */
  formatChanges(changes: { field: string; oldValue: any; newValue: any }[]): string {
    if (!changes || changes.length === 0) return '';
    
    return changes
      .map(c => `${c.field}: "${c.oldValue || '-'}" → "${c.newValue || '-'}"`)
      .join(', ');
  },

  /**
   * Helper to get action icon/color
   */
  getActionStyle(action: ActivityAction): { color: string; bgColor: string; label: string } {
    switch (action) {
      case 'create':
        return { color: 'text-green-700', bgColor: 'bg-green-100', label: 'Created' };
      case 'update':
        return { color: 'text-blue-700', bgColor: 'bg-blue-100', label: 'Updated' };
      case 'delete':
        return { color: 'text-red-700', bgColor: 'bg-red-100', label: 'Deleted' };
      case 'view':
        return { color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Viewed' };
      case 'login':
        return { color: 'text-purple-700', bgColor: 'bg-purple-100', label: 'Logged In' };
      case 'logout':
        return { color: 'text-orange-700', bgColor: 'bg-orange-100', label: 'Logged Out' };
      default:
        return { color: 'text-slate-600', bgColor: 'bg-slate-100', label: action };
    }
  }
};
