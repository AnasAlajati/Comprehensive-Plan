# 📋 FuturePlanEntry Fields - Complete Reference

**Date:** November 29, 2025  
**Status:** ✅ Updated  

---

## 🎯 FuturePlanEntry Interface

The `FuturePlanEntry` interface now contains all fields for production and settings plans:

```typescript
export interface FuturePlanEntry {
  type: string;                    // 'PRODUCTION' or 'SETTINGS'
  days: number;                    // Number of days for this plan
  endDate: string;                 // End date (YYYY-MM-DD format)
  fabric: string;                  // Material/fabric type
  notes: string;                   // Notes or comments
  orderName: string;               // Order name/reference
  originalSampleMachine: string;   // Original sample machine reference
  productionPerDay: number;        // Production per day (kg/units)
  quantity: number;                // Total quantity
  remaining: number;               // Remaining quantity
  startDate: string;               // Start date (YYYY-MM-DD format)
}
```

---

## 📊 Field Breakdown

### **Type & Timing**

| Field | Type | Example | Purpose |
|-------|------|---------|---------|
| `type` | string | "PRODUCTION" | Plan type (PRODUCTION or SETTINGS) |
| `startDate` | string | "2025-11-29" | When plan starts (YYYY-MM-DD) |
| `endDate` | string | "2025-11-29" | When plan ends (YYYY-MM-DD) |
| `days` | number | 10 | Duration in days |

### **Production Details**

| Field | Type | Example | Purpose |
|-------|------|---------|---------|
| `fabric` | string | "Cotton" | Material/fabric type |
| `productionPerDay` | number | 100 | Production rate per day |
| `quantity` | number | 5000 | Total quantity to produce |
| `remaining` | number | 4000 | Quantity still remaining |

### **Order & Reference**

| Field | Type | Example | Purpose |
|-------|------|---------|---------|
| `orderName` | string | "Order-2025-001" | Order name/reference |
| `originalSampleMachine` | string | "Machine-5" | Original sample machine |
| `notes` | string | "Rush order" | Additional notes/comments |

---

## 💾 Firestore Document Example

```json
{
  "type": "PRODUCTION",
  "days": 10,
  "endDate": "2025-12-09",
  "fabric": "Cotton",
  "notes": "Rush delivery needed",
  "orderName": "ORDER-2025-001",
  "originalSampleMachine": "Machine-5",
  "productionPerDay": 100,
  "quantity": 5000,
  "remaining": 3500,
  "startDate": "2025-11-29"
}
```

---

## 🔄 Full MachineSS Structure (Updated)

```typescript
interface MachineSS {
  name: string;                      // Machine name (static)
  brand: string;                     // Machine brand (static)
  machineid: number;                 // Machine ID (static)
  
  dailyLogs: [
    {
      date: string;                  // YYYY-MM-DD
      dayProduction: number;         // Production for the day
      scrap: number;                 // Scrap amount
      fabric: string;                // Current fabric
      client: string;                // Current client
      status: string;                // Machine status
    }
  ];
  
  futurePlans: [
    {
      type: string;                  // 'PRODUCTION' or 'SETTINGS'
      days: number;                  // Duration
      endDate: string;               // YYYY-MM-DD
      fabric: string;                // Material
      notes: string;                 // Comments
      orderName: string;             // Order reference
      originalSampleMachine: string; // Sample machine
      productionPerDay: number;      // Daily rate
      quantity: number;              // Total qty
      remaining: number;             // Remaining qty
      startDate: string;             // YYYY-MM-DD
    }
  ];
}
```

---

## 📝 Data Entry Guidelines

### **When Creating a FuturePlanEntry**

```typescript
const newPlan: FuturePlanEntry = {
  type: "PRODUCTION",              // Must be "PRODUCTION" or "SETTINGS"
  startDate: "2025-11-29",         // Today's date or planned start
  endDate: "2025-12-09",           // 10 days later
  days: 10,                        // Should match date range
  
  fabric: "Silk",                  // Material to be processed
  productionPerDay: 100,           // Expected daily output
  quantity: 5000,                  // Total order quantity
  remaining: 5000,                 // Initially equals quantity
  
  orderName: "ORDER-2025-001",     // Customer order reference
  notes: "Rush delivery",          // Any special instructions
  originalSampleMachine: "M-5",    // Where sample was made
};

// Add to MachineSS/{machineId}.futurePlans array
batch.update(
  doc(db, 'MachineSS', machineId),
  {
    futurePlans: arrayUnion(newPlan)
  }
);
```

