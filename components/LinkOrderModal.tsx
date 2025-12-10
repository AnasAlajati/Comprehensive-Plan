import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Link as LinkIcon, AlertCircle, Loader2, Check } from 'lucide-react';
import { CustomerOrder, MachineRow, OrderFabric } from '../types';

interface LinkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  machine: MachineRow | null;
  orders: CustomerOrder[];
  onLink: (orderReference: string, orderId: string) => Promise<void>;
}

export const LinkOrderModal: React.FC<LinkOrderModalProps> = ({
  isOpen,
  onClose,
  machine,
  orders,
  onLink,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // Reset search term when modal opens or machine changes
  useEffect(() => {
    if (isOpen && machine) {
      // Pre-fill search with client or fabric to help the user
      setSearchTerm(machine.client || machine.material || '');
      setLinkingId(null);
    }
  }, [isOpen, machine]);

  const handleLinkClick = async (ref: string, orderId: string) => {
    setLinkingId(ref);
    try {
      await onLink(ref, orderId);
    } catch (error) {
      console.error("Linking failed", error);
      setLinkingId(null);
    }
  };

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return [];

    const term = searchTerm.toLowerCase();
    const options: { order: CustomerOrder; fabric: OrderFabric; fabricIndex: number }[] = [];

    orders.forEach((order) => {
      order.fabrics.forEach((fabric, index) => {
        const clientMatch = order.customerName.toLowerCase().includes(term);
        const fabricMatch = fabric.fabricName.toLowerCase().includes(term);
        const refMatch = fabric.orderReference?.toLowerCase().includes(term);

        if (clientMatch || fabricMatch || refMatch) {
          options.push({ order, fabric, fabricIndex: index });
        }
      });
    });

    return options;
  }, [orders, searchTerm]);

  // Smart suggestions based on exact machine matches (ignoring search term initially if needed, but here we just use search)
  // Actually, let's have a separate "Suggested" section if the search term matches the machine's current data.
  
  const suggestions = useMemo(() => {
    if (!machine) return [];
    const options: { order: CustomerOrder; fabric: OrderFabric; fabricIndex: number }[] = [];
    
    orders.forEach((order) => {
      order.fabrics.forEach((fabric, index) => {
        // Strict matching for suggestions
        const clientMatch = machine.client && order.customerName.toLowerCase() === machine.client.toLowerCase();
        const fabricMatch = machine.material && fabric.fabricName.toLowerCase() === machine.material.toLowerCase();
        
        if (clientMatch && fabricMatch) {
           options.push({ order, fabric, fabricIndex: index });
        }
      });
    });
    return options;
  }, [orders, machine]);


  if (!isOpen || !machine) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 transition-all duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col transform transition-all scale-100 border border-slate-100">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                <LinkIcon className="w-5 h-5" />
              </div>
              Link Order
            </h2>
            <p className="text-xs text-slate-500 mt-1 ml-1">
              Machine: <span className="font-medium text-slate-700">{machine.machineName}</span> • {machine.client} / {machine.material}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search by Client, Fabric, or Order Ref..."
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-sm font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/30">
          
          {/* Suggestions Section */}
          {suggestions.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3 px-1 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                Recommended Matches
              </h3>
              <div className="space-y-2">
                {suggestions.map((item, idx) => {
                  const ref = item.fabric.orderReference || `ORD-${Date.now()}`;
                  const isLinking = linkingId === ref;
                  
                  return (
                    <div
                      key={`suggest-${idx}`}
                      onClick={() => !linkingId && handleLinkClick(ref, item.order.id || '')}
                      className={`relative flex items-center justify-between p-4 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-300 cursor-pointer transition-all group ${isLinking ? 'bg-emerald-50' : ''}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm">
                          {item.order.customerName.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
                            {item.order.customerName}
                          </div>
                          <div className="text-sm text-slate-600">
                            {item.fabric.fabricName}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1 bg-slate-100 px-1.5 py-0.5 rounded w-fit">
                            {ref}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        {isLinking ? (
                          <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                        ) : (
                          <>
                            <div className="text-sm font-bold text-slate-700">
                              {item.fabric.remainingQuantity.toLocaleString()} <span className="text-xs font-normal text-slate-500">kg</span>
                            </div>
                            <div className="text-[10px] text-emerald-600 font-medium mt-1">Select Match</div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search Results */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">
              All Results
            </h3>
            
            {filteredOptions.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-200">
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Search className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-500 font-medium text-sm">No orders found matching "{searchTerm}"</p>
                <p className="text-xs text-slate-400 mt-1">Try searching for a different client or fabric</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredOptions.map((item, idx) => {
                  const ref = item.fabric.orderReference || `ORD-${Date.now()}`;
                  const isLinking = linkingId === ref;

                  return (
                    <div
                      key={`opt-${idx}`}
                      onClick={() => !linkingId && handleLinkClick(ref, item.order.id || '')}
                      className={`flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 hover:shadow-sm cursor-pointer transition-all group ${isLinking ? 'bg-blue-50 border-blue-200' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                          {item.order.customerName.substring(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-sm">
                            {item.order.customerName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {item.fabric.fabricName}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <div className="text-xs font-medium text-slate-700">
                            {item.fabric.remainingQuantity.toLocaleString()} kg
                          </div>
                          <div className="text-[10px] text-slate-400">Ref: {ref}</div>
                        </div>
                        
                        {isLinking ? (
                          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                        ) : (
                          <div className="w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center group-hover:border-blue-500 group-hover:bg-blue-50 transition-all">
                            <Check className="w-3 h-3 text-transparent group-hover:text-blue-600" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 bg-slate-50 rounded-b-xl text-[10px] text-slate-400 text-center flex items-center justify-center gap-2">
          <AlertCircle className="w-3 h-3" />
          Linking an order enables precise tracking across production stages.
        </div>
      </div>
    </div>
  );
};
