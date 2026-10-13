import { z } from 'zod';

// Text and original File blobs share one IndexedDB record. No base64/localStorage quota trap.
const TTL = 24 * 60 * 60 * 1000;
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('it-ticket-drafts', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Utkastslagringen är blockerad.'));
});
async function operation<T>(key: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = run(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(request.result as T); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export async function readTicketDraft<T>(key: string): Promise<T | null> {
  const record = await operation<{ expires: number; value: T } | undefined>(key, 'readonly', store => store.get(key));
  if (!record) return null;
  if (record.expires < Date.now()) { await deleteTicketDraft(key); return null; }
  return record.value;
}
export const writeTicketDraft = (key: string, value: unknown) => operation(key, 'readwrite', store => store.put({ expires: Date.now() + TTL, value }, key));
export const deleteTicketDraft = (key: string) => operation(key, 'readwrite', store => store.delete(key));

// IndexedDB survives app upgrades. Validate before any React state is restored,
// otherwise one stale/corrupt record can crash the form on every future visit.
const fileSchema = z.custom<File>(value => value instanceof File);
const formSchema = z.object({ title: z.string(), description: z.string(), priority: z.string(), category: z.string() });
const commonDraftSchema = z.object({
  submissionKey: z.string().uuid(),
  formData: formSchema,
  images: z.array(z.object({ id: z.string().uuid(), file: fileSchema })),
  customFieldValues: z.array(z.object({ fieldName: z.string(), fieldLabel: z.string(), fieldValue: z.string() })),
  selectedTemplate: z.object({
    id: z.string(), name: z.string(), priority: z.string(),
    fields: z.array(z.object({ id: z.string(), field_name: z.string(), field_label: z.string(), field_type: z.string(), required: z.number() })).optional(),
  }).nullable(),
});
const draftSchema = z.union([
  commonDraftSchema.extend({ formData: formSchema.extend({ name: z.string(), email: z.string() }), formStartedAt: z.number() }),
  commonDraftSchema.extend({
    formData: formSchema.extend({ requesterId: z.string(), status: z.string(), notes: z.string(), solution: z.string(), assigned_to: z.string(), company_id: z.string() }),
    pendingFiles: z.array(fileSchema),
    pendingChecklistItems: z.array(z.object({ id: z.string(), label: z.string(), completed: z.boolean() })),
    failedUploads: z.object({ files: z.array(fileSchema), ticketId: z.string() }).nullable().optional(),
  }),
]);
export const isValidTicketDraft = (value: unknown): boolean => draftSchema.safeParse(value).success;