---

## 🔍 Field Details & Validation

### **type** (string)
- **Values:** "PRODUCTION" or "SETTINGS"
- **Required:** Yes
- **Default:** "PRODUCTION"
- **Notes:** Determines if plan is for production or maintenance/settings

### **startDate** (string - YYYY-MM-DD)
- **Format:** "2025-11-29"
- **Required:** Yes
- **Notes:** When the plan starts/starts
- **Example:** "2025-11-29"

### **endDate** (string - YYYY-MM-DD)
- **Format:** "2025-12-09"
- **Required:** Yes
- **Notes:** When the plan ends
- **Example:** "2025-12-09"
- **Validation:** Must be >= startDate

### **days** (number)
- **Range:** 0 to 365
- **Required:** Yes
- **Notes:** Duration in days (calculated from start/end)
- **Example:** 10

### **fabric** (string)
- **Max Length:** 100 characters
- **Required:** Yes
- **Default:** "Not Specified"
- **Examples:** "Cotton", "Silk", "Polyester", "Linen"

### **productionPerDay** (number)
- **Range:** 0 to 999,999
- **Unit:** kg, units, or meters (context-dependent)
- **Required:** Yes
- **Default:** 0
- **Example:** 100

### **quantity** (number)
- **Range:** 0 to 999,999
- **Unit:** Same as productionPerDay
- **Required:** Yes
- **Default:** 0
- **Example:** 5000
- **Validation:** quantity >= remaining

### **remaining** (number)
- **Range:** 0 to quantity
- **Unit:** Same as quantity
- **Required:** Yes
- **Default:** 0
- **Example:** 3500
- **Notes:** Decreases as production progresses
- **Validation:** remaining <= quantity

### **orderName** (string)
- **Max Length:** 100 characters
- **Required:** Yes
- **Default:** "-"
- **Examples:** "ORD-2025-001", "ABC-Corp-001", "Sample-Order"
- **Notes:** Customer or internal order reference

### **originalSampleMachine** (string)
- **Max Length:** 50 characters
- **Required:** No (can be empty "")
- **Default:** ""
- **Examples:** "Machine-5", "M-12", "Rieter-001"
- **Notes:** Where the original sample was produced

### **notes** (string)
- **Max Length:** 500 characters
- **Required:** No (can be empty "")
- **Default:** ""
- **Examples:** "Rush order", "Quality check needed", "Customer approval pending"

---

## 🎯 Use Cases

### **Production Plan**
```javascript
{
  type: "PRODUCTION",
  startDate: "2025-11-29",
  endDate: "2025-12-09",
  days: 10,
  fabric: "Cotton",
  productionPerDay: 100,
  quantity: 5000,
  remaining: 5000,
  orderName: "ORDER-2025-001",
  notes: "Rush delivery needed",
  originalSampleMachine: "Machine-5"
}
```

### **Settings/Maintenance Plan**
```javascript
{
  type: "SETTINGS",
  startDate: "2025-12-10",
  endDate: "2025-12-11",
  days: 1,
  fabric: "Linen",
  productionPerDay: 0,
  quantity: 0,
  remaining: 0,
  orderName: "MAINT-001",
  notes: "Scheduled maintenance and calibration",
  originalSampleMachine: ""
}
```

---

## 📊 Progress Tracking

### **Updating Remaining Quantity**
As production progresses, update the remaining field:

