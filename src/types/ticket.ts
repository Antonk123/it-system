export type TicketStatus = 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Category {
  id: string;
  label: string;
  position?: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface User {
  id: string;
  name: string;
  email: string;
  department?: string;
  createdAt: Date;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category?: string;
  requesterId: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  notes?: string;
  solution?: string;
  templateId?: string;
  fieldValues?: CustomFieldInput[];
  tags?: Tag[];
}

export interface Comment {
  id: string;
  ticketId: string;
  userId: string;
  content: string;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  // Optional fields populated by joins
  userName?: string;
  userEmail?: string;
}

export interface CommentRow {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  is_internal: number;  // SQLite uses 0/1 for boolean
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Optional join fields
  user_name?: string;
  user_email?: string;
}

export interface TicketLink {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  linkType: 'related';
  createdBy: string | null;
  createdAt: Date;
  linkedTicket: {
    id: string;
    title: string;
    status: TicketStatus;
    priority: TicketPriority;
    createdAt: Date;
  };
}

export interface TicketLinkRow {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  linkType: string;
  createdBy: string | null;
  createdAt: string;
  linkedTicket: {
    id: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
  };
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  titleTemplate: string;
  descriptionTemplate: string;
  priority: TicketPriority;
  category: string | null;
  notesTemplate: string | null;
  solutionTemplate: string | null;
  position: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  fields?: TemplateFieldRow[];
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  title_template: string;
  description_template: string;
  priority: string;
  category_id: string | null;
  notes_template: string | null;
  solution_template: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fields?: TemplateFieldRow[];
}

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'date' | 'checkbox';

export interface TemplateField {
  id: string;
  templateId: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: FieldType;
  placeholder?: string | null;
  defaultValue?: string | null;
  required: boolean;
  options?: string[] | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateFieldRow {
  id: string;
  template_id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  placeholder: string | null;
  default_value: string | null;
  required: number;
  options: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldInput {
  fieldName: string;
  fieldLabel: string;
  fieldValue: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}
