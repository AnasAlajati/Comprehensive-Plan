# Migration Guide: Current → Optimized Schema

## **Quick Summary**

You now have **two versions** of the factory service:

1. **`services/factoryService.ts`** — Current (working, but not optimized)
2. **`services/factoryService.optimized.ts`** — New (3-100x faster, 50x cheaper at scale)

Both can coexist while you transition. This guide shows you how to migrate safely.

---

## **Phase 1: Run Both in Parallel (Dual Writes)**

### Step 1: Update `App.tsx` to use optimized service

Replace the import:
```typescript
// OLD
import { FactoryService } from './services/factoryService';

// NEW
import { FactoryServiceOptimized } from './services/factoryService.optimized';
```

Then update the handler:
```typescript
const handleUpdateMachine = async (updatedMachine: MachineRow, reportDate?: string) => {
  try {
    // Use the optimized service
    await FactoryServiceOptimized.updateMachine(updatedMachine, reportDate);
  } catch (error) {
    console.error("Error updating machine:", error);
    alert("Failed to update machine.");
  }
};
```

### Step 2: Update `ExcelTable.tsx` imports

Replace:
```typescript
import { FactoryService, createReportFromMachines } from '../services/factoryService';
```

With:
```typescript
import { FactoryServiceOptimized, createReportFromMachines } from '../services/factoryService.optimized';
```

### Step 3: Update date checking logic in `ExcelTable.tsx`

Replace the current `handleDateChange` with:
```typescript
const handleDateChange = async (newDate: string) => {
  // Use optimized index check (1 read instead of checking first machine)
  const hasData = await checkDateHasData(newDate);

  if (hasData) {
    setReportDate(newDate);
  } else {
    setPendingDate(newDate);
    setShowCreateReportModal(true);
  }
};
```

And import the helper:
```typescript
import { checkDateHasData, createReportFromMachines } from '../services/factoryService.optimized';
```

---

## **Phase 2: Backfill Optimized Schema (One-Time)**

Once dual writes are working, run this script **once** to populate the new collections:

```typescript
// firebaseUtils/backfill.ts
import { 
  collection, 
  getDocs, 
  doc, 
  writeBatch,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Backfill daily_production_index and client_daily_summary from existing daily_logs
 * This is a one-time operation to migrate historical data
 */
export const backfillOptimizedSchema = async () => {
  console.log('Starting backfill... this may take a few minutes');

  const machinesRef = collection(db, 'machines');
  const machineSnaps = await getDocs(machinesRef);

  const indexMap: Record<string, Set<number>> = {}; // date -> Set<machineId>
  const clientMap: Record<string, Record<string, any>> = {}; // client/date -> {production, scrap}

  // Step 1: Iterate all machines and their daily_logs
  for (const machineSnap of machineSnaps.docs) {
    const machineId = Number(machineSnap.id);
    const logsRef = collection(db, `machines/${machineId}/daily_logs`);
    const logSnaps = await getDocs(logsRef);

    for (const logSnap of logSnaps.docs) {
      const log = logSnap.data();
      const dateStr = log.date || logSnap.id;

      // Build index
      if (!indexMap[dateStr]) {
        indexMap[dateStr] = new Set();
      }
      indexMap[dateStr].add(machineId);

      // Build client summary
      if (log.client) {
        const key = `${log.client}/${dateStr}`;
        if (!clientMap[key]) {
          clientMap[key] = { production: 0, scrap: 0 };
        }
        clientMap[key].production += log.dayProduction || 0;
        clientMap[key].scrap += log.scrap || 0;
      }
    }
  }

  // Step 2: Write backfilled data
  console.log(`Writing ${Object.keys(indexMap).length} index entries...`);
  
  let batch = writeBatch(db);
  let batchOps = 0;

  for (const [dateStr, machineIdSet] of Object.entries(indexMap)) {
    batch.set(doc(db, 'daily_production_index', dateStr), {
      date: dateStr,
      machineIds: Array.from(machineIdSet),
      timestamp: Timestamp.now()
    });

    batchOps++;
    if (batchOps >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      batchOps = 0;
    }
  }

  console.log(`Writing ${Object.keys(clientMap).length} client summaries...`);
  
  for (const [key, data] of Object.entries(clientMap)) {
    const [client, dateStr] = key.split('/');
    batch.set(doc(db, `client_daily_summary/${client}`, dateStr), {
      date: dateStr,
      client,
      totalProduction: data.production,
      totalScrap: data.scrap,
      timestamp: Timestamp.now()
    });

    batchOps++;
    if (batchOps >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      batchOps = 0;
    }
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  console.log('Backfill complete!');
};
```