```typescript
// Get current plan
const plan = machine.futurePlans.find(p => p.orderName === "ORDER-2025-001");

// Calculate produced amount
const produced = plan.quantity - plan.remaining;
const newProduced = produced + 100; // Produced 100 more units today
const newRemaining = plan.quantity - newProduced;

// Update in Firestore
const updatedPlans = machine.futurePlans.map(p =>
  p.orderName === "ORDER-2025-001"
    ? { ...p, remaining: newRemaining }
    : p
);

batch.update(doc(db, 'MachineSS', machineId), {
  futurePlans: updatedPlans
});
```

---

## 🔄 Integration with DailyLogEntry

Connection between daily logs and future plans:

```typescript
// When logging daily production:
const dailyLog: DailyLogEntry = {
  date: "2025-11-29",
  dayProduction: 100,      // ← Contributes to plan
  scrap: 5,
  fabric: "Cotton",        // ← Should match futurePlan.fabric
  client: "ABC Corp",      // ← Can extract from orderName
  status: "Working"
};

// This production counts toward the matching futurePlan
// futurePlan.remaining should decrease by (100 - 5) = 95
```

---

## ✅ Validation Rules

| Field | Required | Type | Constraints |
|-------|----------|------|------------|
| type | Yes | string | "PRODUCTION" \| "SETTINGS" |
| startDate | Yes | string | YYYY-MM-DD format, valid date |
| endDate | Yes | string | YYYY-MM-DD, >= startDate |
| days | Yes | number | >= 0, calculated from dates |
| fabric | Yes | string | Max 100 chars, non-empty |
| productionPerDay | Yes | number | >= 0 |
| quantity | Yes | number | >= 0, >= remaining |
| remaining | Yes | number | >= 0, <= quantity |
| orderName | Yes | string | Max 100 chars, non-empty |
| notes | No | string | Max 500 chars, can be "" |
| originalSampleMachine | No | string | Max 50 chars, can be "" |

---

## 🔌 Database Operations

### **Add New Plan**
```typescript
batch.update(
  doc(db, 'MachineSS', machineId),
  {
    futurePlans: arrayUnion(newPlan)
  }
);
```

### **Update Existing Plan**
```typescript
const updated = machine.futurePlans.map(p =>
  p.orderName === "ORDER-2025-001"
    ? { ...p, remaining: newValue }
    : p
);

batch.update(doc(db, 'MachineSS', machineId), {
  futurePlans: updated
});
```

### **Remove Plan**
```typescript
const filtered = machine.futurePlans.filter(
  p => p.orderName !== "ORDER-2025-001"
);

batch.update(doc(db, 'MachineSS', machineId), {
  futurePlans: filtered
});
```

### **Query Plans by Date Range**
```typescript
// Get plans for current week
const plans = machine.futurePlans.filter(p => {
  const start = new Date(p.startDate);
  const end = new Date(p.endDate);
  return start <= today && today <= end;
});
```

---

## 📈 Firestore Collection Structure

```
MachineSS/{machineId}
├── name: "Machine 1"
├── brand: "Rieter"
├── machineid: 1
├── dailyLogs: [...]
└── futurePlans: [
    {
      type: "PRODUCTION",
      days: 10,
      endDate: "2025-12-09",
      fabric: "Cotton",
      notes: "Rush order",
      orderName: "ORD-001",
      originalSampleMachine: "M-5",
      productionPerDay: 100,
      quantity: 5000,
      remaining: 3500,
      startDate: "2025-11-29"
    },
    {
      type: "SETTINGS",
      days: 1,
      endDate: "2025-12-10",
      fabric: "N/A",
      notes: "Maintenance",
      orderName: "MAINT-001",
      originalSampleMachine: "",
      productionPerDay: 0,
      quantity: 0,
      remaining: 0,
      startDate: "2025-12-10"
    }
  ]
```

---

## 🎓 Summary

The `FuturePlanEntry` now includes:
- ✅ 11 comprehensive fields
- ✅ Full production and settings support
- ✅ Date range tracking
- ✅ Progress tracking (remaining)
- ✅ Order and sample references
- ✅ Custom notes
- ✅ Complete validation support

**Next Step:** Tell me the exact fields you need for `DailyLogEntry` and I'll update those as well!

---

**Status:** ✅ FuturePlanEntry Complete  
**Compilation:** 0 Errors  
**Ready:** YES
