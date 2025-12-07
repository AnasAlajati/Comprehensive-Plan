import React, { useState, useEffect, useCallback, memo } from 'react';
import { DataService } from '../services/dataService';
import { 
  Client, 
  Fabric, 
  Order, 
  MachineRow, 
  MachineStatus,
  OrderItem,
  Yarn
} from '../types';
import { Edit, Search, X, Check, Plus, Trash2 } from 'lucide-react';

type AddMode = 'client' | 'fabric' | 'yarn' | 'order' | 'machine';

// Stable, memoized UI primitives
type ModeButtonProps = { active: boolean; onClick: () => void; label: string; icon: string };
const ModeButton = memo(({ active, onClick, label, icon }: ModeButtonProps) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-lg scale-105'
        : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
    }`}
  >
    <span className="text-lg">{icon}</span>
    {label}
  </button>
));

type InputProps = { label: string; value: any; onChange: (v: any) => void; type?: string; placeholder?: string; disabled?: boolean };
const Input = memo(({ label, value, onChange, type = 'text', placeholder = '', disabled = false }: InputProps) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-semibold text-slate-700">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-500"
      autoComplete="off"
    />
  </div>
));

type SelectOption = { value: string; label: string };
type SelectProps = { label: string; value: any; onChange: (v: any) => void; options: SelectOption[]; disabled?: boolean };
const Select = memo(({ label, value, onChange, options, disabled = false }: SelectProps) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-semibold text-slate-700">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-500"
    >
      <option value="">-- Select --</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
));

const AddDataPage: React.FC = () => {
  const [mode, setMode] = useState<AddMode>('order');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Inline Creation Modal States
  const [inlineCreateModal, setInlineCreateModal] = useState<{ type: 'client' | 'fabric' | 'machine' | null; isOpen: boolean }>({ type: null, isOpen: false });
  const [inlineCreateForm, setInlineCreateForm] = useState({ name: '', id: '' });

  // Master Data States
  const [clients, setClients] = useState<Client[]>([]);
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [yarns, setYarns] = useState<Yarn[]>([]);

  // Form States
  const [clientForm, setClientForm] = useState({ clientId: '', name: '' });
  const [yarnForm, setYarnForm] = useState({ name: '' });
  const [fabricForm, setFabricForm] = useState({ fabricId: '', name: '', yarns: [] as { yarnId: string; percentage: number }[] });
  const [yarnComposition, setYarnComposition] = useState({ yarnId: '', percentage: 0 });
  const [orderForm, setOrderForm] = useState({
    orderId: '',
    clientId: '',
    status: 'pending' as Order['status'],
    items: [] as OrderItem[]
  });
  const [orderItem, setOrderItem] = useState({ fabricId: '', quantity: 0 });
  const [machineForm, setMachineForm] = useState({
    id: 0,
    brand: '',
    type: 'SINGLE',
    machineName: '',
    status: MachineStatus.UNDER_OP,
    futurePlans: [],
    dailyLogs: []
  });

  // Load master data on mount
  useEffect(() => {
    loadMasterData();
  }, []);

  // Reset search and edit state when mode changes
  useEffect(() => {
    setEditingId(null);
    setSearchTerm('');
    resetForms();
  }, [mode]);

  const loadMasterData = useCallback(async () => {
    try {
      const [clientsData, fabricsData, ordersData, machinesData, yarnsData] = await Promise.all([
        DataService.getClients(),
        DataService.getFabrics(),
        DataService.getOrders(),
        DataService.getMachinesFromMachineSS(),
        DataService.getYarns()
      ]);
      setClients(clientsData);
      setFabrics(fabricsData);
      setOrders(ordersData);
      setMachines(machinesData);
      setYarns(yarnsData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, []);

  const showMessage = useCallback((msg: string, isError = false) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }, []);

  const resetForms = () => {
    setClientForm({ clientId: '', name: '' });
    setYarnForm({ name: '' });
    setFabricForm({ fabricId: '', name: '', yarns: [] });
    setOrderForm({ orderId: '', clientId: '', status: 'pending', items: [] });
    setMachineForm({ id: 0, brand: '', type: 'SINGLE', machineName: '', status: MachineStatus.UNDER_OP, futurePlans: [], dailyLogs: [] });
    setEditingId(null);
  };

  // ==================== HANDLERS ====================

  const handleSaveClient = async () => {
    setLoading(true);
    try {
      if (editingId) {
        await DataService.updateClient(editingId as string, clientForm);
        showMessage('✅ Client updated successfully!');
        setClients(prev => prev.map(c => c.id === editingId ? { ...c, ...clientForm } : c));
      } else {
        const id = await DataService.addClient(clientForm);
        showMessage('✅ Client added successfully!');
        setClients(prev => [...prev, { ...clientForm, id }]);
      }
      resetForms();
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleSaveYarn = async () => {
    if (!yarnForm.name) {
      showMessage('❌ Please enter yarn name', true);
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await DataService.updateYarn(editingId as string, yarnForm);
        showMessage('✅ Yarn updated successfully!');
        setYarns(prev => prev.map(y => y.id === editingId ? { ...y, ...yarnForm } : y));
      } else {
        const id = await DataService.addYarn(yarnForm);
        showMessage('✅ Yarn added successfully!');
        setYarns(prev => [...prev, { ...yarnForm, id } as Yarn]);
      }
      resetForms();
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleSaveFabric = async () => {
    if (!fabricForm.fabricId || !fabricForm.name || fabricForm.yarns.length === 0) {
      showMessage('❌ Please enter Fabric ID, Name, and add at least one yarn', true);
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await DataService.updateFabric(editingId as string, fabricForm);
        showMessage('✅ Fabric updated successfully!');
        setFabrics(prev => prev.map(f => f.id === editingId ? { ...f, ...fabricForm } : f));
      } else {
        const id = await DataService.addFabric(fabricForm);
        showMessage('✅ Fabric added successfully!');
        setFabrics(prev => [...prev, { ...fabricForm, id }]);
      }
      resetForms();
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleSaveOrder = async () => {
    if (!orderForm.clientId || orderForm.items.length === 0) {
      showMessage('❌ Please select client and add at least one item', true);
      return;
    }
    setLoading(true);
    try {
      const orderId = orderForm.orderId || `ORD-${Date.now()}`;
      const orderData = {
        orderId,
        clientId: orderForm.clientId,
        status: orderForm.status,
        createdDate: new Date().toISOString().split('T')[0],
        items: orderForm.items
      };

      if (editingId) {
        await DataService.updateOrder(editingId as string, orderData);
        showMessage('✅ Order updated successfully!');
        setOrders(prev => prev.map(o => o.id === editingId ? { ...o, ...orderData, id: editingId as string } : o));
      } else {
        const id = await DataService.addOrder(orderData);
        showMessage('✅ Order added successfully!');
        setOrders(prev => [...prev, { ...orderData, id }]);
      }
      resetForms();
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  const handleSaveMachine = async () => {
    if (!machineForm.machineName) {
      showMessage('❌ Please enter machine name', true);
      return;
    }
    setLoading(true);
    try {
      const machineData = {
        id: machineForm.id,
        name: machineForm.machineName,
        brand: machineForm.brand,
        type: machineForm.type,
        dailyLogs: machineForm.dailyLogs,
        futurePlans: machineForm.futurePlans
      };

      if (editingId) {
        // For machines, we use the ID as the doc ID in MachineSS
        await DataService.updateMachineInMachineSS(String(machineForm.id), machineData);
        showMessage('✅ Machine updated successfully!');
        setMachines(prev => prev.map(m => m.id === machineForm.id ? { ...m, ...machineData } : m));
      } else {
        await DataService.addMachineToMachineSS(machineData);
        showMessage('✅ Machine added successfully!');
        setMachines(prev => [...prev, machineData]);
      }
      resetForms();
    } catch (error: any) {
      showMessage('❌ Error: ' + error.message, true);
    }
    setLoading(false);
  };

  // ==================== EDIT HANDLERS ====================

  const startEditClient = (client: Client) => {
    setClientForm({ clientId: client.clientId, name: client.name });
    setEditingId(client.id || null);
  };

  const startEditYarn = (yarn: Yarn) => {
    setYarnForm({ name: yarn.name });
    setEditingId(yarn.id || null);
  };

  const startEditFabric = (fabric: Fabric) => {
    setFabricForm({ 
      fabricId: fabric.fabricId, 
      name: fabric.name, 
      yarns: fabric.yarns || [] 
    });
    setEditingId(fabric.id || null);
  };

  const startEditOrder = (order: Order) => {
    setOrderForm({
      orderId: order.orderId,
      clientId: order.clientId,
      status: order.status,
      items: order.items || []
    });
    setEditingId(order.id || null);
  };

  const startEditMachine = (machine: MachineRow) => {
    setMachineForm({
      id: machine.id,
      brand: machine.brand || '',
      type: machine.type || 'SINGLE',
      machineName: machine.name || machine.machineName || '',
      status: machine.status || MachineStatus.UNDER_OP,
      futurePlans: machine.futurePlans || [],
      dailyLogs: machine.dailyLogs || []
    });
    setEditingId(machine.id); // Machine ID is number
  };

  // ==================== SUB-HANDLERS ====================

  const handleAddYarnToFabric = () => {
    if (!yarnComposition.yarnId || yarnComposition.percentage <= 0 || yarnComposition.percentage > 100) {
      showMessage('❌ Please select yarn and enter percentage (0-100)', true);
      return;
    }
    const totalPercentage = fabricForm.yarns.reduce((sum, y) => sum + y.percentage, 0) + yarnComposition.percentage;
    if (totalPercentage > 100) {
      showMessage('❌ Total yarn percentage cannot exceed 100%', true);
      return;
    }
    setFabricForm({
      ...fabricForm,
      yarns: [...fabricForm.yarns, { ...yarnComposition }]
    });
    setYarnComposition({ yarnId: '', percentage: 0 });
  };

  const handleRemoveYarnFromFabric = (index: number) => {
    setFabricForm({
      ...fabricForm,
      yarns: fabricForm.yarns.filter((_, i) => i !== index)
    });
  };

  const handleAddOrderItem = () => {
    if (!orderItem.fabricId || orderItem.quantity <= 0) {
      showMessage('❌ Please select fabric and enter quantity', true);
      return;
    }
    setOrderForm({
      ...orderForm,
      items: [...orderForm.items, { ...orderItem }]
    });
    setOrderItem({ fabricId: '', quantity: 0 });
  };

  const handleRemoveOrderItem = (index: number) => {
    setOrderForm({
      ...orderForm,
      items: orderForm.items.filter((_, i) => i !== index)
    });
  };

  // ==================== RENDER LISTS ====================

  const renderList = () => {
    const filtered = (list: any[], keys: string[]) => {
      if (!searchTerm) return list;
      return list.filter(item => 
        keys.some(key => String(item[key] || '').toLowerCase().includes(searchTerm.toLowerCase()))
      );
    };

    if (mode === 'client') {
      const list = filtered(clients, ['name', 'clientId']);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Client ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((client) => (
                <tr key={client.id} className="bg-white border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{client.clientId}</td>
                  <td className="px-4 py-3">{client.name}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEditClient(client)} className="text-blue-600 hover:text-blue-800">
                      <Edit size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (mode === 'yarn') {
      const list = filtered(yarns, ['name']);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((yarn) => (
                <tr key={yarn.id} className="bg-white border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{yarn.name}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEditYarn(yarn)} className="text-blue-600 hover:text-blue-800">
                      <Edit size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (mode === 'fabric') {
      const list = filtered(fabrics, ['name', 'fabricId']);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Fabric ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Composition</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((fabric) => (
                <tr key={fabric.id} className="bg-white border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{fabric.fabricId}</td>
                  <td className="px-4 py-3">{fabric.name}</td>
                  <td className="px-4 py-3">
                    {fabric.yarns?.map(y => {
                      const yarnName = yarns.find(yn => yn.id === y.yarnId)?.name || y.yarnId;
                      return `${yarnName} (${y.percentage}%)`;
                    }).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEditFabric(fabric)} className="text-blue-600 hover:text-blue-800">
                      <Edit size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (mode === 'order') {
      const list = filtered(orders, ['orderId', 'clientId']);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fabrics (Linked)</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((order) => {
                const clientName = clients.find(c => c.clientId === order.clientId)?.name || order.clientId;
                return (
                  <tr key={order.id} className="bg-white border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{order.orderId}</td>
                    <td className="px-4 py-3">{clientName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        order.status === 'completed' ? 'bg-green-100 text-green-800' :
                        order.status === 'in-production' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {order.items?.map(item => {
                        const fabricName = fabrics.find(f => f.fabricId === item.fabricId)?.name || item.fabricId;
                        return `${fabricName} (${item.quantity}kg)`;
                      }).join(', ')}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => startEditOrder(order)} className="text-blue-600 hover:text-blue-800">
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    if (mode === 'machine') {
      const list = filtered(machines, ['name', 'brand', 'type']);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((machine) => (
                <tr key={machine.id} className="bg-white border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{machine.id}</td>
                  <td className="px-4 py-3">{machine.name || machine.machineName}</td>
                  <td className="px-4 py-3">{machine.brand}</td>
                  <td className="px-4 py-3">{machine.type}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEditMachine(machine)} className="text-blue-600 hover:text-blue-800">
                      <Edit size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  };

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">🏗️ Manage Factory Data</h1>
          <p className="text-slate-500">View, Edit, and Add master data</p>
        </div>

        {/* Mode Selector */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <ModeButton active={mode === 'client'} onClick={() => setMode('client')} label="Clients" icon="👤" />
            <ModeButton active={mode === 'yarn'} onClick={() => setMode('yarn')} label="Yarns" icon="🧵" />
            <ModeButton active={mode === 'fabric'} onClick={() => setMode('fabric')} label="Fabrics" icon="🧶" />
            <ModeButton active={mode === 'order'} onClick={() => setMode('order')} label="Orders (Customer Links)" icon="📦" />
            <ModeButton active={mode === 'machine'} onClick={() => setMode('machine')} label="Machines" icon="🤖" />
          </div>
        </div>

        {/* Message Display */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.startsWith('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: List View */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-md p-6 h-[800px] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800 capitalize">{mode} List</h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto border rounded-lg">
              {renderList()}
            </div>
          </div>

          {/* Right Column: Form */}
          <div className="bg-white rounded-xl shadow-md p-6 h-fit">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">
                {editingId ? `✏️ Edit ${mode}` : `➕ Add New ${mode}`}
              </h2>
              {editingId && (
                <button onClick={resetForms} className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1">
                  <X size={16} /> Cancel
                </button>
              )}
            </div>

            {mode === 'client' && (
              <div className="space-y-4">
                <Input label="Client ID" value={clientForm.clientId} onChange={(v: string) => setClientForm({...clientForm, clientId: v})} placeholder="e.g., CLIENT001" disabled={!!editingId} />
                <Input label="Name" value={clientForm.name} onChange={(v: string) => setClientForm({...clientForm, name: v})} placeholder="e.g., Zara Egypt" />
                <button onClick={handleSaveClient} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50">
                  {loading ? 'Saving...' : (editingId ? 'Update Client' : '+ Add Client')}
                </button>
              </div>
            )}

            {mode === 'yarn' && (
              <div className="space-y-4">
                <Input label="Yarn Name" value={yarnForm.name} onChange={(v: string) => setYarnForm({...yarnForm, name: v})} placeholder="e.g., Cotton, Polyester" />
                <button onClick={handleSaveYarn} disabled={loading} className="w-full bg-pink-600 hover:bg-pink-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50">
                  {loading ? 'Saving...' : (editingId ? 'Update Yarn' : '+ Add Yarn')}
                </button>
              </div>
            )}

            {mode === 'fabric' && (
              <div className="space-y-4">
                <Input label="Fabric ID" value={fabricForm.fabricId} onChange={(v: string) => setFabricForm({...fabricForm, fabricId: v})} placeholder="e.g., FAB001" disabled={!!editingId} />
                <Input label="Name" value={fabricForm.name} onChange={(v: string) => setFabricForm({...fabricForm, name: v})} placeholder="e.g., Cotton Jersey" />
                
                <div className="border-t pt-4">
                  <h3 className="font-bold text-slate-700 mb-3">Yarn Composition</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <Select 
                      label="Yarn" 
                      value={yarnComposition.yarnId} 
                      onChange={(v: string) => setYarnComposition({...yarnComposition, yarnId: v})}
                      options={yarns.map(y => ({ value: y.id || '', label: y.name }))}
                    />
                    <Input label="%" type="number" value={yarnComposition.percentage} onChange={(v: number) => setYarnComposition({...yarnComposition, percentage: v})} />
                  </div>
                  <button onClick={handleAddYarnToFabric} className="w-full bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium text-sm mb-4">
                    + Add Yarn
                  </button>

                  {fabricForm.yarns.length > 0 && (
                    <div className="space-y-2">
                      {fabricForm.yarns.map((yarn, idx) => {
                        const yarnData = yarns.find(y => y.id === yarn.yarnId);
                        return (
                          <div key={idx} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg">
                            <span className="text-sm font-medium">{yarnData?.name || yarn.yarnId} - {yarn.percentage}%</span>
                            <button onClick={() => handleRemoveYarnFromFabric(idx)} className="text-red-600 hover:text-red-800 font-bold">✕</button>
                          </div>
                        );
                      })}
                      <div className="text-xs text-slate-500 mt-2">Total: {fabricForm.yarns.reduce((sum, y) => sum + y.percentage, 0)}%</div>
                    </div>
                  )}
                </div>
                
                <button onClick={handleSaveFabric} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50">
                  {loading ? 'Saving...' : (editingId ? 'Update Fabric' : '+ Add Fabric')}
                </button>
              </div>
            )}

            {mode === 'order' && (
              <div className="space-y-4">
                <Input label="Order ID" value={orderForm.orderId} onChange={(v: string) => setOrderForm({...orderForm, orderId: v})} placeholder="Auto-generated if empty" disabled={!!editingId} />
                <Select 
                  label="Client" 
                  value={orderForm.clientId} 
                  onChange={(v: string) => setOrderForm({...orderForm, clientId: v})}
                  options={clients.map(c => ({ value: c.clientId, label: `${c.name} (${c.clientId})` }))}
                />
                <Select 
                  label="Status" 
                  value={orderForm.status} 
                  onChange={(v: string) => setOrderForm({...orderForm, status: v as Order['status']})}
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'in-production', label: 'In Production' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'cancelled', label: 'Cancelled' }
                  ]}
                />
                
                <div className="border-t pt-4">
                  <h3 className="font-bold text-slate-700 mb-3">Linked Fabrics</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <Select 
                      label="Fabric" 
                      value={orderItem.fabricId} 
                      onChange={(v: string) => setOrderItem({...orderItem, fabricId: v})}
                      options={fabrics.map(f => ({ value: f.fabricId, label: `${f.name} (${f.fabricId})` }))}
                    />
                    <Input label="Qty (kg)" type="number" value={orderItem.quantity} onChange={(v: number) => setOrderItem({...orderItem, quantity: v})} />
                  </div>
                  <button onClick={handleAddOrderItem} className="w-full bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium text-sm mb-4">
                    + Add Fabric to Order
                  </button>

                  {orderForm.items.length > 0 && (
                    <div className="space-y-2">
                      {orderForm.items.map((item, idx) => {
                        const fabric = fabrics.find(f => f.fabricId === item.fabricId);
                        return (
                          <div key={idx} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg">
                            <span className="text-sm font-medium">{fabric?.name || item.fabricId} - {item.quantity}kg</span>
                            <button onClick={() => handleRemoveOrderItem(idx)} className="text-red-600 hover:text-red-800 font-bold">✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button onClick={handleSaveOrder} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50">
                  {loading ? 'Saving...' : (editingId ? 'Update Order' : '+ Add Order')}
                </button>
              </div>
            )}

            {mode === 'machine' && (
              <div className="space-y-4">
                <Input label="Machine ID" type="number" value={machineForm.id} onChange={(v: number) => setMachineForm({...machineForm, id: v})} disabled={!!editingId} />
                <Input label="Name" value={machineForm.machineName} onChange={(v: string) => setMachineForm({...machineForm, machineName: v})} placeholder="e.g., M-101" />
                <Input label="Brand" value={machineForm.brand} onChange={(v: string) => setMachineForm({...machineForm, brand: v})} placeholder="e.g., Mayer" />
                <Input label="Type" value={machineForm.type} onChange={(v: string) => setMachineForm({...machineForm, type: v})} placeholder="e.g., SINGLE, DOUBLE" />
                <button onClick={handleSaveMachine} disabled={loading} className="w-full bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50">
                  {loading ? 'Saving...' : (editingId ? 'Update Machine' : '+ Add Machine')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddDataPage;
