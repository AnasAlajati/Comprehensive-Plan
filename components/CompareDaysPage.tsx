import React, { useState, useMemo } from 'react';
import { ArrowRight, TrendingUp, TrendingDown, Activity, Calendar, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { MachineStatus } from '../types';

interface CompareDaysPageProps {
  allMachineData: any[];
  defaultDate1?: string;
  defaultDate2?: string;
}

export const CompareDaysPage: React.FC<CompareDaysPageProps> = ({ 
  allMachineData, 
  defaultDate1, 
  defaultDate2 
}) => {
  // Helper to get previous day
  const getPreviousDay = (dateStr: string) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  };

  const initialDate1 = defaultDate1 || new Date().toISOString().split('T')[0];
  const initialDate2 = defaultDate2 || getPreviousDay(initialDate1);

  const [date1, setDate1] = useState<string>(initialDate1);
  const [date2, setDate2] = useState<string>(initialDate2);
  const [showExtras, setShowExtras] = useState(false);

  const comparisonData = useMemo(() => {
    // Filter for Wide machines only (Exclude BOUS)
    const wideMachines = allMachineData.filter(m => m.type !== 'BOUS');

    let totalProd1 = 0;
    let totalProd2 = 0;
    
    const significantChanges: any[] = [];
    const minorChanges: any[] = [];

    wideMachines.forEach(machine => {
      const logs = machine.dailyLogs || [];
      const log1 = logs.find((l: any) => l.date === date1);
      const log2 = logs.find((l: any) => l.date === date2);

      const prod1 = Number(log1?.dayProduction) || 0;
      const prod2 = Number(log2?.dayProduction) || 0;

      totalProd1 += prod1;
      totalProd2 += prod2;

      const diff = prod1 - prod2;
      
      if (diff !== 0 || (log1?.status !== log2?.status)) {
        let reason = '';
        let type = 'neutral';
        let isSignificant = false;

        const status1 = log1?.status || 'No Order';
        const status2 = log2?.status || 'No Order';

        // 1. Check for Status Changes (Start/Stop)
        if (prod1 === 0 && prod2 > 0) {
           reason = `Stopped production (Status: ${status1})`;
           type = 'negative';
           isSignificant = true;
        } else if (prod1 > 0 && prod2 === 0) {
           reason = `Started production (Status: ${status1})`;
           type = 'positive';
           isSignificant = true;
        } 
        
        // 2. Check for Order Finished
        // Logic: Yesterday had remaining > 0, Today has remaining 0 (or very close to 0)
        const remainingYesterday = Number(log2?.remainingMfg) || 0;
        const remainingToday = Number(log1?.remainingMfg) || 0;
        
        if (remainingYesterday > 0 && remainingToday <= 0) {
            const hasFuturePlans = machine.futurePlans && machine.futurePlans.length > 0;
            reason = `Order Finished. ${hasFuturePlans ? '✅ Has Future Plans' : '⚠️ No Future Plans'}`;
            type = 'neutral';
            isSignificant = true;
        }

        // 3. Check for Large Production Swings (> 20%)
        // Only if both days had production (otherwise it's a start/stop case handled above)
        if (prod1 > 0 && prod2 > 0) {
            const percentChange = Math.abs(diff) / prod2;
            if (percentChange > 0.20) {
                reason = `Production ${diff > 0 ? 'Increased' : 'Decreased'} by ${Math.round(percentChange * 100)}% (${Math.abs(diff)} kg)`;
                type = diff > 0 ? 'positive' : 'negative';
                isSignificant = true;
            }
        }

        // If not significant yet, it's a minor fluctuation
        if (!isSignificant) {
            reason = `Minor fluctuation: ${diff > 0 ? '+' : ''}${diff} kg`;
            type = diff > 0 ? 'positive' : 'negative';
        }

        const changeObj = {
          machineName: machine.name || machine.machineName,
          brand: machine.brand,
          prod1,
          prod2,
          diff,
          reason,
          type
        };

        if (isSignificant) {
            significantChanges.push(changeObj);
        } else {
            minorChanges.push(changeObj);
        }
      }
    });

    // Sort significant changes by magnitude
    significantChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    
    // Sort minor changes by magnitude
    minorChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    return {
      totalProd1,
      totalProd2,
      diff: totalProd1 - totalProd2,
      significantChanges,
      minorChanges
    };
  }, [allMachineData, date1, date2]);

  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-6 font-sans pb-20">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Activity className="text-blue-600" />
              Production Comparison
            </h1>
            <p className="text-slate-500 text-sm mt-1">Analyzing Wide Machine performance variance</p>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-lg border border-slate-200">
            <div className="relative group">
              <label className="absolute -top-2 left-2 text-[10px] bg-slate-50 px-1 text-blue-600 font-bold">Target Date</label>
              <input 
                type="date" 
                value={date1}
                onChange={(e) => setDate1(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm font-medium rounded-lg px-3 py-2 focus:ring-0 outline-none"
              />
            </div>
            <div className="text-slate-400">
              <ArrowRight size={16} />
            </div>
            <div className="relative group">
              <label className="absolute -top-2 left-2 text-[10px] bg-slate-50 px-1 text-slate-500 font-bold">Baseline Date</label>
              <input 
                type="date" 
                value={date2}
                onChange={(e) => setDate2(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm font-medium rounded-lg px-3 py-2 focus:ring-0 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Main Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Target Date Stat */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <Calendar size={64} />
            </div>
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">{date1} (Target)</h3>
            <div className="text-3xl font-bold text-slate-800 mb-1">
              {formatNumber(comparisonData.totalProd1)} <span className="text-sm text-slate-400 font-normal">kg</span>
            </div>
            <div className="text-xs text-blue-600 font-medium bg-blue-50 inline-block px-2 py-0.5 rounded">Wide Machines</div>
          </div>

          {/* Baseline Date Stat */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <Calendar size={64} />
            </div>
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">{date2} (Baseline)</h3>
            <div className="text-3xl font-bold text-slate-600 mb-1">
              {formatNumber(comparisonData.totalProd2)} <span className="text-sm text-slate-400 font-normal">kg</span>
            </div>
            <div className="text-xs text-slate-500 font-medium bg-slate-100 inline-block px-2 py-0.5 rounded">Wide Machines</div>
          </div>

          {/* Difference Stat */}
          <div className={`p-6 rounded-xl border shadow-sm relative overflow-hidden ${
            comparisonData.diff >= 0 
              ? 'bg-emerald-50 border-emerald-100' 
              : 'bg-red-50 border-red-100'
          }`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              {comparisonData.diff >= 0 ? <TrendingUp size={64} className="text-emerald-600" /> : <TrendingDown size={64} className="text-red-600" />}
            </div>
            <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${comparisonData.diff >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              Net Difference
            </h3>
            <div className={`text-3xl font-bold mb-1 ${comparisonData.diff >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {comparisonData.diff > 0 ? '+' : ''}{formatNumber(comparisonData.diff)} <span className="text-sm opacity-70 font-normal">kg</span>
            </div>
            <div className={`text-xs font-medium ${comparisonData.diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {comparisonData.diff >= 0 ? 'Production Increased' : 'Production Decreased'}
            </div>
          </div>
        </div>

        {/* Significant Changes */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <AlertCircle className="text-orange-500 w-5 h-5" />
            <h2 className="font-bold text-slate-800">Significant Changes</h2>
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
              {comparisonData.significantChanges.length}
            </span>
          </div>
          
          <div className="divide-y divide-slate-100">
            {comparisonData.significantChanges.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No major production anomalies detected (&gt;20% variance or status changes).
              </div>
            ) : (
              comparisonData.significantChanges.map((change, idx) => (
                <div key={idx} className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 w-2 h-2 rounded-full ${
                      change.type === 'positive' ? 'bg-emerald-500' : 
                      change.type === 'negative' ? 'bg-red-500' : 'bg-slate-400'
                    }`} />
                    <div>
                      <div className="font-bold text-slate-700 text-sm">
                        {change.machineName} <span className="text-xs text-slate-400 font-normal ml-1">{change.brand}</span>
                      </div>
                      <div className="text-sm text-slate-600 mt-0.5 font-medium">
                        {change.reason}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-auto sm:ml-0 w-full sm:w-auto justify-end bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Was</div>
                      <div className="font-mono text-xs text-slate-500">{formatNumber(change.prod2)}</div>
                    </div>
                    <ArrowRight size={12} className="text-slate-300" />
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Now</div>
                      <div className="font-mono text-xs text-slate-700 font-bold">{formatNumber(change.prod1)}</div>
                    </div>
                    <div className={`text-right min-w-[60px] font-bold text-sm ${
                      change.diff > 0 ? 'text-emerald-600' : change.diff < 0 ? 'text-red-600' : 'text-slate-400'
                    }`}>
                      {change.diff > 0 ? '+' : ''}{formatNumber(change.diff)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Minor Changes (Extras) */}
        {comparisonData.minorChanges.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <button 
              onClick={() => setShowExtras(!showExtras)}
              className="w-full p-4 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <Activity className="text-slate-400 w-5 h-5" />
                <h2 className="font-bold text-slate-600 text-sm">Extras: Minor Fluctuations</h2>
                <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                  {comparisonData.minorChanges.length}
                </span>
              </div>
              {showExtras ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
            </button>
            
            {showExtras && (
              <div className="divide-y divide-slate-100 border-t border-slate-100 max-h-[400px] overflow-y-auto">
                {comparisonData.minorChanges.map((change, idx) => (
                  <div key={idx} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-slate-600 w-32 truncate">
                        {change.machineName}
                      </div>
                      <div className="text-slate-400">
                        {change.reason}
                      </div>
                    </div>
                    <div className={`font-mono font-medium ${
                      change.diff > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {change.diff > 0 ? '+' : ''}{formatNumber(change.diff)} kg
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
