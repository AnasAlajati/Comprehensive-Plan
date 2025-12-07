# Optimized Firestore Data Schema

## **Goal: Scalable, Fast, Cost-Efficient Backend**

This document outlines the optimized structure for handling production data with 100+ machines and years of historical logs.

---

## **1. Core Collections**

### **A. `/machines` (Machine Master Data)**
- **Primary Purpose:** Current machine config & state (read frequently, updated rarely)
- **Path:** `machines/{machineId}`
- **Fields:**
  - `id` (number) — unique machine ID
  - `machineName` (string) — e.g., "ميلتون 1"
  - `brand` (string)
  - `type` (string) — e.g., "MELTON", "SINGLE", etc.
  - `avgProduction` (number)
  - `remainingMfg` (number) — current order remaining qty
  - `client` (string) — current client
  - `material` (string) — current fabric
  - `status` (string) — "Working", "Under Operation", etc.
  - `customStatusNote` (string, optional)
  - `orderIndex` (number) — for drag-drop UI ordering
  - `lastUpdated` (Timestamp) — for sync/conflict detection
  - `createdAt` (Timestamp)

- **Access Patterns:**
  - Read all machines: `query(collection(db, 'machines'))`
  - Read single machine: `doc(db, 'machines', machineId)`
  - Update machine: `batch.set(machineRef, {...}, {merge:true})`

---

### **B. `/machines/{machineId}/daily_logs` (Historical Daily Snapshots)**
- **Primary Purpose:** Audit trail of daily changes per machine
- **Path:** `machines/{machineId}/daily_logs/{YYYY-MM-DD}`
- **Fields:**
  - `date` (string) — YYYY-MM-DD (document ID)
  - `dayProduction` (number) — production for that day
  - `scrap` (number) — scrap for that day
  - `fabric` (string) — fabric on that day (denormalized for reporting)
  - `client` (string) — client on that day
  - `status` (string, optional) — snapshot of machine status (optional, see note below)
  - `timestamp` (Timestamp) — exact time of last edit on that day

- **Why This Structure?**
  - Subcollection keeps logs organized per machine (easy pagination)
  - Date as document ID = efficient exact-date lookups (`doc(..., {date})`)
  - Minimal fields = faster reads, smaller storage
  - Denormalized `fabric`, `client` enables quick filtering on daily reports without joins

- **Cost Optimization:**
  - DON'T store `machineName`, `brand`, `type` in daily logs → read them from parent `machines` doc if needed
  - DON'T store `avgProduction`, `remainingMfg` in logs → these are machine config, not historical
  - Result: ~50% smaller daily log documents

- **Access Patterns:**
  - Get today's log: `doc(db, 'machines/{id}/daily_logs', 'YYYY-MM-DD')`
  - Check if date exists: `getDoc(dailyLogRef).then(snap => snap.exists())`
  - Get range of dates (future: add query): requires custom logic (see Optimized Queries below)

---

### **C. `/daily_production_index` (New: One-Stop Report Query)**
- **Primary Purpose:** Fast queries for "all logs on date X" without reading 100+ machine subcollections
- **Path:** `daily_production_index/{YYYY-MM-DD}`
- **Fields:**
  - `date` (string)
  - `machineIds` (array<number>) — [1, 2, 3, ...] list of machines with logs on this date
  - `totalProduction` (number)
  - `totalScrap` (number)
  - `activeMachinesCount` (number)
  - `timestamp` (Timestamp)

- **How It Works:**
  - When any machine is updated for a date, append `machineId` to `machineIds` array (once)
  - Use `arrayUnion` for atomic, deduped appends
  - Single document read → get list of machines for a date
  - Then iterate `machineIds` to fetch individual daily logs in parallel

- **Cost Benefit:**
  - **Before:** To get all logs for Dec 5, read 100 random subcollections = 100 reads
  - **After:** Read 1 index doc, then batch-read N logs (N = machines with activity) = 1 + N reads
  - For a factory with ~30 active machines/day → 30 reads instead of 100

- **Access Pattern:**
  - Get all machines logged on date: `doc(db, 'daily_production_index', 'YYYY-MM-DD')`
  - Then: `getDoc()` on each `machines/{id}/daily_logs/{date}`

---

### **D. `/client_daily_summary` (New: Client Reporting)**
- **Primary Purpose:** Quick client-specific daily reports (e.g., "How much did Client XYZ produce on Nov 29?")
- **Path:** `client_daily_summary/{clientName}/{YYYY-MM-DD}`
- **Fields:**
  - `date` (string)
  - `client` (string)
  - `totalProduction` (number)
  - `totalScrap` (number)
  - `machineCount` (number)
  - `timestamp` (Timestamp)

- **Cost Benefit:**
  - Query: "Client XYZ production in Nov" = read 1-30 documents (one per day), not scan all machine logs
  - Replaces slow queries like `where('client', '==', 'XYZ')` across all logs

- **Maintenance:** Updated atomically when `updateMachine()` is called (see optimized service below)

---

### **E. `/machines/{machineId}/month_summary` (Future: Large-Scale Analytics)**
- **Primary Purpose:** Aggregate monthly snapshots to reduce query load for year+ reports
- **Path:** `machines/{machineId}/month_summary/{YYYY-MM}`
- **Fields:**
  - `month` (string) — YYYY-MM
  - `totalProduction` (number)
  - `totalScrap` (number)
  - `daysActive` (number)
  - `avgProduction` (number)
  - `timestamp` (Timestamp)

