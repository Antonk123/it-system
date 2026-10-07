/** Save the parts of an ärende that can fail after the ticket itself is saved. */
export async function saveTicketExtras({
  ticketId,
  files,
  checklistLabels,
  uploadAttachment,
  addChecklistItems,
  onUploadProgress,
}: {
  ticketId: string;
  files: File[];
  checklistLabels: string[];
  uploadAttachment: (ticketId: string, file: File) => Promise<unknown | null>;
  addChecklistItems: (ticketId: string, labels: string[]) => Promise<unknown[]>;
  onUploadProgress?: (current: number, total: number) => void;
}): Promise<{ failedFiles: File[]; checklistFailed: boolean }> {
  const failedFiles: File[] = [];
  try {
    for (const [index, file] of files.entries()) {
      onUploadProgress?.(index + 1, files.length);
      try {
        if (!await uploadAttachment(ticketId, file)) failedFiles.push(file);
      } catch {
        failedFiles.push(file);
      }
    }
  } finally {
    onUploadProgress?.(0, 0);
  }

  let checklistFailed = false;
  if (checklistLabels.length > 0) {
    try {
      const saved = await addChecklistItems(ticketId, checklistLabels);
      checklistFailed = saved.length !== checklistLabels.length;
    } catch {
      checklistFailed = true;
    }
  }

  return { failedFiles, checklistFailed };
}
