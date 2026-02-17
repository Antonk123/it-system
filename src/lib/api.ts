const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  setToken(token: string): void {
    localStorage.setItem('auth_token', token);
  }

  clearToken(): void {
    localStorage.removeItem('auth_token');
  }

  async request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const token = this.getToken();
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || error.message || 'Request failed');
    }

    // Handle empty responses (204) and non-JSON responses gracefully
    if (response.status === 204) {
      return null as unknown as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    // Fallback: try to read as text and parse JSON if possible, otherwise return the raw text
    const text = await response.text();
    if (!text) return null as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async uploadFile<T>(endpoint: string, file: File): Promise<T> {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || error.message || 'Upload failed');
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    const data = await this.request<{ user: AuthUser; token: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this.setToken(data.token);
    return data;
  }

  async getMe() {
    return this.request<{ user: AuthUser }>('/auth/me');
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  }

  logout() {
    this.clearToken();
  }

  // Tickets
  async getTickets(queryString?: string) {
    return this.request<TicketRow[] | PaginatedResponse<TicketRow>>(`/tickets${queryString || ''}`);
  }

  async exportTickets(queryString?: string): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/tickets/export${queryString || ''}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to export tickets');
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'tickets-export.csv';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="(.+)"/);
      if (match) filename = match[1];
    }

    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async importTicketsPreview(file: File) {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/tickets/import/preview`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Preview failed' }));
      throw new Error(error.error || 'Preview failed');
    }

    return response.json();
  }

  async importTicketsConfirm(tickets: any[]) {
    return this.request<{ success: boolean; created: number; failed: number; errors: string[] }>('/tickets/import/confirm', {
      method: 'POST',
      body: { tickets },
    });
  }

  async getTicket(id: string) {
    return this.request<TicketRow>(`/tickets/${id}`);
  }

  async createTicket(ticket: Partial<TicketRow> & { customFields?: CustomFieldInput[]; template_id?: string | null }) {
    return this.request<TicketRow>('/tickets', {
      method: 'POST',
      body: ticket,
    });
  }

  async updateTicket(id: string, updates: Partial<TicketRow> & { customFields?: CustomFieldInput[] }) {
    return this.request<TicketRow>(`/tickets/${id}`, {
      method: 'PUT',
      body: updates,
    });
  }

  async deleteTicket(id: string) {
    return this.request<{ message: string }>(`/tickets/${id}`, {
      method: 'DELETE',
    });
  }

  async getTicketHistory(id: string) {
    return this.request<TicketHistoryItem[]>(`/tickets/${id}/history`);
  }

  // Ticket Comments
  async getComments(ticketId: string) {
    return this.request(`/comments/ticket/${ticketId}`);
  }

  async createComment(ticketId: string, content: string, isInternal: boolean = true) {
    return this.request(`/comments/ticket/${ticketId}`, {
      method: 'POST',
      body: { content, isInternal },
    });
  }

  async updateComment(commentId: string, content: string) {
    return this.request(`/comments/${commentId}`, {
      method: 'PUT',
      body: { content },
    });
  }

  async deleteComment(commentId: string) {
    return this.request<{ message: string }>(`/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  // Ticket Links
  async getTicketLinks(ticketId: string) {
    return this.request(`/links/ticket/${ticketId}`);
  }

  async createTicketLink(ticketId: string, targetTicketId: string, linkType: string = 'related') {
    return this.request(`/links/ticket/${ticketId}`, {
      method: 'POST',
      body: { targetTicketId, linkType },
    });
  }

  async deleteTicketLink(linkId: string) {
    return this.request<{ message: string }>(`/links/${linkId}`, {
      method: 'DELETE',
    });
  }

  // Categories
  async getCategories() {
    return this.request<CategoryRow[]>('/categories');
  }

  async createCategory(label: string) {
    return this.request<CategoryRow>('/categories', {
      method: 'POST',
      body: { label },
    });
  }

  async reorderCategories(ids: string[]) {
    return this.request<CategoryRow[]>('/categories/reorder', {
      method: 'PUT',
      body: { ids },
    });
  }

  async updateCategory(id: string, label: string) {
    return this.request<CategoryRow>(`/categories/${id}`, {
      method: 'PUT',
      body: { label },
    });
  }

  async deleteCategory(id: string) {
    return this.request<{ message: string }>(`/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // Templates
  async getTemplates() {
    return this.request<TemplateRow[]>('/templates');
  }

  async createTemplate(data: {
    name: string;
    description?: string | null;
    title_template: string;
    description_template: string;
    priority?: string;
    category_id?: string | null;
    notes_template?: string | null;
    solution_template?: string | null;
  }) {
    return this.request<TemplateRow>('/templates', {
      method: 'POST',
      body: data,
    });
  }

  async updateTemplate(id: string, data: Partial<{
    name: string;
    description: string | null;
    title_template: string;
    description_template: string;
    priority: string;
    category_id: string | null;
    notes_template: string | null;
    solution_template: string | null;
  }>) {
    return this.request<TemplateRow>(`/templates/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteTemplate(id: string) {
    return this.request<{ message: string }>(`/templates/${id}`, {
      method: 'DELETE',
    });
  }

  async reorderTemplates(ids: string[]) {
    return this.request<TemplateRow[]>('/templates/reorder', {
      method: 'PUT',
      body: { ids },
    });
  }

  // Template Fields
  async getTemplateFields(templateId: string) {
    return this.request<TemplateFieldRow[]>(`/templates/${templateId}/fields`);
  }

  async createTemplateField(templateId: string, data: {
    field_name: string;
    field_label: string;
    field_type: string;
    placeholder?: string;
    default_value?: string;
    required?: boolean;
    options?: string[];
  }) {
    return this.request<TemplateFieldRow>(`/templates/${templateId}/fields`, {
      method: 'POST',
      body: data,
    });
  }

  async updateTemplateField(templateId: string, fieldId: string, data: Partial<{
    field_name: string;
    field_label: string;
    field_type: string;
    placeholder: string;
    default_value: string;
    required: boolean;
    options: string[];
  }>) {
    return this.request<TemplateFieldRow>(`/templates/${templateId}/fields/${fieldId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteTemplateField(templateId: string, fieldId: string) {
    return this.request<void>(`/templates/${templateId}/fields/${fieldId}`, {
      method: 'DELETE',
    });
  }

  async reorderTemplateFields(templateId: string, ids: string[]) {
    return this.request<TemplateFieldRow[]>(`/templates/${templateId}/fields/reorder`, {
      method: 'PUT',
      body: { ids },
    });
  }

  // Contacts
  async getContacts() {
    return this.request<ContactRow[]>('/contacts');
  }

  async getContact(id: string) {
    return this.request<ContactRow>(`/contacts/${id}`);
  }

  async createContact(contact: Partial<ContactRow>) {
    return this.request<ContactRow>('/contacts', {
      method: 'POST',
      body: contact,
    });
  }

  async updateContact(id: string, updates: Partial<ContactRow>) {
    return this.request<ContactRow>(`/contacts/${id}`, {
      method: 'PUT',
      body: updates,
    });
  }

  async deleteContact(id: string) {
    return this.request<{ message: string }>(`/contacts/${id}`, {
      method: 'DELETE',
    });
  }

  async exportContacts(): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/contacts/export`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to export contacts');
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'kontakter-export.csv';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="(.+)"/);
      if (match) filename = match[1];
    }

    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async importContactsPreview(file: File) {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/contacts/import/preview`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Preview failed' }));
      throw new Error(error.error || 'Preview failed');
    }

    return response.json();
  }

  async importContactsConfirm(contacts: any[]) {
    return this.request<{ success: boolean; created: number; failed: number; errors: string[] }>('/contacts/import/confirm', {
      method: 'POST',
      body: { contacts },
    });
  }

  // Attachments
  async getAttachments(ticketId: string) {
    return this.request<AttachmentRow[]>(`/attachments/ticket/${ticketId}`);
  }

  async uploadAttachment(ticketId: string, file: File) {
    return this.uploadFile<AttachmentRow>(`/attachments/ticket/${ticketId}`, file);
  }

  async deleteAttachment(id: string) {
    return this.request<{ message: string }>(`/attachments/${id}`, {
      method: 'DELETE',
    });
  }

  getAttachmentUrl(id: string): string {
    // NOTE: This URL requires authentication via Authorization header
    // Frontend must fetch with Authorization header, not use URL directly in <img> or <a>
    return `${this.baseUrl}/attachments/file/${id}`;
  }

  // Checklists
  async getChecklists(ticketId: string) {
    return this.request<ChecklistRow[]>(`/checklists/ticket/${ticketId}`);
  }

  async createChecklistItem(ticketId: string, label: string) {
    return this.request<ChecklistRow>(`/checklists/ticket/${ticketId}`, {
      method: 'POST',
      body: { label },
    });
  }

  async bulkCreateChecklistItems(ticketId: string, labels: string[]) {
    return this.request<ChecklistRow[]>(`/checklists/ticket/${ticketId}/bulk`, {
      method: 'POST',
      body: { labels },
    });
  }

  async updateChecklistItem(id: string, updates: Partial<Pick<ChecklistRow, 'label' | 'completed'>>) {
    return this.request<ChecklistRow>(`/checklists/${id}`, {
      method: 'PUT',
      body: updates,
    });
  }

  async deleteChecklistItem(id: string) {
    return this.request<{ message: string }>(`/checklists/${id}`, {
      method: 'DELETE',
    });
  }

  // Shares
  async getShareToken(ticketId: string) {
    return this.request<{ share_token: string | null }>(`/shares/ticket/${ticketId}`);
  }

  async createShareToken(ticketId: string) {
    return this.request<{ share_token: string }>(`/shares/ticket/${ticketId}`, {
      method: 'POST',
    });
  }

  async deleteShareToken(ticketId: string) {
    return this.request<{ message: string }>(`/shares/ticket/${ticketId}`, {
      method: 'DELETE',
    });
  }

  async getSharedTicket(token: string) {
    return this.request<SharedTicketData>(`/shares/public/${token}`);
  }

  // System Users
  async getSystemUsers() {
    return this.request<{ users: SystemUser[] }>('/users');
  }

  async createSystemUser(email: string, role: 'admin' | 'user' = 'user', displayName?: string) {
    return this.request<{ message: string; user: { id: string; email: string; role: string; displayName?: string | null }; temporaryPassword?: string }>('/users', {
      method: 'POST',
      body: { email, role, displayName },
    });
  }

  async updateSystemUserRole(userId: string, role: 'admin' | 'user') {
    return this.request<{ message: string }>(`/users/${userId}`, {
      method: 'PATCH',
      body: { role },
    });
  }

  async deleteSystemUser(userId: string) {
    return this.request<{ message: string }>(`/users/${userId}`, {
      method: 'DELETE',
    });
  }

  // Public endpoints (no auth)
  async getPublicCategories() {
    return this.request<{ id: string; label: string }[]>('/public/categories');
  }

  async getPublicTemplates() {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      title_template: string;
      description_template: string;
      priority: string;
      category_id: string | null;
      fields?: TemplateFieldRow[];
    }[]>('/public/templates');
  }

  async submitPublicTicket(data: {
    name: string;
    email: string;
    title: string;
    description?: string;
    category?: string;
    priority?: string;
    customFields?: CustomFieldInput[];
    template_id?: string;
  }) {
    return this.request<{ message: string; ticketId: string }>('/public/tickets', {
      method: 'POST',
      body: data,
    });
  }
}

// Types
export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category_id: string | null;
  requester_id: string | null;
  notes: string | null;
  solution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  template_id?: string | null;
  field_values?: { field_name: string; field_label: string; field_value: string }[];
}

export interface TicketHistoryItem {
  id: string;
  ticket_id: string;
  user_id: string | null;
  user_name: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  label: string;
  position: number;
  created_at: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  ticket_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
  url: string;
}

export interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SystemUser {
  id: string;
  email: string;
  displayName?: string | null;
  role: 'admin' | 'user';
  createdAt: string;
  lastSignIn: string | null;
  emailConfirmed: boolean;
}

export interface SharedTicketData {
  ticket: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    solution: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    closed_at: string | null;
    category: {
      id: string;
      name: string;
      label: string;
    } | null;
  };
  requester: {
    id: string;
    name: string;
    email: string;
    company: string | null;
  } | null;
  attachments: Array<{
    id: string;
    file_name: string;
    file_path: string;
    file_type: string | null;
    file_size: number | null;
    url: string | null;
  }>;
  checklistItems: Array<{
    id: string;
    label: string;
    completed: boolean;
    position: number;
  }>;
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

// Export singleton instance
export const api = new ApiClient(API_BASE_URL);
