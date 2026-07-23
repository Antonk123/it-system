import { z } from 'zod';

// Ticket validation schemas
export const ticketInsertSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: z.string().trim().max(5000, 'Description must be less than 5000 characters').optional(),
  status: z.enum(['open', 'in-progress', 'waiting', 'resolved', 'closed']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  notes: z.string().max(5000, 'Notes must be less than 5000 characters').optional().nullable(),
  solution: z.string().max(5000, 'Solution must be less than 5000 characters').optional().nullable(),
  category: z.string().uuid().optional(),
  requesterId: z.string().optional(),
});

export const ticketUpdateSchema = ticketInsertSchema.partial();

// Contact validation schemas
export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  email: z.string().trim().email('Invalid email format').max(255, 'Email must be less than 255 characters'),
  department: z.string().max(100, 'Department must be less than 100 characters').optional(),
});

export const contactUpdateSchema = contactSchema.partial();

// Company validation schemas
export const companySchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200, 'Company name must be less than 200 characters'),
  org_number: z.string().max(20).optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
});

// Category validation schemas
export const categorySchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(50, 'Label must be less than 50 characters'),
});

// Checklist validation schemas
export const checklistItemSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(200, 'Label must be less than 200 characters'),
});

// Template validation schemas
// Base template schema without refinements (for partial updates)
const templateBaseSchema = z.object({
  name: z.string().trim().min(1, 'Mall-namn krävs').max(100, 'Mall-namn får vara max 100 tecken'),
  description: z.string().max(500, 'Beskrivning får vara max 500 tecken').optional().nullable(),
  type: z.enum(['standard', 'dynamic']).optional(),
  titleTemplate: z.string().trim().min(1, 'Titelmall krävs').max(200, 'Titelmall får vara max 200 tecken'),
  descriptionTemplate: z.string().trim().max(5000, 'Beskrivningsmall får vara max 5000 tecken').optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.string().uuid().optional().nullable(),
  notesTemplate: z.string().max(5000).optional().nullable(),
  solutionTemplate: z.string().max(5000).optional().nullable(),
});

// Full template schema with validation
export const templateSchema = templateBaseSchema.superRefine((data, ctx) => {
  // For standard templates, descriptionTemplate is required
  if (data.type === 'standard' && (!data.descriptionTemplate || data.descriptionTemplate.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Beskrivningsmall krävs för standard-mallar',
      path: ['descriptionTemplate'],
    });
  }
});

export const templateUpdateSchema = templateBaseSchema.partial();

// File upload validation
// Kept in sync with the backend whitelist (server/src/routes/attachments.ts
// ALLOWED_MIME_TYPES / ALLOWED_EXTENSIONS) — a mismatch here lets a file pass
// client-side validation only to be rejected by the server, or vice versa.
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'message/rfc822', // .eml files
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
];

// Some browsers don't set MIME type for certain files, so this is checked as a fallback.
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf',
  '.txt', '.csv', '.md', '.markdown', '.eml',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z',
];

export const fileUploadSchema = z.object({
  file: z.instanceof(File)
    .refine(f => f.size <= 10 * 1024 * 1024, 'File must be 10MB or less')
    .refine(
      f => {
        const fileName = f.name.toLowerCase();
        const hasAllowedExtension = ALLOWED_ATTACHMENT_EXTENSIONS.some(ext => fileName.endsWith(ext));
        return ALLOWED_ATTACHMENT_MIME_TYPES.includes(f.type) || hasAllowedExtension;
      },
      'Invalid file type. Allowed: images (incl. SVG), PDF, text, Markdown, Word, Excel, PowerPoint, archives (.zip, .rar, .7z), email files (.eml)'
    ),
});

// Helper to get validation error message
export const getValidationError = (error: unknown): string | null => {
  if (error instanceof z.ZodError) {
    return error.issues.map(e => e.message).join(', ');
  }
  return null;
};
