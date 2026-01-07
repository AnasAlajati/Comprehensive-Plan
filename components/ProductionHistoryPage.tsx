import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calendar, Trash2, BarChart3, Factory, ChevronDown, ChevronUp, Download, RefreshCw, X, Info, FileText } from 'lucide-react';
import { MachineRow } from '../types';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '../services/firebase';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { DataService } from '../services/dataService';

interface ProductionHistoryPageProps {
  machines: MachineRow[];
}

interface ExternalEntry {
  id: string;
  date: string;
  factory: string;
  client: string;
  fabric: string;
  receivedQty: number;
}

export const ProductionHistoryPage: React.FC<ProductionHistoryPageProps> = ({ machines }) => {
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 6);
  
  const [startDate, setStartDate] = useState<string>(lastWeek.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(today.toISOString().split('T')[0]);
  const [externalEntries, setExternalEntries] = useState<ExternalEntry[]>([]);
  const [dailySummaries, setDailySummaries] = useState<Record<string, { hallScrap?: number; labScrap?: number }>>({});
  const [loading, setLoading] = useState(false);
  const [showExternalDetails, setShowExternalDetails] = useState(false);
  const [showScrapDetails, setShowScrapDetails] = useState(false);
  const [excludedDays, setExcludedDays] = useState<Set<string>>(new Set());
  const [showDaySelector, setShowDaySelector] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch External Entries
        const qExternal = query(collection(db, 'externalProduction'));
        const snapshotExternal = await getDocs(qExternal);
        const entries: ExternalEntry[] = [];
        snapshotExternal.forEach(doc => {
          const data = doc.data();
          entries.push({
            id: doc.id,
            date: data.date,
            factory: data.factory,
            client: data.client,
            fabric: data.fabric,
            receivedQty: Number(data.receivedQty) || 0
          });
        });
        setExternalEntries(entries);

        // Fetch Daily Summaries for Scrap
        // We fetch a bit more range to be safe or just all relevant
        // Since where(documentId()) range queries can be tricky with string dates if not careful, 
        // asking for all might be safer if dataset small, but let's try strict range
        const qSummaries = query(
          collection(db, 'DailySummaries'), 
          where(documentId(), '>=', startDate), 
          where(documentId(), '<=', endDate)
        );
        const snapshotSummaries = await getDocs(qSummaries);
        const summaries: Record<string, { hallScrap?: number; labScrap?: number }> = {};
        snapshotSummaries.forEach(doc => {
           summaries[doc.id] = doc.data();
        });
        setDailySummaries(summaries);

      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDate]); // Re-fetch when date changes to get correct daily summaries range

  const autoDetectOffDays = () => {
    const newExcluded = new Set<string>();
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      let dayTotal = 0;
      
      machines.forEach(machine => {
        const logs = machine.dailyLogs || [];
        logs.forEach(log => {
          if (log.date === dateStr) {
            dayTotal += Number(log.dayProduction) || 0;
          }
        });
      });
      
      if (dayTotal === 0) {
        newExcluded.add(dateStr);
      }
    }
    setExcludedDays(newExcluded);
  };

  const stats = useMemo(() => {
    let totalWide = 0;
    let totalBous = 0;
    let totalScrap = 0;
    
    const scrapReasons: Record<string, number> = {};
    const dailyStats: Record<string, { wide: number; bous: number; scrap: number; external: number }> = {};
    const dateArray: string[] = [];
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dateArray.push(dateStr);
      dailyStats[dateStr] = { wide: 0, bous: 0, scrap: 0, external: 0 };
      
      // Add daily summary scrap (Hall + Lab)
      const summary = dailySummaries[dateStr];
      if (summary) {
        if (summary.hallScrap) {
           dailyStats[dateStr].scrap += Number(summary.hallScrap);
           totalScrap += Number(summary.hallScrap);
           scrapReasons['سقط الصالة'] = (scrapReasons['سقط الصالة'] || 0) + Number(summary.hallScrap);
        }
        if (summary.labScrap) {
           dailyStats[dateStr].scrap += Number(summary.labScrap);
           totalScrap += Number(summary.labScrap);
           scrapReasons['سقط المعمل'] = (scrapReasons['سقط المعمل'] || 0) + Number(summary.labScrap);
        }
      }
    }

    machines.forEach(machine => {
      const isBous = machine.type === 'BOUS';
      const logs = machine.dailyLogs || [];
      
      logs.forEach(log => {
        if (log.date >= startDate && log.date <= endDate) {
          const prod = Number(log.dayProduction) || 0;
          const scrap = Number(log.scrap) || 0;
          const reason = log.reason || 'غير محدد';

          if (isBous) {
            totalBous += prod;
            if (dailyStats[log.date]) dailyStats[log.date].bous += prod;
          } else {
            totalWide += prod;
            if (dailyStats[log.date]) dailyStats[log.date].wide += prod;
          }

          totalScrap += scrap;
          if (dailyStats[log.date]) dailyStats[log.date].scrap += scrap;

          if (scrap > 0) {
            scrapReasons[reason] = (scrapReasons[reason] || 0) + scrap;
          }
        }
      });
    });

    const externalByFactory: Record<string, number> = {};
    let totalExternal = 0;

    externalEntries.forEach(entry => {
      if (entry.date >= startDate && entry.date <= endDate) {
        const qty = entry.receivedQty;
        externalByFactory[entry.factory] = (externalByFactory[entry.factory] || 0) + qty;
        totalExternal += qty;
        if (dailyStats[entry.date]) dailyStats[entry.date].external += qty;
      }
    });

    const workingDays = dateArray.filter(d => !excludedDays.has(d)).length || 1;
    const avgWide = totalWide / workingDays;
    const scrapPercent = totalWide > 0 ? (totalScrap / totalWide) * 100 : 0;

    return {
      totalWide,
      totalBous,
      totalExternal,
      totalScrap,
      totalInternal: totalWide + totalBous,
      grandTotal: totalWide + totalBous + totalExternal,
      avgWide,
      scrapPercent,
      workingDays,
      totalDays: dateArray.length,
      externalByFactory: Object.entries(externalByFactory).sort((a, b) => b[1] - a[1]),
      scrapReasons: Object.entries(scrapReasons).sort((a, b) => b[1] - a[1]),
      dailyData: dateArray.map(date => ({ date, ...dailyStats[date], excluded: excludedDays.has(date) }))
    };
  }, [machines, startDate, endDate, externalEntries, excludedDays, dailySummaries]);

  const yearlyTotal = useMemo(() => {
    const startYear = "2026-01-01"; 
    const todayStr = new Date().toISOString().split('T')[0];
    
    let total = 0;

    // Machines
    machines.forEach(m => {
        m.dailyLogs?.forEach(log => {
            if (log.date >= startYear && log.date <= todayStr) {
                total += Number(log.dayProduction) || 0;
            }
        })
    });

    // External
    externalEntries.forEach(e => {
        if (e.date >= startYear && e.date <= todayStr) {
            total += e.receivedQty || 0;
        }
    });

    return total;
  }, [machines, externalEntries]);

  const handleQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
    setExcludedDays(new Set());
  };

  const toggleExcludeDay = (date: string) => {
    const newSet = new Set(excludedDays);
    if (newSet.has(date)) {
      newSet.delete(date);
    } else {
      newSet.add(date);
    }
    setExcludedDays(newSet);
  };

  const fmt = (num: number) => num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtDay = (d: string) => new Date(d).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });

  const exportCSV = () => {
    const rows = [
      ['التاريخ', 'العريض', 'البوص', 'خارجي', 'المجموع'],
      ...stats.dailyData.map(d => [d.date, d.wide, d.bous, d.external, d.wide + d.bous + d.external]),
      ['المجموع', stats.totalWide, stats.totalBous, stats.totalExternal, stats.grandTotal]
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقرير-الانتاج-${startDate}-${endDate}.csv`;
    a.click();
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    setIsGeneratingPdf(true);
    let clone: HTMLElement | null = null;
    
    try {
      // Clone the element to render it properly for capture
      clone = printRef.current.cloneNode(true) as HTMLElement;
      
      // Reset styles to ensure visibility for capture
      // We place it fixed at 0,0 but behind everything (z-index -1) or just transparently on top if needed.
      // Since we need it to be painted, we shouldn't hide it with visibility: hidden. 
      // z-index: -9999 usually works if background is distinct, but let's try just appending it.
      // FetchDataPage uses a clone.
      clone.style.display = 'block';
      clone.style.position = 'fixed';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '-9999'; 
      clone.style.width = '210mm';
      clone.style.minHeight = '297mm';
      clone.style.backgroundColor = '#ffffff';

      document.body.appendChild(clone);
      
      // Wait for layout to settle (simulating FetchDataPage logic)
      await new Promise(resolve => setTimeout(resolve, 300));

      const dataUrl = await toJpeg(clone, {
        quality: 0.95,
        backgroundColor: '#ffffff',
        pixelRatio: 2,
      });
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (pdf.internal.pageSize.getHeight());
      
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgWidth = imgProps.width;
      const imgHeight = imgProps.height;
      
      const ratio = imgWidth / imgHeight;
      
      const finalPdfWidth = pdfWidth;
      const finalPdfHeight = pdfWidth / ratio;
      
      pdf.addImage(dataUrl, 'JPEG', 0, 0, finalPdfWidth, finalPdfHeight);
      pdf.save(`تقرير-الانتاج-${startDate}-${endDate}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('حدث خطأ أثناء إنشاء ملف PDF');
    } finally {
      // Cleanup
      if (clone && document.body.contains(clone)) {
        document.body.removeChild(clone);
      }
      setIsGeneratingPdf(false);
    }
  };

