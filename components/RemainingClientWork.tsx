import React, { useMemo, useRef, useState } from 'react';
import { OrderRow, MachineSS, CustomerSheet } from '../types'; 
import { parseFabricName } from '../services/data';
import { AlertCircle, Activity, CalendarClock, Ban, CheckCircle2, Download, Loader2, X, Bug, Terminal } from 'lucide-react';
import { toJpeg } from 'html-to-image';
import jsPDF from 'jspdf';

interface RemainingClientWorkProps {
  orders: OrderRow[];
  machines: MachineSS[];
  externalFactories: any[];
  customers: CustomerSheet[];
  activeDay: string;
  onClose: () => void;
}

export const RemainingClientWork: React.FC<RemainingClientWorkProps> = ({
  orders,
  machines,
  externalFactories,
  customers,
  activeDay,
  onClose
}) => {
  
  // Helper to get client name
  const getClientName = (customerId?: string) => {
      if (!customerId) return 'Unknown';
      const c = customers.find(c => c.id === customerId);
      return c ? c.name : 'Unknown';
  };

  const [showDebug, setShowDebug] = useState(false);

  const { displayGroups, debugStats } = useMemo(() => {
    const logs: any[] = [];
    logs.push(`Starting processing for date: ${activeDay}`);
    logs.push(`Total Orders: ${orders.length}`);
    logs.push(`Total Customers in Dictionary: ${customers.length}`);

    // 1. Group by Client
    const groups: Record<string, OrderRow[]> = {};
    const unknownClients: OrderRow[] = [];

    orders.forEach(o => {
        const clientName = getClientName(o.customerId);
        if (clientName === 'Unknown') {
            unknownClients.push(o);
        } else {
            if (!groups[clientName]) groups[clientName] = [];
            groups[clientName].push(o);
        }
    });

    if (unknownClients.length > 0) {
        logs.push(`WARNING: ${unknownClients.length} orders have unknown customers. Sample IDs: ${unknownClients.slice(0, 3).map(o => o.customerId).join(', ')}`);
    }

    const displayGroupsAcc: Record<string, any[]> = {};
    const stats: any[] = [];

    // 2. Iterate clients (Alphabetical Sort)
    // We want to ensure we catch ALL clients that have orders, even if they aren't in the customers list (though getClientName handles that by returning Unknown)
    // But wait, getClientName RELIES on the customers list. If a customer is new and not in the 'customers' prop, they show as 'Unknown'.
    // The user said "customers I recently added". This implies the 'customers' list passed to this component might be stale or incomplete.
    
    const sortedClients = Object.keys(groups).sort();
    
    logs.push(`Found ${sortedClients.length} clients with orders: ${sortedClients.join(', ')}`);

    sortedClients.forEach(client => {
        const clientOrders = groups[client];
        
        // Debug for specific clients
        const clientLog = {
            client,
            totalOrders: clientOrders.length,
            withRemaining: 0,
            matches: [] as string[],
            status: 'Skipped (No Remaining)',
            allOrders: clientOrders.map(o => {
                // Calculate Dynamic Remaining for Debug View (Logic copied from main calculation)
                const { shortName: oShort } = parseFabricName(o.material || '');
                const ref = `${client}-${o.material}`;
                let machineRem = 0;
                let isWorking = false;

                machines.forEach(m => {
                    const activeLog = m.dailyLogs?.find(l => l.date === activeDay);
                    if (activeLog) {
                        const { shortName: lShort } = parseFabricName(activeLog.fabric || '');
                        const isIdMatch = (activeLog.orderId && activeLog.orderId === o.id);
                        
                        const logClientNorm = (activeLog.client || '').trim().toLowerCase();
                        const orderClientNorm = (client || '').trim().toLowerCase();
                        const isClientMatch = logClientNorm === orderClientNorm || activeLog.clientId === o.customerId;

                        const logFabricNorm = (activeLog.fabric || '').trim().toLowerCase();
                        const orderFabricNorm = (o.material || '').trim().toLowerCase();
                        const isFabricMatch = logFabricNorm === orderFabricNorm || 
                                              (lShort && oShort && lShort.toLowerCase() === oShort.toLowerCase());

                        const logRefNorm = (activeLog.orderReference || '').trim().toLowerCase();
                        const refNorm = ref.trim().toLowerCase();
                        const isRefMatch = logRefNorm === refNorm;

                        if (isIdMatch || isRefMatch || (isClientMatch && isFabricMatch)) {
                            machineRem += (Number(activeLog.remainingMfg) || 0);
                            isWorking = true;
                        }
                    }
                });

                // If working, override static remaining with machine remaining
                const finalRemaining = (isWorking && machineRem > 0) ? machineRem : (o.remainingQty || 0);

                return {
                    id: o.id,
                    fabric: o.material,
                    remaining: finalRemaining,
                    staticRemaining: o.remainingQty || 0,
                    isWorking,
                    required: o.requiredQty
                };
            })
        };

        // Check if client has ANY remaining work (using the DYNAMIC value)
        const hasRemainingWork = clientLog.allOrders.some(o => o.remaining > 0);

        if (hasRemainingWork) {
            // Filter orders for this client - only show those with Remaining > 0
            // UPDATE: Use the calculated remaining from clientLog.allOrders to be consistent
            // We need to map back to the original objects but with updated logic in the next step
            // Actually, the main logic below recalculates everything. We just need to ensure we enter this block.
            
            // To be safe, let's filter the original orders based on our calculated knowledge
            const activeOrderIds = new Set(clientLog.allOrders.filter(o => o.remaining > 0).map(o => o.id));
            const activeOrders = clientOrders.filter(o => activeOrderIds.has(o.id));
            
            clientLog.withRemaining = activeOrders.length;
            clientLog.status = 'Processed';
            
            if (activeOrders.length > 0) {
                 displayGroupsAcc[client] = activeOrders.map(order => {
                    const statusBadges: { label: string; type: 'WORKING' | 'PLANNED' | 'EXTERNAL' | 'PENDING'; details?: string }[] = [];
                    
                    const clientName = client;
                    const reference = `${clientName}-${order.material}`;
                    
                    const { shortName: orderShort } = parseFabricName(order.material || '');
                    
                    let activeRemaining = 0;

                    // 1. Check Internal Machines
                    machines.forEach(machine => {
                        const activeLog = machine.dailyLogs?.find(l => l.date === activeDay);
                        
                        if (activeLog) {
                            const { shortName: logShort } = parseFabricName(activeLog.fabric || '');
                            const isIdMatch = (activeLog.orderId && activeLog.orderId === order.id);
                            
                            const logClientNorm = (activeLog.client || '').trim().toLowerCase();
                            const orderClientNorm = (clientName || '').trim().toLowerCase();
                            const isClientMatch = logClientNorm === orderClientNorm || activeLog.clientId === order.customerId;

                            const logFabricNorm = (activeLog.fabric || '').trim().toLowerCase();
                            const orderFabricNorm = (order.material || '').trim().toLowerCase();
                            const isFabricMatch = logFabricNorm === orderFabricNorm || 
                                                  (logShort && orderShort && logShort.toLowerCase() === orderShort.toLowerCase());

                            const logRefNorm = (activeLog.orderReference || '').trim().toLowerCase();
                            const refNorm = reference.trim().toLowerCase();
                            const isRefMatch = logRefNorm === refNorm;

                            if (isIdMatch || isRefMatch || (isClientMatch && isFabricMatch)) {
                                statusBadges.push({
                                    label: `${machine.name} - Working`,
                                    type: 'WORKING'
                                });
                                clientLog.matches.push(`Working: ${machine.name} for ${order.material}`);
                                activeRemaining += (Number(activeLog.remainingMfg) || 0);
                            }
                        }
                    });

                    // 2. Check External Factories
                    externalFactories.forEach(factory => {
                        if (factory.plans && Array.isArray(factory.plans)) {
                            factory.plans.forEach((plan: any) => {
                                const { shortName: planShort } = parseFabricName(plan.fabric || '');
                                
                                const isClientMatch = plan.client && plan.client.trim().toLowerCase() === (clientName || '').toLowerCase();
                                const isFabricMatch = (plan.fabric && plan.fabric.trim().toLowerCase() === (order.material || '').toLowerCase()) ||
                                                      (planShort && orderShort && planShort.toLowerCase() === orderShort.toLowerCase());

                                const constructedRef = `${plan.client}-${plan.fabric ? plan.fabric.split(/[\s-]+/).map((w: string) => w[0]).join('').toUpperCase() : ''}`;
                                const isRefMatch = (plan.orderReference && plan.orderReference.toLowerCase() === reference.toLowerCase()) ||
                                                (constructedRef.toLowerCase() === reference.toLowerCase());

                                if ((isClientMatch && isFabricMatch) || isRefMatch) {
                                    if (plan.status === 'ACTIVE') {
                                        statusBadges.push({
                                            label: factory.name,
                                            type: 'EXTERNAL',
                                            details: 'External'
                                        });
                                        clientLog.matches.push(`External: ${factory.name}`);
                                    }
                                }
                            });
                        }
                    });

                    // 3. Check Future Plans
                    const isWorking = statusBadges.some(b => b.type === 'WORKING');
                    
                    if (!isWorking) {
                        machines.forEach(machine => {
                            if (machine.futurePlans) {
                                const planMatch = machine.futurePlans.some(p => {
                                    const { shortName: planShort } = parseFabricName(p.fabric || '');
                                    return (p.fabric === order.material || planShort === orderShort) && 
                                           (p.orderName === reference || p.fabric === order.material || planShort === orderShort);
                                });

                                if (planMatch) {
                                    statusBadges.push({
                                        label: `${machine.name}`,
                                        type: 'PLANNED',
                                        details: 'Planned' 
                                    });
                                    clientLog.matches.push(`Planned: ${machine.name}`);
                                }
                            }
                        });
                    }

                    if (statusBadges.length === 0) {
                        statusBadges.push({
                            label: 'Pending',
                            type: 'PENDING'
                        });
                    }

                    const ordered = order.requiredQty || 0;
                    let remaining = order.remainingQty || 0;
                    if (isWorking && activeRemaining > 0) {
                        remaining = activeRemaining;
                    }
                    const manufactured = Math.max(0, ordered - remaining);
                    const fabricDisplay = orderShort || order.material || 'Unknown';

                    return {
                        id: order.id,
                        client: clientName,
                        fabric: fabricDisplay,
                        fabricFull: order.material,
                        statusBadges,
                        ordered,
                        manufactured,
                        remaining
                    };
                 }).sort((a, b) => b.remaining - a.remaining); 
            }
        }
        stats.push(clientLog);
    });

    return { displayGroups: displayGroupsAcc, debugStats: { logs, clientStats: stats } };
  }, [orders, machines, externalFactories, customers, activeDay]); // Removed groupedRows dependency as it was internal

  const totals = useMemo(() => {
    let tOrdered = 0;
    let tManufactured = 0;
    let tRemaining = 0;
    
    Object.values(displayGroups).flat().forEach(r => {
        tOrdered += r.ordered;
        tManufactured += r.manufactured;
        tRemaining += r.remaining;
    });
    
    return { tOrdered, tManufactured, tRemaining };
  }, [displayGroups]);

  const contentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPdf = async () => {
    if (!contentRef.current) return;
    
    try {
        setIsExporting(true);

        // 1. Create a clone to manipulate styles for printing
        const original = contentRef.current;
        const clone = original.cloneNode(true) as HTMLElement;
        
        // 2. Set styles to ensure full capture (expand scrollable areas)
        // Use FetchDataPage strategy: Place behind content at (0,0) rather than off-screen
        clone.style.position = 'absolute';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.zIndex = '-9999'; 
        clone.style.width = 'fit-content'; // Allow width to expand if needed
        clone.style.height = 'fit-content';
        clone.style.backgroundColor = '#ffffff';

        // 3. Expand the inner scrollable container
        const scrollContainer = clone.querySelector('.overflow-auto');
        if (scrollContainer) {
            (scrollContainer as HTMLElement).style.overflow = 'visible';
            (scrollContainer as HTMLElement).style.height = 'auto';
            (scrollContainer as HTMLElement).style.display = 'block'; // Ensure block display
        }

        // 4. Hide 'no-print' elements (buttons)
        const noPrints = clone.querySelectorAll('.no-print');
        noPrints.forEach(el => (el as HTMLElement).style.display = 'none');

        // NEW: Compact Layout for PDF Optimizations
        // Make text smaller and reduce padding to fit more on page
        const tables = clone.querySelectorAll('table');
        tables.forEach(table => {
            (table as HTMLElement).style.width = '1000px'; // Force a readable width
            (table as HTMLElement).style.maxWidth = '1000px';
        });

        const cells = clone.querySelectorAll('td, th');
        cells.forEach(cell => {
            (cell as HTMLElement).style.padding = '4px 6px'; // Tighter padding
            (cell as HTMLElement).style.fontSize = '9px';    // Smaller font
        });

        // Enhance Headers
        const headers = clone.querySelectorAll('th');
        headers.forEach(h => {
             (h as HTMLElement).style.backgroundColor = '#f1f5f9';
             (h as HTMLElement).style.color = '#334155';
             (h as HTMLElement).style.fontSize = '12px'; // Slightly larger for readability
        });

        // Optimize Client Group Headers (Sticky ones) - Layout Fix
        const clientHeaders = clone.querySelectorAll('.sticky.top-20');
        clientHeaders.forEach(ch => {
             // We remove sticky for print/pdf usually as it messes up flow, but here we just convert to static block
             (ch as HTMLElement).style.position = 'static'; 
             (ch as HTMLElement).style.padding = '0'; // Remove padding from container to avoid overflow look
             (ch as HTMLElement).style.marginLeft = '0'; // Reset negative margins if any
             (ch as HTMLElement).style.boxShadow = 'none'; // Remove bubble shadow
             (ch as HTMLElement).style.border = 'none'; // Remove bubble border
             (ch as HTMLElement).style.background = 'transparent'; // Remove white background from bubble
             
             // Client Name text
             const nameDiv = ch.querySelector('.text-lg');
             if (nameDiv) {
                (nameDiv as HTMLElement).style.fontSize = '14px'; // Bigger
                (nameDiv as HTMLElement).style.fontWeight = 'bold';
                (nameDiv as HTMLElement).style.color = '#1e3a8a'; // Dark Blue
             }
             
             // Subtext (order count) - Hide it or make it small
             const countDiv = ch.querySelector('[class*="text-[10px]"]');
             if (countDiv) {
                 (countDiv as HTMLElement).style.display = 'none'; // Hide count to save visual noise
             }
        });

        // ARABIC HEADER INJECTION + COMPACT LAYOUT
        const headerContainer = clone.querySelector('.flex.flex-col'); // Selects the header div container
        if (headerContainer) {
            // Remove existing header content
            headerContainer.innerHTML = '';
            
            // Create New Arabic Compact Header
            const newHeader = document.createElement('div');
            newHeader.style.display = 'flex';
            newHeader.style.flexDirection = 'row-reverse'; // Arabic RTL Feel
            newHeader.style.alignItems = 'center';
            newHeader.style.justifyContent = 'space-between';
            newHeader.style.width = '100%;'
            newHeader.style.padding = '4px 0';
            newHeader.style.borderBottom = '1px solid #e2e8f0';
            newHeader.style.marginBottom = '2px';

            // Title
            const title = document.createElement('h1');
            title.textContent = '     متبقي التصنيع    '; // "Remaining Production Orders"
            title.style.fontSize = '18px';
            title.style.fontWeight = '800';
            title.style.fontFamily = 'serif'; // Give it a formal look
            title.style.margin = '0';
            title.style.color = '#0f172a';
            
            // Date (Inline)
            const dateSpan = document.createElement('span');
            dateSpan.textContent = activeDay;
            dateSpan.style.fontSize = '14px';
            dateSpan.style.color = '#64748b';
            dateSpan.style.marginLeft = '12px';
            dateSpan.style.fontWeight = 'normal';

            title.appendChild(dateSpan);
            newHeader.appendChild(title);
            
            // Append back
            headerContainer.appendChild(newHeader);
        }
        
        // Remove rowSpans styling oddities by ensuring alignment
        const rowspanCells = clone.querySelectorAll('td[rowSpan]');
        rowspanCells.forEach(td => {
            (td as HTMLElement).style.verticalAlign = 'top';
            (td as HTMLElement).style.backgroundColor = '#ffffff';
            (td as HTMLElement).style.borderRight = '1px solid #e2e8f0'; // Add separator line
        });

        // Totals Footer - Make it pop!
        const tfoot = clone.querySelector('tfoot');
        if (tfoot) {
            const footerCells = tfoot.querySelectorAll('td');
            footerCells.forEach(c => {
                 (c as HTMLElement).style.fontSize = '12px'; // Larger than body
                 (c as HTMLElement).style.fontWeight = '800'; // Extra bold
                 (c as HTMLElement).style.backgroundColor = '#f8fafc'; // slate-50
                 (c as HTMLElement).style.borderTop = '2px solid #0f172a'; // slate-900 (High contrast)
                 (c as HTMLElement).style.color = '#0f172a';
            });
        }
        
        // Scale down badges
        const badges = clone.querySelectorAll('span.rounded-full');
        badges.forEach(b => {
             (b as HTMLElement).style.fontSize = '8px'; // Slightly bigger than 7px
             (b as HTMLElement).style.padding = '1px 4px';
        });

        document.body.appendChild(clone);

        // Wait a bit for layout 
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Ensure fonts are loaded
        await document.fonts.ready;

        // 5. Generate Image
        const dataUrl = await toJpeg(clone, {
            quality: 0.95,
            backgroundColor: '#ffffff',
            pixelRatio: 2, // Higher resolution
            cacheBust: true, // Force reload images/fonts
        });

        // Verify dataUrl
        if (!dataUrl || dataUrl.length < 100) {
            throw new Error("Generated image was empty");
        }

        // 6. Cleanup clone
        document.body.removeChild(clone);

        // 7. Generate PDF
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const imgWidth = 210; // A4 Width
        const pageHeight = 297; // A4 Height
        
        const imgProps = pdf.getImageProperties(dataUrl);
        const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
        
        let heightLeft = imgHeight;
        let position = 0;

        // First Page
        pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        // Subsequent Pages
        while (heightLeft > 0) {
            position = heightLeft - imgHeight; // This logic in original was a bit standard, usually it's negative offset
            // Actually, for standard long image splicing:
            // Page 2: image is drawn at y = -297
            // Page 3: image is drawn at y = -594
            
            pdf.addPage();
            // We need to calculate the correct negative offset
            // We want to draw the image moved UP by 'pageHeight' relative to previous
            // Use current page index
            const pageInfo = pdf.getNumberOfPages();
            position = -(pageHeight * (pageInfo - 1)); 
            
            pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        pdf.save(`RemainingWork_${activeDay}.pdf`);
    } catch (error) {
        console.error("PDF Export failed:", error);
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white relative h-full font-sans" ref={contentRef}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 sticky top-0">
         {/* Note: We use class 'no-print' on buttons we don't want in print */}
         <div className="flex-1 flex justify-between items-center">
             <div className="flex flex-col">
                <h2 
                    className="text-xl font-bold text-slate-800 flex items-center gap-2 cursor-help select-none hover:bg-slate-50 p-1 -ml-1 rounded transition-colors"
                    onDoubleClick={() => setShowDebug(prev => !prev)}
                    title="Double click to toggle Debug View"
                >
                    <AlertCircle className="w-6 h-6 text-indigo-600" />
                    Remaining Client Work
                    {showDebug && <Bug className="w-4 h-4 text-red-500 animate-pulse ml-2" />}
                </h2>
                <p className="text-sm text-slate-500 mt-1">Outstanding production orders group by client • <span className="font-semibold text-slate-700">Date: {activeDay}</span></p>
            </div>
            
            <div className="flex items-center gap-3 no-print">
                <div className="flex items-center gap-4 text-xs font-medium mr-4">
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">
                        <Activity className="w-3 h-3" />
                        <span>Working</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 rounded border border-amber-100">
                        <CalendarClock className="w-3 h-3" />
                        <span>Planned</span>
                    </div>
                </div>

                <button 
                    onClick={handleExportPdf}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-md text-sm font-medium transition-colors border border-indigo-200"
                >
                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Export PDF
                </button>

                <button 
                    onClick={onClose}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
         </div>
      </div>

      {/* Debug Overlay */}
      {showDebug && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-12 no-print" onClick={() => setShowDebug(false)}>
            <div className="bg-slate-900 text-slate-200 rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden border border-slate-700" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-950">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-green-400" />
                        <h3 className="font-mono font-bold text-white">Debug Console</h3>
                    </div>
                    <button onClick={() => setShowDebug(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-auto p-4 font-mono text-xs">
                    <div className="mb-4 space-y-1 text-slate-400 border-b border-slate-800 pb-4">
                        {debugStats.logs.map((log: string, i: number) => (
                            <div key={i} className="whitespace-pre-wrap">{log}</div>
                        ))}
                    </div>
                    
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-800">
                                <th className="p-2">Client</th>
                                <th className="p-2 text-right">Total Orders</th>
                                <th className="p-2 text-right">Active (&gt;0)</th>
                                <th className="p-2">Status</th>
                                <th className="p-2">Matches Found</th>
                                <th className="p-2">Details (Raw DB Data)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {debugStats.clientStats.map((stat: any, i: number) => (
                                <tr key={i} className={`hover:bg-slate-800/50 ${stat.withRemaining > 0 ? 'text-white' : 'text-slate-500'}`}>
                                    <td className="p-2 font-bold text-indigo-300 align-top">{stat.client}</td>
                                    <td className="p-2 text-right align-top">{stat.totalOrders}</td>
                                    <td className="p-2 text-right align-top">{stat.withRemaining}</td>
                                    <td className="p-2 align-top">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase border ${
                                            stat.status === 'Processed' ? 'bg-green-900/30 text-green-400 border-green-900' : 'bg-slate-800 text-slate-500 border-slate-700'
                                        }`}>
                                            {stat.status}
                                        </span>
                                    </td>
                                    <td className="p-2 text-wrap break-all max-w-xs align-top">
                                        {stat.matches.length > 0 ? (
                                            <div className="flex flex-col gap-1">
                                                {stat.matches.map((m: string, mi: number) => (
                                                    <span key={mi} className="text-emerald-400 bg-emerald-950/30 px-1 rounded inline-block w-fit">
                                                        ✓ {m}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-slate-600">-</span>
                                        )}
                                    </td>
                                    <td className="p-2 align-top">
                                       <details className="group">
                                          <summary className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 select-none">Show {stat.allOrders.length} Orders</summary>
                                          <div className="mt-2 pl-2 border-l-2 border-slate-700 space-y-1 max-h-40 overflow-auto custom-scrollbar">
                                              {stat.allOrders.map((o: any, idx: number) => (
                                                  <div key={idx} className={`text-[10px] grid grid-cols-[1fr,auto] gap-2 ${Number(o.remaining) > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                                      <span className="truncate" title={o.fabric}>
                                                        {o.fabric || 'Unknown Fabric'}
                                                        {o.isWorking && <span className="ml-1 text-emerald-500 font-bold">(Live)</span>}
                                                      </span>
                                                      <span className="font-mono">
                                                        Rem: <span className={Number(o.remaining) > 0 ? 'text-green-400 font-bold' : 'text-red-900'}>{o.remaining}</span> 
                                                        <span className="text-slate-600 text-[9px] mx-1">
                                                            (DB: {o.staticRemaining})
                                                        </span>
                                                         / Req: {o.required}
                                                      </span>
                                                  </div>
                                              ))}
                                          </div>
                                       </details>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 custom-scrollbar">
        <div className="bg-white rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] border border-slate-200 overflow-hidden">
            <table className="w-full text-sm border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-semibold text-xs uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 text-left w-48">Client</th>
                        <th className="px-6 py-4 text-left">Fabric</th>
                        <th className="px-6 py-4 text-center w-32">Status</th>
                        <th className="px-6 py-4 text-right w-32">Total</th>
                        <th className="px-6 py-4 text-right w-32">Knitted</th>
                        <th className="px-6 py-4 text-right w-32 bg-indigo-50/50 text-indigo-900">Remaining</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {Object.entries(displayGroups).map(([client, rows], groupIndex) => (
                        <React.Fragment key={client}>
                            {rows.map((row, idx) => (
                                <tr key={row.id} className="hover:bg-slate-50 transition-colors group">
                                    {/* Client (Rowspan) */}
                                    {idx === 0 && (
                                        <td 
                                            className="px-6 py-4 text-left font-bold text-slate-800 bg-white border-r border-transparent align-top relative z-0" 
                                            rowSpan={rows.length}
                                        >
                                            <div className="sticky top-20 flex flex-col items-start bg-white/95 backdrop-blur-sm p-3 -ml-3 rounded-xl border border-slate-100 shadow-sm z-10">
                                                <div className="text-lg text-indigo-900 font-serif tracking-tight leading-tight">
                                                    {client}
                                                </div>
                                                <div className="text-[10px] text-slate-500 font-medium mt-1 uppercase tracking-wide">
                                                    {rows.length} Orders
                                                </div>
                                            </div>
                                        </td>
                                    )}

                                    {/* Fabric */}
                                    <td className="px-6 py-4 text-left">
                                        <div className="font-medium text-slate-700" title={row.fabric}>
                                            {row.fabric}
                                        </div>
                                    </td>

                                    {/* Status */}
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex flex-col gap-1 items-center justify-center">
                                            {row.statusBadges?.map((badge: any, bIdx: number) => {
                                                let badgeClass = "bg-slate-100 text-slate-600 border-slate-200";
                                                // Make WORKING status more vibrant/distinct as requested
                                                if (badge.type === 'WORKING') badgeClass = "bg-green-100 text-green-700 border-green-200 shadow-[0_0_8px_rgba(34,197,94,0.15)] font-bold";
                                                else if (badge.type === 'EXTERNAL') badgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                                                else if (badge.type === 'PLANNED') badgeClass = "bg-amber-50 text-amber-700 border-amber-200";
                                                
                                                return (
                                                    <span key={bIdx} className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap border lg:w-fit w-full text-center transition-all ${badgeClass}`}>
                                                        {badge.label}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </td>

                                    {/* Ordered (Total) */}
                                    <td className="px-6 py-4 text-right font-mono text-slate-600">
                                        {row.ordered.toLocaleString()}
                                    </td>

                                    {/* Manufactured (Knitted) */}
                                    <td className="px-6 py-4 text-right font-mono text-slate-600">
                                        {row.manufactured > 0 ? row.manufactured.toLocaleString() : '-'}
                                    </td>

                                    {/* Remaining */}
                                    <td className="px-6 py-4 text-right font-mono font-bold text-indigo-600 bg-indigo-50/30">
                                        {row.remaining.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                            {/* Separator row to visually distinct clients */}
                            {groupIndex < Object.keys(displayGroups).length - 1 && (
                                <tr className="bg-slate-50/50 border-b border-slate-200">
                                    <td colSpan={6} className="h-2"></td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                    {Object.keys(displayGroups).length === 0 && (
                        <tr>
                            <td colSpan={6} className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                                <CheckCircle2 className="w-12 h-12 text-slate-200" />
                                <span className="font-medium">All caught up! No remaining work found.</span>
                            </td>
                        </tr>
                    )}
                </tbody>
                <tfoot className="bg-slate-50 font-bold text-slate-700 border-t-2 border-slate-200 sticky bottom-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <tr>
                        <td colSpan={3} className="px-6 py-4 text-right text-xs uppercase tracking-wider text-slate-500">
                             Grand Totals
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-slate-800">
                            {totals.tOrdered.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-slate-800">
                            {totals.tManufactured.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-indigo-700 bg-indigo-50">
                            {totals.tRemaining.toLocaleString()}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
      </div>
    </div>
  );
};
