import type { TimeEntryRow } from '@/types/ticket';

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

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class ApiClient {
  private baseUrl: string;
  private csrfToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  setToken(token: string): void {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('token', token); // For axios interceptor
    this.csrfToken = null; // Invalidate cached CSRF token on auth change
  }

  setRefreshToken(refreshToken: string): void {
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearToken(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    this.csrfToken = null;
  }

  // Lazily fetch and cache the CSRF token. The token is bound to the current
  // auth session via the Authorization header (see backend getSessionIdentifier).
  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const data = await this.request<{ csrfToken: string }>('/csrf-token');
    this.csrfToken = data.csrfToken;
    return this.csrfToken;
  }

  private isCsrfError(error: { error?: string; code?: string }): boolean {
    return error.code === 'EBADCSRFTOKEN' || !!(error.error?.toLowerCase().includes('csrf'));
  }

  async request<T>(endpoint: string, options: ApiOptions = {}, isRetry = false): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const token = this.getToken();
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Attach CSRF token for all state-changing requests
    if (MUTATING_METHODS.has(method)) {
      requestHeaders['X-CSRF-Token'] = await this.getCsrfToken();
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include', // Required for CSRF cookie to be sent
    });

    if (!response.ok) {
      // Handle 401: attempt silent token refresh BEFORE consuming body
      if (response.status === 401 && !isRetry) {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          try {
            const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });
            if (refreshRes.ok) {
              const data = await refreshRes.json() as { accessToken: string; refreshToken?: string };
              this.setToken(data.accessToken);
              if (data.refreshToken) {
                localStorage.setItem('refreshToken', data.refreshToken);
              }
              // Retry the original request with new token
              return this.request<T>(endpoint, options, true);
            }
          } catch {
            // Swallow refresh errors — fall through to redirect
          }
        }
        // Refresh token absent or expired — silent redirect, no toast
        this.clearToken();
        localStorage.removeItem('user');
        window.location.href = '/login';
        throw new Error('Session expired');
      }

      const error = await response.json().catch(() => ({ error: 'Request failed' }));

      // On CSRF failure: clear stale token and retry once
      if (response.status === 403 && !isRetry && this.isCsrfError(error)) {
        this.csrfToken = null;
        return this.request<T>(endpoint, options, true);
      }

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
    headers['X-CSRF-Token'] = await this.getCsrfToken();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || error.message || 'Upload failed');
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    const data = await this.request<{ user: AuthUser; token: string; accessToken?: string; refreshToken?: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this.setToken(data.token);
    if (data.refreshToken) {
      this.setRefreshToken(data.refreshToken);
    }
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

  async logout() {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        // Revoke refresh token on backend
        await this.request('/auth/logout', {
          method: 'POST',
          body: { refreshToken },
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.clearToken();
    }
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
    headers['X-CSRF-Token'] = await this.getCsrfToken();

    const response = await fetch(`${this.baseUrl}/tickets/import/preview`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
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

  async getTemplate(id: string) {
    return this.request<TemplateRow & { fields: TemplateFieldRow[] }>(`/templates/${id}`);
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

  async bulkUpdateTickets(ids: string[], updates: { status?: string; priority?: string; category_id?: string | null }) {
    return this.request<{ updated: number }>('/tickets/bulk', {
      method: 'PUT',
      body: { ids, updates },
    });
  }

  async bulkDeleteTickets(ids: string[]): Promise<{ deleted: number }> {
    return this.request('/tickets/bulk-delete', {
      method: 'POST',
      body: { ids },
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

  // Reminders
  async createReminder(ticketId: string, data: { reminder_time: string; message?: string }) {
    return this.request(`/tickets/${ticketId}/reminders`, {
      method: 'POST',
      body: data,
    });
  }

  async getReminders(ticketId: string) {
    return this.request(`/tickets/${ticketId}/reminders`);
  }

  async deleteReminder(ticketId: string, reminderId: string) {
    return this.request<{ message: string }>(`/tickets/${ticketId}/reminders/${reminderId}`, {
      method: 'DELETE',
    });
  }

  async clearSentReminders(ticketId: string) {
    return this.request<{ deleted: number }>(`/tickets/${ticketId}/reminders/sent`, {
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
    template_type?: 'standard' | 'dynamic';
    title_template: string;
    description_template?: string | null;
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
    headers['X-CSRF-Token'] = await this.getCsrfToken();

    const response = await fetch(`${this.baseUrl}/contacts/import/preview`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
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

  // Companies
  async getCompanies() {
    return this.request<CompanyRow[]>('/companies');
  }

  async getCompany(id: string) {
    return this.request<CompanyDetail>(`/companies/${id}`);
  }

  async createCompany(company: Partial<CompanyRow>) {
    return this.request<CompanyRow>('/companies', {
      method: 'POST',
      body: company,
    });
  }

  async updateCompany(id: string, updates: Partial<CompanyRow>) {
    return this.request<CompanyRow>(`/companies/${id}`, {
      method: 'PUT',
      body: updates,
    });
  }

  async deleteCompany(id: string) {
    return this.request<{ message: string }>(`/companies/${id}`, {
      method: 'DELETE',
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

  async createChecklistItem(ticketId: string, label: string, options?: { parent_id?: string | null; due_date?: string | null }) {
    return this.request<ChecklistRow>(`/checklists/ticket/${ticketId}`, {
      method: 'POST',
      body: { label, ...options },
    });
  }

  async bulkCreateChecklistItems(ticketId: string, labels: string[]) {
    return this.request<ChecklistRow[]>(`/checklists/ticket/${ticketId}/bulk`, {
      method: 'POST',
      body: { labels },
    });
  }

  async updateChecklistItem(id: string, updates: Partial<Pick<ChecklistRow, 'label' | 'completed' | 'due_date' | 'parent_id'>>) {
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

  // Checklist Templates
  async getChecklistTemplates() {
    return this.request<ChecklistTemplate[]>('/checklist-templates');
  }

  async createChecklistTemplate(data: { name: string; description?: string; items: { label: string; parent_label?: string }[] }) {
    return this.request<ChecklistTemplate>('/checklist-templates', {
      method: 'POST',
      body: data,
    });
  }

  async updateChecklistTemplate(id: string, data: { name?: string; description?: string; items?: { label: string; parent_label?: string }[] }) {
    return this.request<ChecklistTemplate>(`/checklist-templates/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteChecklistTemplate(id: string) {
    return this.request<{ message: string }>(`/checklist-templates/${id}`, {
      method: 'DELETE',
    });
  }

  async applyChecklistTemplate(templateId: string, ticketId: string) {
    return this.request<ChecklistRow[]>(`/checklist-templates/${templateId}/apply`, {
      method: 'POST',
      body: { ticketId },
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

  // Tags
  async getTags() {
    return this.request<{ id: string; name: string; color: string; created_at: string }[]>('/tags');
  }

  async createTag(data: { name: string; color?: string }) {
    return this.request<{ id: string; name: string; color: string; created_at: string }>('/tags', {
      method: 'POST',
      body: data,
    });
  }

  async updateTag(id: string, data: { name: string; color?: string }) {
    return this.request<{ id: string; name: string; color: string; created_at: string }>(`/tags/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteTag(id: string) {
    return this.request<{ message: string }>(`/tags/${id}`, {
      method: 'DELETE',
    });
  }

  // Knowledge Base - Categories
  async getKbCategories() {
    return this.request<KbCategoryRow[]>('/kb/categories');
  }

  async createKbCategory(name: string, color?: string) {
    return this.request<KbCategoryRow>('/kb/categories', {
      method: 'POST',
      body: { name, color },
    });
  }

  async updateKbCategory(id: string, name: string, color?: string) {
    return this.request<KbCategoryRow>(`/kb/categories/${id}`, {
      method: 'PUT',
      body: { name, color },
    });
  }

  async deleteKbCategory(id: string) {
    return this.request<{ message: string }>(`/kb/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // Knowledge Base - Articles
  async getKbArticles(params?: { search?: string; category_id?: string; article_type?: string; tag?: string; stale?: boolean }) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.category_id) qs.set('category_id', params.category_id);
    if (params?.article_type) qs.set('article_type', params.article_type);
    if (params?.tag) qs.set('tag', params.tag);
    if (params?.stale) qs.set('stale', '1');
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<KbArticleRow[]>(`/kb/articles${query}`);
  }

  async getKbArticle(id: string) {
    return this.request<KbArticleRow>(`/kb/articles/${id}`);
  }

  async reviewKbArticle(id: string) {
    return this.request<{ last_reviewed_at: string }>(`/kb/articles/${id}/review`, {
      method: 'PATCH',
    });
  }

  async getArticleLinkedTickets(articleId: string) {
    return this.request<LinkedTicketRow[]>(`/kb/articles/${articleId}/tickets`);
  }

  async createKbArticle(data: { title: string; content: string; category_id?: string | null; article_type?: string | null; tag_ids?: string[]; status?: 'draft' | 'published' }) {
    return this.request<KbArticleRow>('/kb/articles', {
      method: 'POST',
      body: data,
    });
  }

  async updateKbArticle(id: string, data: { title: string; content: string; category_id?: string | null; article_type?: string | null; tag_ids?: string[]; status?: 'draft' | 'published' }) {
    return this.request<KbArticleRow>(`/kb/articles/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteKbArticle(id: string) {
    return this.request<{ message: string }>(`/kb/articles/${id}`, {
      method: 'DELETE',
    });
  }

  // Knowledge Base - Ticket links
  async getTicketKbLinks(ticketId: string) {
    return this.request<(KbArticleRow & { link_id: string })[]>(`/kb/ticket/${ticketId}`);
  }

  async linkKbArticleToTicket(ticketId: string, articleId: string) {
    return this.request<{ id: string }>(`/kb/ticket/${ticketId}`, {
      method: 'POST',
      body: { articleId },
    });
  }

  async unlinkKbArticleFromTicket(ticketId: string, articleId: string) {
    return this.request<{ message: string }>(`/kb/ticket/${ticketId}/${articleId}`, {
      method: 'DELETE',
    });
  }

  // Knowledge Base - Sharing
  async getKbArticleShare(articleId: string) {
    return this.request<{ share_token: string | null }>(`/kb/articles/${articleId}/share`);
  }

  async createKbArticleShare(articleId: string) {
    return this.request<{ share_token: string }>(`/kb/articles/${articleId}/share`, {
      method: 'POST',
    });
  }

  async revokeKbArticleShare(articleId: string) {
    return this.request<{ message: string }>(`/kb/articles/${articleId}/share`, {
      method: 'DELETE',
    });
  }

  // Knowledge Base - Cross-References
  async getKbArticleLinks(articleId: string) {
    return this.request<LinkedArticleRow[]>(`/kb/articles/${articleId}/links`);
  }

  async addKbArticleLink(articleId: string, targetArticleId: string) {
    return this.request<{ id: string; source_article_id: string; target_article_id: string }>(`/kb/articles/${articleId}/links`, {
      method: 'POST',
      body: { targetArticleId },
    });
  }

  async removeKbArticleLink(articleId: string, targetArticleId: string) {
    return this.request<{ message: string }>(`/kb/articles/${articleId}/links/${targetArticleId}`, {
      method: 'DELETE',
    });
  }

  async getPublicKbArticle(token: string) {
    return this.request<KbArticleRow>(`/kb/public/${token}`);
  }

  async uploadKbImage(file: File): Promise<{ url: string }> {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('image', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    headers['X-CSRF-Token'] = await this.getCsrfToken();

    const response = await fetch(`${this.baseUrl}/kb/upload-image`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || error.message || 'Upload failed');
    }

    return response.json();
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

  // Time Entries
  async getTimeEntries(ticketId: string) {
    return this.request<{ entries: TimeEntryRow[]; total_minutes: number }>(
      `/time-entries/${ticketId}`
    );
  }

  async createTimeEntry(ticketId: string, payload: { duration_minutes: number; note?: string }) {
    return this.request<TimeEntryRow>(`/time-entries/${ticketId}`, {
      method: 'POST',
      body: payload,
    });
  }

  async deleteTimeEntry(ticketId: string, entryId: string) {
    return this.request<null>(`/time-entries/${ticketId}/${entryId}`, {
      method: 'DELETE',
    });
  }

  async getTimeReportsSummary(year: string, month: string) {
    return this.request<{
      byCategory: { category: string; total_minutes: number }[];
      topTickets: { id: string; title: string; total_minutes: number }[];
    }>(`/reports/time-summary?year=${year}&month=${month}`);
  }

  // Push notification subscription
  async getPushVapidKey(): Promise<{ vapidPublicKey: string }> {
    return this.request('/push/vapid-public-key');
  }

  async subscribePush(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }> {
    return this.request('/push/subscribe', { method: 'POST', body: subscription });
  }

  async unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
    return this.request('/push/unsubscribe', { method: 'DELETE', body: { endpoint } });
  }

  // Billing
  async getBillingRate(companyId: string) {
    return this.request<BillingRateRow | null>(`/billing/rates/${companyId}`);
  }

  async upsertBillingRate(companyId: string, ratePerHour: number, currency?: string) {
    return this.request<BillingRateRow>(`/billing/rates/${companyId}`, {
      method: 'PUT',
      body: { rate_per_hour: ratePerHour, currency: currency || 'SEK' },
    });
  }

  async getInvoices(companyId?: string) {
    const query = companyId ? `?company_id=${companyId}` : '';
    return this.request<InvoiceRow[]>(`/billing/invoices${query}`);
  }

  async getInvoice(id: string) {
    return this.request<InvoiceDetail>(`/billing/invoices/${id}`);
  }

  async previewInvoice(companyId: string, periodStart: string, periodEnd: string) {
    return this.request<InvoicePreview>('/billing/invoices/preview', {
      method: 'POST',
      body: { company_id: companyId, period_start: periodStart, period_end: periodEnd },
    });
  }

  async createInvoice(data: { company_id: string; period_start: string; period_end: string; lines: any[]; total_hours: number; total_amount: number; currency: string }) {
    return this.request<InvoiceRow>('/billing/invoices', {
      method: 'POST',
      body: data,
    });
  }

  async updateInvoiceStatus(id: string, status: string) {
    return this.request<InvoiceRow>(`/billing/invoices/${id}/status`, {
      method: 'PUT',
      body: { status },
    });
  }

  async deleteInvoice(id: string) {
    return this.request<{ message: string }>(`/billing/invoices/${id}`, {
      method: 'DELETE',
    });
  }

  // API Keys
  async getApiKeys() {
    return this.request<ApiKeyRow[]>('/api-keys');
  }

  async createApiKey(data: { name: string; permissions?: string[]; expires_at?: string }) {
    return this.request<ApiKeyRow>('/api-keys', {
      method: 'POST',
      body: data,
    });
  }

  async deleteApiKey(id: string) {
    return this.request<{ message: string }>(`/api-keys/${id}`, {
      method: 'DELETE',
    });
  }

  // Webhooks
  async getWebhooks() {
    return this.request<WebhookRow[]>('/webhooks');
  }

  async createWebhook(data: { url: string; events: string[] }) {
    return this.request<WebhookRow>('/webhooks', {
      method: 'POST',
      body: data,
    });
  }

  async updateWebhook(id: string, data: { url?: string; events?: string[]; active?: boolean }) {
    return this.request<WebhookRow>(`/webhooks/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteWebhook(id: string) {
    return this.request<{ message: string }>(`/webhooks/${id}`, {
      method: 'DELETE',
    });
  }

  async getWebhookDeliveries(webhookId: string) {
    return this.request<WebhookDeliveryRow[]>(`/webhooks/${webhookId}/deliveries`);
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
  company_id: string | null;
  company_name?: string | null;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  notes: string | null;
  solution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  template_id?: string | null;
  field_values?: { field_name: string; field_label: string; field_value: string }[];
  tags?: Array<{ id: string; name: string; color: string }>;
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
  company_id: string | null;
  company_name: string | null;
  department: string | null;
  created_at: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  org_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  contact_count: number;
  open_ticket_count: number;
  total_ticket_count: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyDetail extends CompanyRow {
  contacts: Array<{ id: string; name: string; email: string; phone: string | null; created_at: string }>;
  stats: {
    total: number;
    open_count: number;
    closed_count: number;
    avg_resolution_days: number | null;
    total_minutes: number;
  };
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
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistTemplateItem {
  id: string;
  template_id: string;
  label: string;
  parent_label: string | null;
  position: number;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  items: ChecklistTemplateItem[];
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

export interface KbCategoryRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  article_count: number;
  created_at: string;
}

export interface KbArticleRow {
  id: string;
  title: string;
  content: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  article_type?: string | null;
  status: 'draft' | 'published';
  tags: { id: string; name: string; color: string }[];
  snippet?: string | null;
  created_at: string;
  updated_at: string;
  last_reviewed_at?: string | null;
}

export interface LinkedTicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface LinkedArticleRow {
  id: string;
  title: string;
  article_type: string | null;
  link_id: string;
}

export interface CustomFieldInput {
  fieldName: string;
  fieldLabel: string;
  fieldValue: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key?: string; // Only present on creation response
  key_prefix: string;
  permissions: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret?: string; // Only present on creation response
  active: number;
  created_at: string;
  last_triggered_at: string | null;
}

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  response_code: number | null;
  attempts: number;
  delivered_at: string | null;
  created_at: string;
}

export interface BillingRateRow {
  id: string;
  company_id: string;
  rate_per_hour: number;
  currency: string;
}

export interface InvoiceRow {
  id: string;
  company_id: string;
  company_name?: string;
  period_start: string;
  period_end: string;
  status: string;
  total_hours: number;
  total_amount: number;
  currency: string;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
}

export interface InvoiceLineRow {
  id: string;
  ticket_id: string | null;
  ticket_title?: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
}

export interface InvoiceDetail extends InvoiceRow {
  org_number?: string;
  company_email?: string;
  company_address?: string;
  lines: InvoiceLineRow[];
}

export interface InvoicePreview {
  company_id: string;
  period_start: string;
  period_end: string;
  rate_per_hour: number;
  currency: string;
  lines: Array<InvoiceLineRow & { entry_count: number }>;
  total_hours: number;
  total_amount: number;
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL);