// Styles for Pdf Report Rows
const PdfRow = ({ label, value, bg = '#fff' }: { label: string, value: string | number, bg?: string }) => (
  <div style={{ display: 'flex', borderBottom: '2px solid #000', backgroundColor: bg }}>
    <div style={{ 
      width: '35%', 
      padding: '8px', 
      textAlign: 'center', 
      fontWeight: 'bold', 
      borderRight: '2px solid #000',
      fontSize: '14px'
    }}>
      {value}
    </div>
    <div style={{ 
      width: '65%', 
      padding: '8px', 
      textAlign: 'right', 
      fontWeight: 'bold', 
      fontSize: '14px',
      backgroundColor: '#e6f3ff' // Light blue similar to image
    }}>
      {label}
    </div>
  </div>
);

  return (
    <div className="min-h-screen bg-slate-50 pb-20" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">تقرير الانتاج المجمع</h1>
                <p className="text-sm text-slate-500 font-medium">
                  {new Date(startDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })} 
                  <span className="mx-2">-</span>
                  {new Date(endDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => handleQuickRange(d)}
                  className="hidden sm:block px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-200">
                  {d} يوم
                </button>
              ))}
              <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>
              <button onClick={exportCSV}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-2 shadow-sm">
                <FileText className="w-4 h-4 text-emerald-600" />
                <span>اكسيل</span>
              </button>
              <button onClick={generatePDF} disabled={isGeneratingPdf}
                className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors flex items-center gap-2 shadow-sm">
                {isGeneratingPdf ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>PDF</span>
              </button>
            </div>
          </div>

          {/* Date Range */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center bg-white rounded-md border border-slate-300 shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-l border-slate-300">
                <Calendar className="w-4 h-4 text-slate-500" />
              </div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm focus:outline-none focus:ring-0 px-3 py-1.5 w-36 cursor-pointer" />
              <div className="w-px h-8 bg-slate-300"></div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none text-slate-700 text-sm focus:outline-none focus:ring-0 px-3 py-1.5 w-36 cursor-pointer" />
            </div>
            <button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 300); }}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors border border-transparent hover:border-indigo-100">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        
        {/* Working Days Config */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-indigo-500" />
              <span className="text-slate-700 font-medium">أيام العمل المحتسبة:</span>
              <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">{stats.workingDays}</span>
              <span className="text-slate-400">من أصل {stats.totalDays} يوم</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={autoDetectOffDays}
                className="text-xs px-3 py-1.5 font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors">
                اكتشاف العطلات
              </button>
              <button onClick={() => setShowDaySelector(!showDaySelector)}
                className="text-xs px-3 py-1.5 font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors shadow-sm">
                {showDaySelector ? 'اخفاء التفاصيل' : 'تعديل الأيام'}
              </button>
              {excludedDays.size > 0 && (
                <button onClick={() => setExcludedDays(new Set())}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="إلغاء جميع العطلات">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          {showDaySelector && (
            <div className="px-5 py-4 bg-white flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {stats.dailyData.map(day => {
                const hasProduction = day.wide + day.bous > 0;
                return (
                  <button key={day.date} onClick={() => toggleExcludeDay(day.date)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-all font-medium flex items-center gap-1.5 ${
                      day.excluded 
                        ? 'bg-red-50 border-red-200 text-red-600 line-through decoration-red-400' 
                        : hasProduction
                          ? 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-sm'
                          : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    }`}>
                    {fmtDay(day.date)}
                    {!hasProduction && !day.excluded && <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-1 h-full bg-blue-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">المكن العريض</div>
            <div className="text-3xl font-bold text-slate-800">{fmt(stats.totalWide)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2 bg-slate-50 inline-block px-2 py-1 rounded">
              متوسط: <span className="text-blue-600">{fmt(stats.avgWide)}</span> / يوم
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1 h-full bg-emerald-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">البوص</div>
            <div className="text-3xl font-bold text-slate-800">{fmt(stats.totalBous)}</div>
            <div className="text-xs font-medium text-emerald-600 mt-2">انتاج تام</div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1 h-full bg-indigo-500"></div>
            <div className="text-sm font-medium text-slate-500 mb-2">الداخلي (المجمع)</div>
            <div className="text-3xl font-bold text-indigo-600">{fmt(stats.totalInternal)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2">عريض + بوص</div>
          </div>
          
          <div className="bg-slate-900 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-white relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
            <div className="text-sm font-medium text-slate-400 mb-2">الاجمالي الكلي</div>
            <div className="text-3xl font-bold">{fmt(stats.grandTotal)}</div>
            <div className="text-xs font-medium text-slate-400 mt-2 flex justify-between">
              <span>شامل الخارجي</span>
              <span className="text-emerald-400">+{((stats.totalExternal/stats.grandTotal)*100 || 0).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* External Production - Moved Below Totals and Styled */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
           {/* Section Header */}
           <button onClick={() => setShowExternalDetails(!showExternalDetails)}
             className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors bg-white group">
             <div className="flex items-center gap-4">
                <div className="p-2.5 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors">
                  <Factory className="w-6 h-6 text-orange-600" />
                </div>
                <div className="text-right">
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-orange-700 transition-colors">انتاج المصانع الخارجية</h3>
                  <p className="text-sm text-slate-500">اضغط لعرض التفاصيل حسب المصنع</p>
                </div>
             </div>
             <div className="flex items-center gap-4">
               <div className="flex flex-col items-end">
                 <span className="text-xs text-slate-400 font-medium">الاجمالي الخارجي</span>
                 <span className="text-xl font-bold text-orange-600 tabular-nums">{fmt(stats.totalExternal)}</span>
               </div>
               <div className={`text-slate-400 transition-transform duration-200 ${showExternalDetails ? 'rotate-180' : ''}`}>
                 <ChevronDown className="w-5 h-5" />
               </div>
             </div>
           </button>
           
           {/* Details Panel */}
           {showExternalDetails && (
             <div className="border-t border-slate-100 bg-slate-50 animate-in slide-in-from-top-1 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                  {stats.externalByFactory.length > 0 ? stats.externalByFactory.map(([factory, amount]) => (
                    <div key={factory} className="bg-white border border-slate-200 rounded-lg p-3 hover:border-orange-200 transition-colors flex items-center justify-between shadow-sm">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-xs font-bold text-orange-700">
                           {factory.substring(0,2)}
                         </div>
                         <span className="font-semibold text-slate-700">{factory}</span>
                       </div>
                       <span className="font-bold text-orange-600 tabular-nums">{fmt(amount)}</span>
                    </div>
                  )) : (
                     <div className="col-span-full py-8 text-center text-slate-400">
                        لا يوجد انتاج خارجي مسجل في هذه الفترة
                     </div>
                  )}
                </div>
             </div>
           )}
        </div>

        {/* Content Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Daily Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden lg:col-span-2">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">تفاصيل الانتاج اليومي</h3>
              <span className="text-xs font-medium bg-white border border-slate-200 text-slate-500 px-2.5 py-1 rounded-full">{stats.totalDays} يوم</span>
            </div>
            
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-sm">
                  <tr className="bg-slate-50 text-slate-500 text-xs border-b border-slate-200">
                    <th className="px-5 py-3 text-right font-semibold">التاريخ</th>
                    <th className="px-5 py-3 text-center font-semibold">العريض</th>
                    <th className="px-5 py-3 text-center font-semibold">البوص</th>
                    <th className="px-5 py-3 text-center font-semibold">خارجي</th>
                    <th className="px-5 py-3 text-center font-semibold bg-slate-100 text-slate-700">المجموع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stats.dailyData.map((day) => (
                    <tr key={day.date} 
                      className={`transition-colors hover:bg-slate-50 group ${day.excluded ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-5 py-3 font-medium text-slate-600">
                        <div className="flex items-center gap-2">
                          {day.excluded && <X className="w-3 h-3 text-red-500" />}
                          <span className={day.excluded ? 'line-through decoration-slate-300 text-slate-400' : ''}>{fmtDay(day.date)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-slate-700 font-medium">
                        {day.wide > 0 ? fmt(day.wide) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-emerald-600 font-medium">
                        {day.bous > 0 ? fmt(day.bous) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums text-orange-600 font-medium">
                        {day.external > 0 ? fmt(day.external) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3 text-center tabular-nums font-bold text-slate-800 bg-slate-50/50 group-hover:bg-slate-100/50 transition-colors border-l border-slate-100">
                        {fmt(day.wide + day.bous + day.external)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-white shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-slate-200 font-bold text-slate-800">
                  <tr>
                    <td className="px-5 py-3">المجموع</td>
                    <td className="px-5 py-3 text-center tabular-nums text-blue-600">{fmt(stats.totalWide)}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-emerald-600">{fmt(stats.totalBous)}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-orange-600">{fmt(stats.totalExternal)}</td>
                    <td className="px-5 py-3 text-center tabular-nums bg-slate-100">{fmt(stats.grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* External Details - REMOVED FROM GRID as it is now above */}
          {/* <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">...</div> */}

          {/* Scrap Details */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit lg:col-span-2">
            <button onClick={() => setShowScrapDetails(!showScrapDetails)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-800">تحليل السقط</div>
                  <div className="text-xs text-slate-500 mt-0.5">الكميات والأسباب</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                   <span className="text-sm font-bold text-slate-700">{fmt(stats.totalScrap)} كجم</span>
                   <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                       stats.scrapPercent > 2 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-green-100 text-green-700 border-green-200'
                     }`}>
                     {stats.scrapPercent.toFixed(1)}%
                   </span>
                </div>
                {showScrapDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>
            </button>
            
            {showScrapDetails && (
              <div className="border-t border-slate-100 bg-slate-50 p-4 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {stats.scrapReasons.length > 0 ? stats.scrapReasons.map(([reason, amount]) => (
                    <div key={reason} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between shadow-sm">
                      <span className="text-slate-700 font-medium text-sm">{reason}</span>
                      <span className="font-bold text-red-600 bg-red-50 px-2 py-1 rounded text-sm">{fmt(amount)}</span>
                    </div>
                  )) : (
                    <div className="col-span-full py-4 text-center text-slate-400 text-sm">لا يوجد سقط مسجل في هذه الفترة</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Yearly Production */}
          <div className="bg-gradient-to-r from-blue-900 to-slate-800 rounded-xl shadow-md border border-blue-800/50 overflow-hidden lg:col-span-2 text-white relative">
            <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-x-10 -translate-y-10"></div>
            <div className="px-6 py-5 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/10 shadow-inner">
                  <BarChart3 className="w-6 h-6 text-blue-100" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">إجمالي الانتاج السنوي</h3>
                  <p className="text-blue-200 text-sm mt-0.5 font-medium">من 1/1/2026 حتى اليوم</p>
                </div>
              </div>
              <div className="text-right">
                 <div className="text-3xl font-bold tabular-nums tracking-tight">{fmt(yearlyTotal)}</div>
                 <div className="text-xs text-blue-300 font-medium mt-1 uppercase tracking-wider">كجم (شامل الخارجي)</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Hidden Print Template - Replicates Image Layout Correctly */}
      <div 
        ref={printRef}
        data-print-container
        style={{
          position: 'absolute',
          top: 0,
          left: -9999,
          width: '210mm',
          minHeight: '297mm',
          backgroundColor: '#fff',
          fontFamily: 'Arial, sans-serif',
          color: '#000',
          padding: '20px',
          direction: 'rtl',
          display: 'none' // will be made block by html2canvas
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '20px', fontWeight: 'bold', fontSize: '18px' }}>
          تقرير الانتاج المجمع من {new Date(startDate).toLocaleDateString('en-GB')} الى {new Date(endDate).toLocaleDateString('en-GB')}
        </div>

        <div style={{ border: '2px solid #000', marginBottom: '20px' }}>
          <PdfRow label="اجمالي انتاج المكن العريض" value={fmt(stats.totalWide)} />
          <PdfRow label={`متوسط انتاج اليوم للمكن العريض /${stats.workingDays}`} value={fmt(stats.avgWide)} />
          <PdfRow label="اجمالي انتاج البوص" value={fmt(stats.totalBous)} />
          <PdfRow label="اجمالي التصنيع في صالة الانتاج" value={fmt(stats.totalInternal)} />
          
          {stats.externalByFactory.map(([factory, amount]) => (
             <PdfRow key={factory} label={`اجمالي التصنيع في مصنع ${factory}`} value={fmt(amount)} />
          ))}

          {/* Spacer row if needed or just continue */}
          <div style={{ height: '20px', borderBottom: '2px solid #000', backgroundColor: '#fff' }}></div>

          <PdfRow label="اجمالي التصنيع الخارجي" value={fmt(stats.totalExternal)} />
          
          <div style={{ display: 'flex', borderBottom: '2px solid #000', backgroundColor: '#2563eb' }}>
             <div style={{ width: '35%', padding: '8px', textAlign: 'center', fontWeight: 'bold', color: '#fff', fontSize: '16px', borderRight: '2px solid #000' }}>
               {fmt(stats.grandTotal)}
             </div>
             <div style={{ width: '65%', padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#fff', fontSize: '16px' }}>
               اجمالي انتاج المصنع والتصنيع الخارجي
             </div>
          </div>

          <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
             <div style={{ width: '50%', borderRight: '2px solid #000' }}>
                 <div style={{ borderBottom: '2px solid #000', padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>كمية السقط</div>
                 <div style={{ padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>{fmt(stats.totalScrap)}</div>
             </div>
             <div style={{ width: '50%' }}>
                 <div style={{ borderBottom: '2px solid #000', padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>نسبة السقط من انتاج المكن العريض</div>
                 <div style={{ padding: '5px', textAlign: 'center', color: 'red', fontWeight: 'bold' }}>{stats.scrapPercent.toFixed(1)}%</div>
             </div>
          </div>
          
           {/* Detailed Table Section resembling the bottom table in image */}
           <div style={{ marginTop: '0', borderBottom: '2px solid #000' }}>
              <div style={{ backgroundColor: '#e2e8f0', padding: '5px', textAlign: 'center', fontWeight: 'bold', borderBottom: '2px solid #000' }}>
                بيانات تفصيلية
              </div>
              
              <div style={{ display: 'flex', borderBottom: '2px solid #000', fontSize: '12px', fontWeight: 'bold', backgroundColor: '#fff' }}>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>المكن العريض</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>الخارجي</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center', borderRight: '2px solid #000' }}>البوص</div>
                 <div style={{ width: '25%', padding: '5px', textAlign: 'center' }}>المجموع</div>
              </div>

               <div style={{ display: 'flex', borderBottom: '2px solid #000', fontSize: '14px', fontWeight: 'bold' }}>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalWide)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalExternal)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center', borderRight: '2px solid #000' }}>{fmt(stats.totalBous)}</div>
                 <div style={{ width: '25%', padding: '8px', textAlign: 'center' }}>{fmt(stats.grandTotal)}</div>
              </div>
           </div>

        </div>
        
        <div style={{ textAlign: 'left', fontSize: '10px', color: '#666', marginTop: '10px' }}>
          تم استخراج التقرير في: {new Date().toLocaleString('ar-EG')}
        </div>
      </div>
    </div>
  );
};
