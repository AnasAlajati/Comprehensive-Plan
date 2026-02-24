import React, { useMemo } from 'react';
import { 
  Package, 
  CheckCircle2, 
  AlertCircle, 
  History, 
  Droplet,
  Factory,
  TrendingUp,
  Clock,
  FileText,
  Calendar
} from 'lucide-react';
import { OrderRow, MachineSS } from '../types';

interface OrderSummaryCardProps {
  order: OrderRow;
  imageUrl?: string;
  statusInfo: any;
  finishedDetails?: { uniqueMachines: string[], startDate?: string, endDate?: string, lastDate?: string } | null;
  onOpenHistory: (order: OrderRow) => void;
  onClick?: () => void;
  hasHistory?: boolean;
}

export const OrderSummaryCard: React.FC<OrderSummaryCardProps> = ({ 
  order, 
  imageUrl,
  statusInfo,
  finishedDetails,
  onOpenHistory,
  onClick,
  hasHistory 
}) => {
  
  // Calculate Production Stats from statusInfo (machine data)
  const ordered = order.requiredQty || 0;
  
  // Calculate remaining from multiple sources
  let remaining = 0;
  if (statusInfo?.remainingFromMachine !== undefined && statusInfo.remainingFromMachine > 0) {
    // Use machine data if available
    remaining = statusInfo.remainingFromMachine;
  } else if (order.remainingQty !== undefined) {
    // Use order's remaining qty
    remaining = order.remainingQty;
  } else {
    // Calculate from ordered - manufactured
    remaining = ordered - (order.manufacturedQty || 0);
  }
  
  const produced = Math.max(0, ordered - remaining);
  const progress = ordered > 0 ? (produced / ordered) * 100 : 0;
 
  // Get Machine Info
  const activeMachines = statusInfo?.active || [];
  const plannedMachines = statusInfo?.planned || [];
  const finishedMachines = activeMachines.filter((m: string) => m.includes('(Finished)'));
  const workingMachines = activeMachines.filter((m: string) => !m.includes('(Finished)'));
  
  // Calculate display status (same logic as table view)
  const hasAnyPlan = workingMachines.length > 0 || plannedMachines.length > 0;
  const isFinished = remaining <= 0 && hasHistory;
  const displayRemaining = remaining;
  
  // Determine which machines to show when finished
  let finishedMachineNames: string[] = [];
  if (!hasAnyPlan && displayRemaining <= 0 && finishedDetails && finishedDetails.uniqueMachines.length > 0) {
    // Use finishedDetails when no active plan
    finishedMachineNames = finishedDetails.uniqueMachines;
  } else if (isFinished && (workingMachines.length > 0 || plannedMachines.length > 0)) {
    // Use active/planned machines when finished with plan
    finishedMachineNames = [...new Set([...workingMachines, ...plannedMachines])];
  }
  
  // Calculate Dyeing Stats (Net Delivery)
  const dyeingStats = useMemo(() => {
    let netDelivery = 0;
    
    (order.dyeingPlan || []).forEach(batch => {
       const dEvents = batch.deliveryEvents || [];
       const delQty = dEvents.reduce((s, e) => s + (Number(e.quantityColorDelivered) || 0), 0);
       
       const retEvents = batch.returnEvents || [];
       const retQty = retEvents.reduce((s, e) => s + (Number(e.quantityColorReturned) || 0), 0);
       
       netDelivery += (delQty - retQty);
    });
    
    return { netDelivery };
  }, [order.dyeingPlan]);

  // Determine Overall Status
  let statusColor = 'bg-slate-100 text-slate-600';
  let statusText = 'Pending';
  
  if (workingMachines.length > 0) {
      statusColor = 'bg-emerald-100 text-emerald-700 border-emerald-200';
      statusText = 'In Production';
  } else if (finishedMachineNames.length > 0) {
      statusColor = 'bg-blue-100 text-blue-700 border-blue-200';
      statusText = 'Completed';
  } else if (remaining === 0 && ordered > 0) {
      statusColor = 'bg-blue-100 text-blue-700 border-blue-200';
      statusText = 'Complete';
  } else if (plannedMachines.length > 0) {
      statusColor = 'bg-amber-100 text-amber-700 border-amber-200';
      statusText = 'Planned';
  }

  return (
    <div className="bg-white rounded-lg border border-slate-300 shadow-sm hover:shadow-md hover:border-slate-400 transition-all duration-200 overflow-hidden">
      
      {/* Main Content Grid */}
      <div className="p-4">
        
        {/* Top Row: Image + Title + Status */}
        <div className="flex gap-3 mb-3">
          {/* Fabric Image */}
          <div className="w-16 h-16 rounded-md bg-slate-100 border border-slate-200 flex-shrink-0 overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt={order.material} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300">
                <Package size={18} />
              </div>
            )}
          </div>
          
          {/* Title + Status */}
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-slate-800 text-sm leading-tight truncate" title={order.material}>
              {order.material}
            </h4>
            
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusColor} flex items-center gap-1`}>
                <div className="w-1 h-1 rounded-full bg-current animate-pulse"></div>
                {statusText}
              </span>
              
              {order.accessory && (
                <span className="text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                  Acc: {order.accessory}
                </span>
              )}
            </div>
          </div>

          {/* Action Button */}
          <button 
            onClick={() => onOpenHistory(order)}
            className={`p-1.5 rounded-md transition-colors flex-shrink-0 h-fit ${
              hasHistory 
                ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200' 
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
            title="View Production History"
          >
            <History size={16} />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50 border border-slate-200 rounded-lg mb-4">
          <div className="p-3 text-center">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Ordered</div>
            <div className="text-xl font-black text-slate-800">{ordered.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg</span></div>
          </div>
          <div className="p-3 text-center">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Produced</div>
            <div className={`text-xl font-black ${produced >= ordered ? 'text-emerald-600' : 'text-slate-800'}`}>
              {produced.toLocaleString()} 
              {produced >= ordered && <CheckCircle2 size={14} className="inline ml-1 text-emerald-500" />}
            </div>
          </div>
          <div className="p-3 text-center">
             <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Remaining</div>
             <div className={`text-xl font-black ${remaining > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
               {remaining.toLocaleString()}
             </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs font-medium text-slate-500 mb-1.5">
            <span>Production Progress</span>
            <span className="text-slate-700 font-bold">{progress.toFixed(0)}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-500 ${produced >= ordered ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            ></div>
          </div>
        </div>

        {/* Machine Info */}
        {(workingMachines.length > 0 || plannedMachines.length > 0 || finishedMachineNames.length > 0) && (
          <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-200 text-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Factory size={12} />
              Machine Production
            </div>
            
            <div className="space-y-2">
              {/* Active Machines */}
              {workingMachines.length > 0 && (
                <div className="flex items-start gap-2 text-emerald-700 bg-emerald-50/50 p-2 rounded border border-emerald-100/50">
                  <TrendingUp size={14} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold block text-xs uppercase opacity-75">Active Now</span>
                    <span className="font-medium">{workingMachines.join(', ')}</span>
                  </div>
                </div>
              )}
              
              {/* Finished Machines */}
              {finishedMachineNames.length > 0 && displayRemaining <= 0 && (
                <div className="flex items-start gap-2 text-blue-700 bg-blue-50/50 p-2 rounded border border-blue-100/50">
                  <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs uppercase opacity-75">
                        {hasAnyPlan ? 'Finished on:' : 'Finished in:'}
                      </span>
                      <span className="font-medium">{finishedMachineNames.join(', ')}</span>
                    </div>
                    {finishedDetails?.startDate && finishedDetails.startDate !== '-' && finishedDetails?.endDate && finishedDetails.endDate !== '-' && (
                      <div className="text-xs text-blue-600 bg-white px-3 py-1.5 rounded border border-blue-200 whitespace-nowrap flex items-center gap-2 shadow-sm">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">Start</span>
                          <span className="font-bold">{finishedDetails.startDate}</span>
                        </div>
                        <span className="text-slate-400">→</span>
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">End</span>
                          <span className="font-bold">{finishedDetails.endDate}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Planned Machines */}
              {plannedMachines.length > 0 && (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-50/50 p-2 rounded border border-amber-100/50">
                  <Clock size={14} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs uppercase opacity-75">Scheduled:</span>
                      <span className="font-medium">{plannedMachines.join(', ')}</span>
                    </div>
                    {statusInfo?.startDate && statusInfo.startDate !== '-' && statusInfo?.endDate && statusInfo.endDate !== '-' && (
                      <div className="text-xs text-amber-600 bg-white px-3 py-1.5 rounded border border-amber-200 whitespace-nowrap flex items-center gap-2 shadow-sm">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">Start</span>
                          <span className="font-bold">{statusInfo.startDate}</span>
                        </div>
                        <span className="text-slate-400">→</span>
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 uppercase">End</span>
                          <span className="font-bold">{statusInfo.endDate}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Colors Section - DETAIL LIST REVERT */}
        {order.dyeingPlan && order.dyeingPlan.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4">
            <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex justify-between items-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Droplet size={12} />
                  Dyeing Plan ({order.dyeingPlan.length})
                </div>
                {dyeingStats.netDelivery > 0 && (
                  <div className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                    Delivered: {dyeingStats.netDelivery.toFixed(0)} kg
                  </div>
                )}
            </div>
            
            <div className="divide-y divide-slate-50">
              {order.dyeingPlan.map((batch, idx) => {
                const sEvents = batch.sentEvents || [];
                const sent = sEvents.reduce((s, e) => s + (Number(e.quantity) || 0), 0) + (Number(batch.quantitySentRaw) || Number(batch.quantitySent) || 0);
                const rEvents = batch.receiveEvents || [];
                const recv = rEvents.reduce((s, e) => s + (Number(e.quantityRaw) || 0), 0) + (Number(batch.receivedQuantity) || 0);
                const dEvents = batch.deliveryEvents || [];
                const del = dEvents.reduce((s, e) => s + (Number(e.quantityColorDelivered) || 0), 0);
                const retEvents = batch.returnEvents || [];
                const ret = retEvents.reduce((s, e) => s + (Number(e.quantityColorReturned) || 0), 0);
                const net = del - ret;
                // Calculate accessory delivery
                const accDel = dEvents.reduce((sum, e) => {
                  if (e.accessoryDeliveries) {
                    return sum + Object.values(e.accessoryDeliveries).reduce((a, b) => (a as number) + (b as number), 0);
                  }
                  return sum;
                }, 0);
                const accRet = retEvents.reduce((sum, e) => {
                  if (e.accessoryReturns) {
                    return sum + Object.values(e.accessoryReturns).reduce((a, b) => (a as number) + (b as number), 0);
                  }
                  return sum;
                }, 0);
                const netAcc = accDel - accRet;
                // const isDelivered = net >= (Number(batch.quantity) || 0) * 0.95;

                return (
                  <div key={idx} className="p-3 hover:bg-slate-50 transition-colors">
                    {/* Top Row: Color & Dyehouse */}
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                            <div 
                              className="w-3.5 h-3.5 rounded-full border border-slate-200 shadow-sm flex-shrink-0"
                              style={{ backgroundColor: batch.colorHex || batch.color?.toLowerCase() || '#cbd5e1' }}
                            ></div>
                            <div>
                                <div className="font-bold text-sm text-slate-800 leading-tight">{batch.color || 'N/A'}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    Planned: <span className="font-medium text-slate-700">{batch.quantity} kg</span>
                                </div>
                            </div>
                        </div>
                        
                        {batch.dyehouse && (
                             <div className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-1 rounded text-xs font-bold shadow-sm">
                                 {batch.dyehouse}
                             </div>
                        )}
                    </div>

                    {/* Middle Row: Dates & Dyehouse Status */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        {/* Dates Group */}
                        {(batch.formationDate || batch.dateSent) && (
                            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded border border-slate-100">
                                {batch.formationDate && (
                                    <div className="text-xs text-slate-500 flex items-center gap-1.5">
                                        <span className="text-slate-400 font-semibold">تشكيل:</span>
                                        <span className="font-bold text-slate-700">{batch.formationDate}</span>
                                    </div>
                                )}
                                {batch.formationDate && batch.dateSent && <div className="w-px h-4 bg-slate-200"></div>}
                                {batch.dateSent && (
                                    <div className="text-xs text-sky-600 flex items-center gap-1.5">
                                        <span className="text-sky-500 font-semibold">ارسال:</span>
                                        <span className="font-bold">{batch.dateSent}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Bottom Row: Production Stats & Delivery */}
                    <div className="grid grid-cols-2 gap-2">
                        {/* Dyehouse Status (Sent/Recv) */}
                        <div className="bg-slate-50/50 p-3 rounded border border-slate-100 flex items-center justify-around text-xs">
                             <div className={`text-center ${sent > 0 ? 'text-sky-700' : 'text-slate-400'}`}>
                                <span className="text-[10px] uppercase text-slate-400 block mb-1">Sent to Dye</span>
                                <span className="font-bold text-base block">{sent > 0 ? sent.toFixed(0) : '0'}</span>
                             </div>
                             <div className="h-8 w-px bg-slate-200"></div>
                             <div className={`text-center ${recv > 0 ? 'text-purple-700' : 'text-slate-400'}`}>
                                <span className="text-[10px] uppercase text-slate-400 block mb-1">Received Back</span>
                                <span className="font-bold text-base block">{recv > 0 ? recv.toFixed(0) : '0'}</span>
                             </div>
                        </div>

                        {/* Delivery Status */}
                        <div className={`p-3 rounded border flex flex-col items-center justify-center ${net > 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                             <div className="flex items-center justify-center gap-2 mb-2">
                                <span className={`text-xs uppercase font-bold ${net > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                                    {net > 0 ? 'Delivered' : 'Not Delivered'}
                                </span>
                                {net > 0 && <CheckCircle2 size={16} className="text-emerald-500" />}
                             </div>
                             <div className="flex items-center justify-center gap-3 text-sm">
                                <div className="text-center">
                                    <span className="text-slate-500 block text-[10px] mb-0.5">Color</span>
                                    <span className="font-bold text-base">{net > 0 ? net.toFixed(0) : '-'}</span>
                                </div>
                                {netAcc > 0 && (
                                    <>
                                        <span className="text-slate-300 text-lg">•</span>
                                        <div className="text-center">
                                            <span className="text-slate-500 block text-[10px] mb-0.5">Acc</span>
                                            <span className="font-bold text-base">{netAcc.toFixed(0)}</span>
                                        </div>
                                    </>
                                )}
                             </div>
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes Section */}
        {order.notes && (
          <div className="bg-amber-50/50 rounded-md p-2 border border-amber-100">
            <div className="text-[10px] font-bold text-amber-700 uppercase mb-1 flex items-center gap-1">
              <FileText size={10} />
              Notes
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{order.notes}</p>
          </div>
        )}

        {/* Dates Footer */}
        {(order.startDate || order.endDate) && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex gap-3 text-xs text-slate-500">
            {order.startDate && (
              <span>
                <span className="font-bold text-slate-400">Start:</span> {order.startDate}
              </span>
            )}
            {order.endDate && (
              <span>
                <span className="font-bold text-slate-400">End:</span> {order.endDate}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
