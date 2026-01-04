import { 
    collection, 
    doc, 
    getDocs, 
    getDoc,
    setDoc, 
    query, 
    where, 
    limit, 
    startAfter, 
    orderBy,
    Timestamp,
    writeBatch,
    QueryDocumentSnapshot,
    addDoc
} from 'firebase/firestore';
import { db } from './firebase';
import { YarnInventoryItem } from '../types';

const MAPPINGS_COLLECTION = 'yarn_mappings';
const INVENTORY_COLLECTION = 'yarn_inventory';

export interface YarnMapping {
    sourceName: string; // The name coming from the Order/Fabric (e.g. "Ctn 30")
    targetYarnId: string; // The ID in Inventory
    targetYarnName: string; // The Name in Inventory (e.g. "Cotton 30/1")
    updatedAt: string;
}

export const YarnService = {
    // --- Mappings ---

    // Get all mappings (cache this in the app)
    async getMappings(): Promise<Record<string, YarnMapping>> {
        try {
            const snapshot = await getDocs(collection(db, MAPPINGS_COLLECTION));
            const mappings: Record<string, YarnMapping> = {};
            snapshot.docs.forEach(doc => {
                mappings[doc.id] = doc.data() as YarnMapping;
            });
            return mappings;
        } catch (error) {
            console.error("Error fetching yarn mappings:", error);
            return {};
        }
    },

    // Save a new mapping
    async saveMapping(sourceName: string, targetYarnId: string, targetYarnName: string): Promise<void> {
        try {
            // Use sourceName as ID (sanitized) or just hash it. 
            // Simple approach: Use sourceName as ID if it's a valid ID, otherwise auto-id and query.
            // Better: Use a deterministic ID based on sourceName to prevent duplicates.
            // For now, let's assume sourceName is unique enough or we overwrite.
            const id = sourceName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            
            const mapping: YarnMapping = {
                sourceName,
                targetYarnId,
                targetYarnName,
                updatedAt: new Date().toISOString()
            };

            await setDoc(doc(db, MAPPINGS_COLLECTION, id), mapping);
        } catch (error) {
            console.error("Error saving yarn mapping:", error);
            throw error;
        }
    },

    // --- Inventory Search & Pagination ---

    // Get All Inventory (for client-side filtering/sorting)
    async getAllInventory(): Promise<YarnInventoryItem[]> {
        try {
            const q = query(collection(db, INVENTORY_COLLECTION));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as YarnInventoryItem));
        } catch (error) {
            console.error("Error fetching all inventory:", error);
            return [];
        }
    },

    // Optimized Search: Server-side prefix search
    async searchInventory(term: string, limitCount = 20): Promise<YarnInventoryItem[]> {
        if (!term) return [];
        
        // Firestore prefix search strategy
        const endTerm = term + '\uf8ff';
        
        try {
            const q = query(
                collection(db, INVENTORY_COLLECTION),
                where('yarnName', '>=', term),
                where('yarnName', '<=', endTerm),
                limit(limitCount)
            );
            
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as YarnInventoryItem));
        } catch (error) {
            console.error("Error searching inventory:", error);
            return [];
        }
    },

    // Paginated Fetch
    async getInventoryPage(pageSize: number, lastDoc?: QueryDocumentSnapshot): Promise<{ items: YarnInventoryItem[], lastDoc: QueryDocumentSnapshot | null }> {
        try {
            let q = query(
                collection(db, INVENTORY_COLLECTION),
                orderBy('yarnName'), // Ensure we have an index on yarnName
                limit(pageSize)
            );

            if (lastDoc) {
                q = query(
                    collection(db, INVENTORY_COLLECTION),
                    orderBy('yarnName'),
                    startAfter(lastDoc),
                    limit(pageSize)
                );
            }

            const snapshot = await getDocs(q);
            const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as YarnInventoryItem));
            const newLastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

            return { items, lastDoc: newLastDoc };
        } catch (error) {
            console.error("Error fetching inventory page:", error);
            return { items: [], lastDoc: null };
        }
    },

    // --- Master Yarn Management ---

    async getAllYarns(): Promise<any[]> {
        try {
            const snapshot = await getDocs(collection(db, 'yarns'));
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Error fetching master yarns:", error);
            return [];
        }
    },

    async addYarn(name: string): Promise<string> {
        try {
            const docRef = await addDoc(collection(db, 'yarns'), {
                name,
                createdAt: new Date().toISOString()
            });
            return docRef.id;
        } catch (error) {
            console.error("Error adding master yarn:", error);
            throw error;
        }
    }
};

