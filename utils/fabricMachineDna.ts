// Shared fabric<->machine "DNA" grouping logic. Previously duplicated
// byte-for-byte across FabricFormModal.tsx and FabricsPage.tsx (and
// re-implemented with a slightly different shape in MachinesPage.tsx), which
// let the three drift out of sync. This is the single source of truth for:
//   - normalizing a machine's free-text `type` into a coarse category
//   - grouping a fabric's linked machines (workCenters) by type+gauge,
//     naming each group after the brand(s) of machines in it
//   - matching an arbitrary machine against a fabric's linked machines,
//     for "recommend this fabric for this machine" style features
//
// CreatePlanModal.tsx has its own, more elaborate fabric->machine
// recommendation scorer (availability, spec fallback, etc.) that is not a
// duplicate of this — it's left as-is.

export const getMachineCategory = (type: string = ''): 'Single Jersey' | 'Double Jersey' | 'Other' => {
  const t = (type || '').toLowerCase();
  if (t.includes('single') || t.includes('jersey') || t.includes('fleece')) return 'Single Jersey';
  if (t.includes('double') || t.includes('rib') || t.includes('interlock')) return 'Double Jersey';
  return 'Other';
};

export interface FabricDnaGroup {
  id: string; // `${type}-${gauge}`
  type: string;
  gauge: string;
  brands: Set<string>;
  machines: any[];
  name: string; // e.g. "Tien Yang Group" — brand(s) joined + " Group"
  brandList: string[];
}

export interface FabricDnaResult {
  status: 'No Machines' | 'Conflicting Types' | 'Multiple Groups' | 'Tier 1' | 'Tier 2';
  groups: FabricDnaGroup[];
  dna?: { gauge: string; dia: string; needles: number; type: string };
  variants?: number;
}

export const computeFabricDNA = (workCenters: string[] | undefined, machines: any[]): FabricDnaResult => {
  if (!workCenters || workCenters.length === 0) return { status: 'No Machines', groups: [] };

  const linkedMachines = machines.filter(m => workCenters.includes(m.machineName || m.name));
  if (linkedMachines.length === 0) return { status: 'No Machines', groups: [] };

  const groupsMap = new Map<string, {
    id: string;
    type: string;
    gauge: string;
    brands: Set<string>;
    machines: any[];
  }>();

  linkedMachines.forEach(m => {
    const key = `${m.type}-${m.gauge}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { id: key, type: m.type, gauge: m.gauge, brands: new Set(), machines: [] });
    }
    const group = groupsMap.get(key)!;
    group.machines.push(m);
    if (m.brand) group.brands.add(m.brand);
  });

  const groups: FabricDnaGroup[] = Array.from(groupsMap.values()).map(g => {
    const brandList = Array.from(g.brands);
    const brandName = brandList.length > 0 ? brandList.join(' & ') : 'Unknown Brand';
    return { ...g, name: `${brandName} Group`, brandList };
  });

  const categories = new Set(linkedMachines.map(m => getMachineCategory(m.type)));
  if (categories.has('Single Jersey') && categories.has('Double Jersey')) {
    return { status: 'Conflicting Types', groups };
  }

  if (groups.length > 1) {
    return { status: 'Multiple Groups', groups };
  }

  const group = groups[0];
  const subGroups = new Set(group.machines.map(m => `${m.dia}-${m.needles}`));
  const firstM = group.machines[0];
  const dna = { gauge: firstM.gauge, dia: firstM.dia, needles: firstM.needles, type: firstM.type };

  return {
    status: subGroups.size === 1 ? 'Tier 1' : 'Tier 2',
    groups: [group],
    dna,
    variants: subGroups.size,
  };
};

export type MachineMatchLevel = 'exact' | 'group' | 'none';

export interface MachineMatch {
  level: MachineMatchLevel;
  groupName?: string;
}

/**
 * Given a fabric's workCenters and a candidate machine, determine whether
 * that machine has proven history on the fabric ('exact' — the machine's
 * own name is in workCenters), shares a DNA group with a machine that does
 * ('group' — same type+gauge as a proven machine), or has no known
 * relation ('none').
 */
export const matchFabricToMachine = (
  workCenters: string[] | undefined,
  machine: any,
  allMachines: any[]
): MachineMatch => {
  if (!machine) return { level: 'none' };
  const machineName = machine.machineName || machine.name;
  if (workCenters && machineName && workCenters.includes(machineName)) {
    return { level: 'exact' };
  }

  // A group match requires a real type AND a real gauge on both sides —
  // without this, machines with missing/blank gauge data would all
  // collapse into one bogus "TYPE-undefined" bucket and look related to
  // every other ungauged machine of the same type.
  if (!machine.type || !machine.gauge) return { level: 'none' };

  const dna = computeFabricDNA(workCenters, allMachines);
  const machineKey = `${machine.type}-${machine.gauge}`;
  const matchedGroup = dna.groups.find(g => g.id === machineKey && g.type && g.gauge);
  if (matchedGroup) {
    return { level: 'group', groupName: matchedGroup.name };
  }

  return { level: 'none' };
};