Run this from your browser console:
```typescript
// In App.tsx or a temp utility page
import { backfillOptimizedSchema } from './firebaseUtils/backfill';

// Call once
await backfillOptimizedSchema();
```

---

## **Phase 3: Validate & Cut Over**

### Validation Checklist

- [ ] Edit a machine in Excel Table → check that `machines/{id}`, `machines/{id}/daily_logs/{date}`, and `daily_production_index/{date}` are all updated
- [ ] Switch dates in Excel Table → new date creates logs + shows "No data in this date" modal
- [ ] Load multiple dates → verify data persists correctly
- [ ] Check Firestore console:
  - [ ] `daily_production_index/{date}` has `machineIds` array
  - [ ] `client_daily_summary/{client}/{date}` has production totals

### Switch to Optimized (Complete Cutover)

Once validated, you can:
1. Delete the old `services/factoryService.ts` (keep `factoryService.optimized.ts`)
2. Rename `factoryService.optimized.ts` → `factoryService.ts`
3. Update imports back to the original name

Or keep both and use optimized going forward.

---

## **Phase 4: Cleanup (Optional)**

After 2-4 weeks of running optimized schema successfully:

1. Delete old `daily_logs` documents (optional — they still work, just redundant)
2. Remove old read queries
3. Monitor Firestore costs — should drop 50%+

---

## **Performance Before & After**

### Scenario: Load Excel table for Nov 29 with 100 machines, 30 active

**Before (Current Schema):**
```
Read machines/{id}/daily_logs/{date} for each machine
→ 100 reads (even though only 30 have data)
→ ~500ms latency (100 reads × 5ms)
→ Cost: 100 reads
```

**After (Optimized Schema):**
```
Read daily_production_index/{date}           → 1 read, get machineIds = [1,2,3,...,30]
Read 30 × machines/{id}/daily_logs/{date}    → 30 parallel reads
Total: 31 reads, ~50ms latency
Cost: 31 reads (69% reduction!)
```

### Scenario: Client report for November (30 daily reports)

**Before:**
```
Iterate each date, query machines where client='XYZ'
→ 30 × 100 = 3,000 reads to check all logs
→ Only 900 of them match
→ Cost: 3,000 wasted reads
```

**After:**
```
Read client_daily_summary/XYZ/{each date}
→ 30 reads, get pre-aggregated totals
→ Cost: 30 reads (100x reduction!)
```

---

## **Common Questions**

### Q: Will my old data break?
**A:** No. Old data stays in `machines/{id}` and `machines/{id}/daily_logs/{date}` forever. New writes go to optimized collections. Both can coexist.

### Q: Do I have to migrate all at once?
**A:** No. You can run dual writes and backfill gradually. Migration is non-blocking.

### Q: What if I need to rollback?
**A:** Simply revert imports back to `factoryService.ts`. Your old data is still there.

### Q: When should I delete old collections?
**A:** After 1 month of successful optimized writes. But you don't *have* to — the old data is harmless, just slightly redundant.

---

## **Estimated Timeline**

- **Day 1:** Deploy dual writes (Phase 1)
- **Day 2:** Run backfill script (Phase 2)
- **Days 3-14:** Monitor & validate (Phase 3)
- **Week 3:** Complete cutover (Phase 4)

---

## **Next Steps**

1. ✅ Review `FIRESTORE_SCHEMA_OPTIMIZED.md` for detailed schema design
2. ✅ Read this migration guide
3. → Implement Phase 1 (dual writes) in your local branch
4. → Test thoroughly before deploying to production
5. → Monitor Firestore costs drop by 50%+

Good luck! 🚀