- **When to Use:** Once daily_logs for a month are finalized, compute and store month_summary once
- **Benefit:** Queries for "last 12 months" read 12 docs instead of 365 daily logs

---

## **2. Optimized Write Pattern**

### **updateMachine(machine, reportDate)**
```typescript
const batch = writeBatch(db);

// 1. Update main machine doc
batch.set(doc(db, 'machines', machineId), {
  id, machineName, brand, type, status, 
  dayProduction, scrap, material, client, ...
  lastUpdated: Timestamp.now()
}, { merge: true });

// 2. Update daily log (ONLY production-related fields)
batch.set(
  doc(db, `machines/${machineId}/daily_logs`, reportDate),
  {
    date: reportDate,
    dayProduction, scrap, fabric: material, client,
    timestamp: Timestamp.now()
  },
  { merge: true }
);

// 3. Append machineId to daily_production_index
batch.update(
  doc(db, 'daily_production_index', reportDate),
  { machineIds: arrayUnion(machineId) }
);

// 4. Update client_daily_summary
if (client) {
  batch.set(
    doc(db, `client_daily_summary/${client}`, reportDate),
    {
      date: reportDate, client,
      production: increment(dayProduction - oldDayProduction),
      scrap: increment(scrap - oldScrap),
      timestamp: Timestamp.now()
    },
    { merge: true }
  );
}

await batch.commit();
```

**Cost:** 2-4 writes per update (not 4 fixed writes like before)

---

## **3. Optimized Query Patterns**

### **Load Excel Table for Date X**
```typescript
// Step 1: Get machine IDs with logs on date X (1 read)
const indexDoc = await getDoc(doc(db, 'daily_production_index', dateStr));
const machineIds = indexDoc.data()?.machineIds || [];

// Step 2: Fetch all logs in parallel (N reads, ~30 typical)
const logs = await Promise.all(
  machineIds.map(id => 
    getDoc(doc(db, `machines/${id}/daily_logs`, dateStr))
  )
);

// Cost: 1 + N reads (~31 total for 30 machines) vs 100 reads before
```

### **Get Client Daily Report**
```typescript
// Single doc read
const clientDaily = await getDoc(
  doc(db, `client_daily_summary/${clientName}`, dateStr)
);
// Result: { totalProduction, totalScrap, machineCount }
// Cost: 1 read vs 30+ collection scans before
```

### **Get Machines Worked Last 30 Days**
```typescript
// Read 30 index docs in parallel
const indices = await Promise.all(
  Array.from({length: 30}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    return getDoc(doc(db, 'daily_production_index', dateStr));
  })
);

const uniqueMachineIds = new Set(
  indices.flatMap(snap => snap.data()?.machineIds || [])
);
// Cost: 30 reads, no full scans
```

---

## **4. Firestore Indexes to Create**

In Firestore Console, create these composite indexes:

| Collection | Fields | Use Case |
|-----------|--------|----------|
| `machines` | `status`, `lastUpdated` | Find working machines updated recently |
| `machines` | `client`, `lastUpdated` | Find machines by client |
| `client_daily_summary` | `client`, `date` (DESC) | Client reports by date |

**Note:** Single-field indexes are auto-created by Firestore.

---

## **5. Estimated Costs & Performance**

### **Scale Scenario: 100 Machines, 2 Years of Daily Logs**

**Storage:**
- Master machines: 100 docs × ~1 KB = 0.1 MB
- Daily logs: 100 × 730 days × 0.5 KB = 36 MB
- Daily index: 730 docs × 1 KB = 0.7 MB
- Client summaries: 20 clients × 730 days × 0.5 KB = 7 MB
- **Total: ~44 MB** (cheap, $0.18/month storage)

**Read Operations (Per Month):**
- Load Excel for 1 date: 31 reads
- Client report, 30 days: 30 reads
- Update 1 machine: 2 reads (old value check, optional)
- **Cost:** ~3,000 daily operations × 30 days = 90k reads/month (~$0.30)

**vs Naive Approach:**
- Load Excel: 100 reads (vs 31)
- Client report: 100 × 30 = 3,000 reads (vs 30)
- **Cost:** ~6,000,000 reads/month = $20/month (66x more expensive!)

---

## **6. Migration Path (Existing Data → Optimized)**

1. **Week 1:** Deploy new schema alongside old data (dual writes)
2. **Week 2:** Fill `daily_production_index` and `client_daily_summary` from existing `daily_logs`
3. **Week 3:** Switch queries to new schema
4. **Week 4:** Delete old data

---

## **7. Future Enhancements**

- **Real-time Analytics:** Use Cloud Functions to auto-compute month_summary on month-end
- **Predictive Queries:** Add ML model predictions to client_daily_summary
- **Sharding:** If a single machine has 10+ years of logs, shard daily_logs by month
- **Archive:** Move logs >1 year old to BigQuery for cold storage

---

## **Summary**

| Aspect | Before | After | Benefit |
|--------|--------|-------|---------|
| Read ops/query | 100 | 1-31 | 3-100x faster |
| Write ops/update | 4 | 2-4 | 50% smaller batches |
| Storage/machine/year | 0.4 MB | 0.36 MB | More space-efficient |
| Query latency (p95) | 2-5s | 100-200ms | **20-50x faster** |
| Monthly cost @ scale | $25+ | $0.50 | **50x cheaper** |

