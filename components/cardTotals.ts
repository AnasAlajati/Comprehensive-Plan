// Shared card-totals calculator — THE single source of truth for a customer's
// Manufactured + Ordered numbers (plus deliveries and order dates). Both the
// Orders-page summary card AND the Production-History "Populate" button call this,
// so the displayed list is guaranteed to equal the card exactly (no drift).
//
// Manufactured = internal machine logs (+ extra sessions) pinned by orderId,
// PLUS external receivedQty where the external's client matches AND its orderId
// matches the order. Ordered = sum(requiredQty); customerOrderedPlusAcc =
// sum(customerOrderedQty) + sum(accessoryQty). clientRemoved orders are excluded.
export const computeCustomerCardTotals = (
  customer: any,
  externalLogs: any[],
  machines: any[],
  subLogsByMachineId: Map<string, any[]> | undefined,
  transfers: { fromOrderId: string; toOrderId: string; quantity: number }[] = []
) => {
  const normalize = (s: string) => (s ? s.trim().toLowerCase() : '');
  const custName = customer?.name || '';
  let ordered = 0, customerOrdered = 0, accessory = 0, manufactured = 0, deliveries = 0;
  const orderDates: string[] = [];
  (customer?.orders || []).forEach((order: any) => {
    if (order.clientRemoved) return; // excluded from totals (same as the card)
    ordered += Number(order.requiredQty) || 0;
    if (order.customerOrderedQty != null) customerOrdered += Number(order.customerOrderedQty) || 0;
    accessory += Number(order.accessoryQty) || 0;
    if (order.orderReceiptDate) orderDates.push(order.orderReceiptDate);
    // Deliveries: explicit batchDeliveries + every dyeing-plan delivery event
    deliveries += Number(order.batchDeliveries) || 0;
    (order.dyeingPlan || []).forEach((batch: any) => {
      (batch.deliveryEvents || []).forEach((ev: any) => {
        deliveries += Number(ev.quantityColorDelivered) || 0;
      });
    });
    // Internal machine logs (+ extra sessions), pinned by orderId
    (machines || []).forEach((machine: any) => {
      (subLogsByMachineId?.get(String(machine.id)) || []).forEach((log: any) => {
        if (log.orderId === order.id) manufactured += Number(log.dayProduction) || 0;
        (log.extraSessions || []).forEach((session: any) => {
          if (session.orderId === order.id) manufactured += Number(session.dayProduction) || 0;
        });
      });
    });
    // External logs — same rule the card uses: client name + orderId must match
    (externalLogs || []).forEach((ext: any) => {
      if (!ext || normalize(ext.client) !== normalize(custName)) return;
      if (!ext.orderId || ext.orderId !== order.id) return;
      manufactured += Number(ext.receivedQty) || 0;
    });
    // Production transfers: add incoming, subtract outgoing
    transfers.forEach((t) => {
      if (t.toOrderId === order.id) manufactured += Number(t.quantity) || 0;
      if (t.fromOrderId === order.id) manufactured -= Number(t.quantity) || 0;
    });
  });
  return {
    ordered,
    customerOrdered,
    accessory,
    manufactured,
    deliveries,
    orderDates,
    customerOrderedPlusAcc: customerOrdered + accessory,
  };
};
