import React, { useState, useEffect, useMemo } from 'react';
import { collection, collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { FEATURE_GROUPS, getGroupIdForPage, getCairoDateString, getCairoWeekRange, formatDuration } from '../services/timeTrackingService';
import { Clock, ChevronDown, ChevronUp, Users as UsersIcon, BarChart3 } from 'lucide-react';

interface UserLookupEntry {
  displayName: string;
  role: string;
}

interface DailyActivityDoc {
  email: string;
  date: string;
  perPage: Record<string, number>;
}

export const FeatureUsagePage: React.FC = () => {
  const [userLookup, setUserLookup] = useState<Record<string, UserLookupEntry>>({});
  const [activityDocs, setActivityDocs] = useState<DailyActivityDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const todayStr = useMemo(() => getCairoDateString(), []);
  const { start: weekStart, end: weekEnd } = useMemo(() => getCairoWeekRange(), []);

  // User directory, for display names + roles in the per-user breakdown
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const map: Record<string, UserLookupEntry> = {};
      snapshot.docs.forEach(d => {
        const data = d.data() as any;
        map[d.id] = {
          displayName: data.displayName || d.id,
          role: data.role || 'viewer'
        };
      });
      setUserLookup(map);
    }, (err) => console.warn('FeatureUsagePage users listener error:', err));
    return () => unsubscribe();
  }, []);

  // This week's dailyActivity docs across every user
  useEffect(() => {
    const q = query(
      collectionGroup(db, 'dailyActivity'),
      where('date', '>=', weekStart),
      where('date', '<=', weekEnd)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs: DailyActivityDoc[] = snapshot.docs.map(d => {
        const data = d.data() as any;
        const email = d.ref.parent.parent?.id || '';
        return { email, date: data.date, perPage: data.perPage || {} };
      });
      setActivityDocs(docs);
      setLoading(false);
    }, (err) => {
      console.warn('FeatureUsagePage dailyActivity listener error:', err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [weekStart, weekEnd]);

  const groupTotals = useMemo(() => {
    const result: Record<string, { today: number; week: number; perUser: Record<string, { today: number; week: number }> }> = {};
    FEATURE_GROUPS.forEach(g => { result[g.id] = { today: 0, week: 0, perUser: {} }; });

    activityDocs.forEach(docData => {
      Object.entries(docData.perPage).forEach(([page, secsRaw]) => {
        const groupId = getGroupIdForPage(page);
        if (!groupId) return; // admin-only / unmapped pages are excluded entirely
        const seconds = Number(secsRaw) || 0;
        if (seconds <= 0) return;

        const bucket = result[groupId];
        bucket.week += seconds;
        if (docData.date === todayStr) bucket.today += seconds;

        if (!bucket.perUser[docData.email]) bucket.perUser[docData.email] = { today: 0, week: 0 };
        bucket.perUser[docData.email].week += seconds;
        if (docData.date === todayStr) bucket.perUser[docData.email].today += seconds;
      });
    });

    return result;
  }, [activityDocs, todayStr]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading feature usage...</div>;
  }

  return (
    <div className="max-w-[98%] xl:max-w-[1200px] mx-auto p-4 lg:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <BarChart3 className="text-indigo-600" />
          Feature Usage
        </h2>
        <p className="text-slate-500 mt-1">
          Active time per feature area — today and this week ({weekStart} to {weekEnd}, Sat–Fri).
        </p>
      </div>

      <div className="space-y-3">
        {FEATURE_GROUPS.map(group => {
          const totals = groupTotals[group.id];
          const isExpanded = expandedGroupId === group.id;
          const userRows = Object.entries(totals.perUser)
            .map(([email, t]) => ({ email, ...t, ...userLookup[email] }))
            .sort((a, b) => b.week - a.week);

          return (
            <div key={group.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <Clock size={18} />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{group.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{userRows.length} user{userRows.length !== 1 ? 's' : ''} active this week</div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Today</div>
                    <div className="font-mono text-sm font-bold text-slate-800">{formatDuration(totals.today)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">This Week</div>
                    <div className="font-mono text-sm font-bold text-indigo-700">{formatDuration(totals.week)}</div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {userRows.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
                      <UsersIcon size={14} /> No activity recorded in this feature area this week.
                    </div>
                  ) : (
                    userRows.map(row => (
                      <div key={row.email} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                        <div>
                          <div className="font-medium text-slate-800">{row.displayName || row.email}</div>
                          <div className="text-xs text-slate-400">{row.email}{row.role ? ` · ${row.role}` : ''}</div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right w-16">
                            <div className="text-[10px] text-slate-400">Today</div>
                            <div className="font-mono text-xs text-slate-700">{formatDuration(row.today)}</div>
                          </div>
                          <div className="text-right w-16">
                            <div className="text-[10px] text-slate-400">Week</div>
                            <div className="font-mono text-xs font-bold text-indigo-700">{formatDuration(row.week)}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
