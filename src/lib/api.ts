import type { TimeEntryRow } from '@/types/ticket';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PaginatedResponse<T> {
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
    this.csrfToken = null; // Invalidera cachad CSRF-token vid auth-byte
  }

  clearToken(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken'); // rensa ev. gammal token (pre-cookie-migration)
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

  // Decode JWT payload and check expiration. 30s skew lets us refresh just before expiry.
  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (typeof payload.exp !== 'number') return false;
      return payload.exp * 1000 < Date.now() + 30_000;
    } catch {
      return false; // Malformed — let server decide
    }
  }

  private refreshPromise: Promise<boolean> | null = null;

  // Samtidiga 401:or ska dela EN förnyelse. Servern roterar refresh-token
  // atomiskt (DELETE + INSERT i samma transaktion), så parallella anrop med
  // samma cookie skulle ogiltigförklara varandra: den första lyckas, resten
  // får "Invalid refresh token" → falsk utloggning. Spärren nollställs alltid
  // (finally) så nästa 401, efter att förnyelsen är klar, gör ett nytt anrop.
  private tryRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<boolean> {
    try {
      // Refresh-token ligger i en HttpOnly-cookie (ej läsbar för JS).
      // credentials:'include' skickar cookien; servern roterar och sätter ny cookie.
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json() as { accessToken: string };
      this.setToken(data.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  // Proaktiv refresh: om access-token är utgången, uppdatera innan requesten
  // för att undvika en onödig 401 som browsern loggar till konsolen.
  private async getFreshToken(isRetry: boolean): Promise<string | null> {
    let token = this.getToken();
    if (token && !isRetry && this.isTokenExpired(token)) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        token = this.getToken();
      }
    }
    return token;
  }

  // Refresh-token saknas eller är utgången — tyst redirect, ingen toast.
  // Bevarar platsen via ?returnTo= (hård redirect, router-state överlever
  // inte) så Login kan navigera hit tillbaka efter ny inloggning — men bara
  // om vi inte redan står på /login (undviker en nästlad/loopande param).
  // Ingen sanering här: vi läser bara vår egen location. Saneringen sker vid
  // konsumtion i Login (sanitizeReturnTo).
  private sessionExpired(): never {
    this.clearToken();
    localStorage.removeItem('user');
    // String(...) skyddar mot minimala window.location-stubbar i andra
    // testfiler (bara { href }, utan pathname/search) — där skulle
    // `undefined + undefined` annars ge NaN (taladdition, inte
    // strängkonkatenering) istället för en tom sträng. En tom `here` (samma
    // degenererade stubbar, eller bara "/" i praktiken aldrig tom i en
    // riktig browser) behandlas som "okänd plats" — ingen returnTo-param.
    const here = String(window.location.pathname ?? '') + String(window.location.search ?? '');
    window.location.href = !here || here.startsWith('/login')
      ? '/login'
      : `/login?returnTo=${encodeURIComponent(here)}`;
    throw new Error('Session expired');
  }

  async request<T>(endpoint: string, options: ApiOptions = {}, isRetry = false): Promise<T> {
    const { method = 'GET', body, headers = {}, signal } = options;

    const token = await this.getFreshToken(isRetry);

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
      signal,
    });

    if (!response.ok) {
      // Handle 401: attempt silent token refresh BEFORE consuming body
      if (response.status === 401 && !isRetry) {
        if (await this.tryRefresh()) {
          return this.request<T>(endpoint, options, true);
        }
        this.sessionExpired();
      }

      const error = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));

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

  // Hämtar en binär resurs (t.ex. bilagor) med samma refresh-retry och
  // session-expiry-hantering som request() — men utan JSON-parsning/Content-Type.
  async requestBlob(endpoint: string, options: { signal?: AbortSignal } = {}, isRetry = false): Promise<Blob> {
    const { signal } = options;

    const token = await this.getFreshToken(isRetry);

    const requestHeaders: Record<string, string> = {};
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: requestHeaders,
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 && !isRetry) {
        if (await this.tryRefresh()) {
          return this.requestBlob(endpoint, options, true);
        }
        this.sessionExpired();
      }

      const error = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
      throw new Error(error.error || error.message || 'Request failed');
    }

    return response.blob();
  }

  async uploadFile<T>(endpoint: string, file: File, isRetry = false): Promise<T> {
    return this.postFile<T>(endpoint, file, 'file', 'Upload failed', isRetry);
  }

  // Delad hjälpare för alla FormData-uppladdningar (fil eller bild). Samma
  // 401-refresh-retry och 403-CSRF-retry som request()/uploadFile — bygger
  // en ny FormData per försök så en retry inte återanvänder en redan
  // konsumerad instans.
  private async postFile<T>(
    endpoint: string,
    file: File,
    fieldName: string,
    fallbackMessage: string,
    isRetry = false,
  ): Promise<T> {
    const token = await this.getFreshToken(isRetry);
    const formData = new FormData();
    formData.append(fieldName, file);

    // Ingen Content-Type — browsern måste sätta multipart-boundary själv.
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
      if (response.status === 401 && !isRetry) {
        if (await this.tryRefresh()) {
          return this.postFile<T>(endpoint, file, fieldName, fallbackMessage, true);
        }
        this.sessionExpired();
      }

      const error = await response.json().catch(() => ({ error: fallbackMessage }));

      if (response.status === 403 && !isRetry && this.isCsrfError(error)) {
        this.csrfToken = null;
        return this.postFile<T>(endpoint, file, fieldName, fallbackMessage, true);
      }

      throw new Error(error.error || error.message || fallbackMessage);
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
    // Refresh-token kommer som HttpOnly-cookie (request() skickar credentials:'include').
    return data;
  }

  /**
   * Publik status för SSO-knappen på login-sidan. Samma resonemang som
   * getBranding() nedan: anropas från den OINLOGGADE login-sidan och får aldrig
   * gå via request(), vars 401-gren triggar refresh-kedjan + sessionExpired().
   * Timeout krävs eftersom ett hängande anrop annars döljer SSO-knappen tyst
   * och permanent — användaren tror då att SSO är avstängt.
   */
  async getOidcStatus(): Promise<{ enabled: boolean; label: string | null }> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/oidc/enabled`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { enabled: false, label: null };
      const data = await response.json();
      // Labeln trimmas och tomma/whitespace-strängar normaliseras till null:
      // den blir SSO-länkens enda textinnehåll, och "" eller "   " ger då en
      // länk helt utan tillgängligt namn (skärmläsaren läser bara upp "länk").
      // null gör att Login faller tillbaka på standardtexten.
      const label = typeof data?.label === 'string' ? data.label.trim() : '';
      return {
        enabled: data?.enabled === true,
        label: label === '' ? null : label,
      };
    } catch {
      return { enabled: false, label: null };
    }
  }

  // Branding — publik logotyp-URL. Anropas från oinloggade sidor (Login,
  // PublicTicketForm) och får ALDRIG trigga refresh-kedjan eller
  // sessionExpired()-redirecten som request() gör vid 401: en oautentiserad
  // besökare har typiskt ingen/en utgången token liggande i localStorage, och
  // ett fel här ska tyst degradera till standardlogotypen — inte kasta ut
  // användaren från inloggningssidan. Därför en egen minimal fetch utan
  // Authorization-header, CSRF eller retry-logik, istället för att gå via
  // request().
  async getBranding(): Promise<{ logoUrl: string | null }> {
    try {
      const response = await fetch(`${this.baseUrl}/public/branding`);
      if (!response.ok) return { logoUrl: null };
      const data = await response.json();
      const logoUrl = typeof data?.logoUrl === 'string' ? data.logoUrl : null;
      return { logoUrl: this.resolveBrandingLogoUrl(logoUrl) };
    } catch {
      return { logoUrl: null };
    }
  }

  // Backendens svar är alltid en app-relativ sökväg ("/api/public/branding/logo?v=...")
  // — ett publikt API-kontrakt som inte ska ändras här. Men API_BASE_URL kan vara
  // absolut (VITE_API_URL satt till en annan origin, t.ex. dev-miljön där frontend
  // och backend körs på olika portar/hostar, se Dockerfile.client). En relativ
  // logoUrl skulle då resolva mot FRONTENDENS origin i <img src>, inte backendens
  // — trasig bild. Byt ut prefixet "/api/" mot den faktiska basen; rör INGET
  // om strängen mot förmodan inte har det exakta prefixet (t.ex. redan absolut,
  // eller ett framtida kontraktsbyte) — bättre att låta en oväntad form passera
  // orörd än att gissa fel.
  private resolveBrandingLogoUrl(logoUrl: string | null): string | null {
    if (!logoUrl || !logoUrl.startsWith('/api/')) return logoUrl;
    return `${this.baseUrl}${logoUrl.slice('/api'.length)}`;
  }

  // Admin: ladda upp egen logotyp. Går via den delade postFile-vägen så den
  // ärver CSRF-header + 401-refresh-retry precis som övriga uppladdningar.
  async uploadBrandingLogo(file: File): Promise<{ logoUrl: string }> {
    return this.postFile<{ logoUrl: string }>('/settings/branding/logo', file, 'file', 'Uppladdning misslyckades');
  }

  // Admin: återställ till standardlogotypen.
  async deleteBrandingLogo(): Promise<void> {
    return this.request<void>('/settings/branding/logo', { method: 'DELETE' });
  }

  /** Absolut URL till SSO-inloggningen (vanlig länk-navigation, ingen fetch). */
  oidcLoginUrl(): string {
    return `${this.baseUrl}/auth/oidc/login`;
  }

  /** Hämta ny access-token från refresh-cookien (används efter SSO-callback). */
  async refreshSession(): Promise<boolean> {
    return this.tryRefresh();
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

  async forgotPassword(email: string) {
    return this.request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  }

  async resetPassword(token: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    });
  }

  // SLA policies
  async getSLAPolicies(companyId?: string) {
    const query = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '?company_id=default';
    return this.request<SLAPolicyRow[]>(`/sla${query}`);
  }

  async upsertSLAPolicies(
    companyId: string | null,
    policies: Array<{ priority: string; response_time_minutes: number; resolution_time_minutes: number }>
  ) {
    return this.request<SLAPolicyRow[]>('/sla', {
      method: 'PUT',
      body: { company_id: companyId, policies },
    });
  }

  async logout() {
    try {
      // Refresh-token-cookien skickas automatiskt (credentials:'include');
      // servern revokerar token och rensar cookien.
      await this.request('/auth/logout', { method: 'POST' });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Logout error:', error);
    } finally {
      this.clearToken();
    }
  }

  // Tickets
  async getTickets(queryString?: string) {
    return this.request<TicketRow[] | PaginatedResponse<TicketRow>>(`/tickets${queryString || ''}`);
  }

  // Antal ej-stängda ärenden per requester (serverside-aggregat för UserList).
  async getRequesterOpenCounts() {
    return this.request<Record<string, number>>('/tickets/requester-open-counts');
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
    let filename = `arenden-export-${new Date().toISOString().split('T')[0]}.xlsx`;
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

  async exportArchive(queryString?: string): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/tickets/export-archive${queryString || ''}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to export archive');
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `arkiv-export-${new Date().toISOString().split('T')[0]}.xlsx`;
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
    return this.postFile<any>(`/tickets/import/preview`, file, 'file', 'Preview failed');
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

  async bulkUpdateTickets(ids: string[], updates: { status?: string; priority?: string; category_id?: string | null; assigned_to?: string | null }) {
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

  async generateAiDraft(ticketId: string) {
    return this.request<{ draft: string; kbArticlesUsed: number; kbTitles: string[]; attachmentsUsed?: string[] }>(
      `/tickets/${ticketId}/ai-draft`,
      { method: 'POST' }
    );
  }

  async getAiSummary(ticketId: string, force = false) {
    return this.request<{
      summary: { status: string; blockers: string; lastAction: string } | null;
      cached?: boolean;
      ageMinutes?: number;
      reason?: string;
    }>(`/tickets/${ticketId}/ai-summary${force ? '?force=1' : ''}`);
  }

  async dismissAiCategorySuggestion(ticketId: string) {
    return this.request<TicketRow>(`/tickets/${ticketId}`, {
      method: 'PUT',
      body: { ai_suggested_category_id: null },
    });
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
    placeholder?: string | null;
    default_value?: string | null;
    required?: boolean | number; // skickas som 0/1 (SQLite-flagga); backend coercar truthiness
    options?: string[];
    position?: number;
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
    placeholder: string | null;
    default_value: string | null;
    required: boolean | number; // skickas som 0/1 (SQLite-flagga)
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
    let filename = 'kontakter-export.xlsx';
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
    return this.postFile<any>(`/contacts/import/preview`, file, 'file', 'Preview failed');
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

  async getChecklistProgress(ticketIds: string[], signal?: AbortSignal) {
    return this.request<Record<string, { total: number; completed: number }>>('/checklists/progress', {
      method: 'POST',
      body: { ticketIds },
      signal,
    });
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
    return this.request<{ share_token: string | null; expires_at: string | null }>(`/shares/ticket/${ticketId}`);
  }

  async createShareToken(ticketId: string, expiresInDays?: number) {
    return this.request<{ share_token: string; expires_at: string }>(`/shares/ticket/${ticketId}`, {
      method: 'POST',
      body: expiresInDays !== undefined ? { expiresInDays } : undefined,
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

  /**
   * Kopplar loss ett konto från dess SSO-identitet (nollar oidc_sub/oidc_iss).
   * Behövs när samma e-postadress byter ägare (offboard→onboard) — annars pekar
   * länken på den gamla identiteten och den nya medarbetaren nekas för alltid.
   */
  async clearSystemUserSsoLink(userId: string) {
    return this.request<{ message: string }>(`/users/${userId}`, {
      method: 'PATCH',
      body: { clearSsoLink: true },
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
    return this.postFile<{ url: string }>('/kb/upload-image', file, 'image', 'Upload failed');
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

  async requestAiSuggestion(problemText: string, userEmail?: string) {
    return this.request<{
      deflectionId: string;
      hasSolution: boolean;
      solution: string | null;
      confidence: number;
      kbReferences: { id: string; title: string }[];
    }>('/public/ai-suggest', {
      method: 'POST',
      body: { problemText, userEmail },
    });
  }

  async reportDeflectionOutcome(deflectionId: string, outcome: 'solved' | 'rejected', ticketId?: string) {
    return this.request<{ ok: boolean }>(`/public/ai-suggest/${deflectionId}`, {
      method: 'PATCH',
      body: { outcome, ticketId },
    });
  }

  // Time Entries
  async getTimeEntries(ticketId: string) {
    return this.request<{ entries: TimeEntryRow[]; total_minutes: number }>(
      `/time-entries/${ticketId}`
    );
  }

  async createTimeEntry(
    ticketId: string,
    payload: { duration_minutes: number; note?: string; billable?: boolean; work_date?: string | null }
  ) {
    return this.request<TimeEntryRow>(`/time-entries/${ticketId}`, {
      method: 'POST',
      body: payload,
    });
  }

  async updateTimeEntry(
    ticketId: string,
    entryId: string,
    payload: { duration_minutes?: number; note?: string | null; billable?: boolean; work_date?: string | null }
  ) {
    return this.request<TimeEntryRow>(`/time-entries/${ticketId}/${entryId}`, {
      method: 'PUT',
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

  async getRequesterAnalytics(year: string, month: string) {
    const params = new URLSearchParams();
    if (year && year !== 'all') params.append('year', year);
    if (month && month !== 'all') params.append('month', month);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<RequesterAnalyticsRow[]>(`/reports/requester-analytics${qs}`);
  }

  async getStatusFlow() {
    return this.request<StatusFlowRow[]>('/reports/status-flow');
  }

  async getTagAnalytics() {
    return this.request<TagAnalyticsRow[]>('/reports/tag-analytics');
  }

  // KPI drill-down rows for the Reports detail modals. Server-aggregated +
  // LIMIT-capped (replaces the old client-side ?limit=1000 fetch). For 'aging'
  // the server ignores year/month, so only forward them for 'total'.
  async getKpiTickets(scope: 'total' | 'aging', year?: string, month?: string) {
    const params = new URLSearchParams({ scope });
    if (scope === 'total') {
      if (year && year !== 'all') params.append('year', year);
      if (month && month !== 'all') params.append('month', month);
    }
    return this.request<TicketRow[]>(`/reports/kpi-tickets?${params.toString()}`);
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

  async createInvoice(data: { company_id: string; period_start: string; period_end: string; lines: any[]; total_hours: number; total_amount: number; currency: string; vat_rate?: number }) {
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

  // Backup
  async downloadBackup(): Promise<Blob> {
    const token = this.getToken();

    // Proactive refresh before fetching large binary — same pattern as exportTickets
    if (token && this.isTokenExpired(token)) {
      await this.tryRefresh();
    }

    const headers: Record<string, string> = {};
    const currentToken = this.getToken();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const response = await fetch(`${this.baseUrl}/backup`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (response.status === 401) {
      // Attempt one silent refresh, then retry
      if (await this.tryRefresh()) {
        const retryToken = this.getToken();
        const retryHeaders: Record<string, string> = {};
        if (retryToken) retryHeaders['Authorization'] = `Bearer ${retryToken}`;
        const retryResponse = await fetch(`${this.baseUrl}/backup`, {
          method: 'GET',
          headers: retryHeaders,
          credentials: 'include',
        });
        if (!retryResponse.ok) throw new Error('Backup failed');
        return retryResponse.blob();
      }
      this.clearToken();
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    if (!response.ok) throw new Error('Backup failed');
    return response.blob();
  }

  // Backup schedule
  async getBackupConfig() {
    return this.request<BackupConfig>('/backup/config');
  }

  async updateBackupConfig(body: { enabled: boolean; time: string; retentionDays: number }) {
    return this.request<BackupConfig>('/backup/config', {
      method: 'PUT',
      body,
    });
  }

  async getSettings() {
    return this.request<{ twoWayEmailEnabled: boolean }>('/settings');
  }

  async updateTwoWayEmail(enabled: boolean) {
    return this.request<{ twoWayEmailEnabled: boolean }>('/settings/two-way-email', {
      method: 'PUT',
      body: { enabled },
    });
  }

  async runBackupNow() {
    return this.request<{ status: string; lastRunAt: string | null; lastSizeBytes: number | null }>('/backup/run-now', {
      method: 'POST',
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
  ai_suggested_category_id?: string | null;
  ai_suggested_confidence?: number | null;
  // SLA-fält (kolumner på tickets-tabellen, migration i migrations.ts) — returneras rått (snake_case)
  sla_response_deadline?: string | null;
  sla_resolution_deadline?: string | null;
  sla_paused_at?: string | null;
  sla_paused_duration?: number | null;
  sla_response_met?: number | null;
  sla_resolution_met?: number | null;
  // Sätts på create/update-svaret när bakgrundsåtgärder (t.ex. mailutskick) gav icke-fatala varningar
  warnings?: string[];
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
  sla_disabled: number;
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
  /** true när kontot är länkat till en SSO-identitet. Själva sub/issuer exponeras aldrig. */
  ssoLinked?: boolean;
}

export interface SLAPolicyRow {
  id: string;
  company_id: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  response_time_minutes: number;
  resolution_time_minutes: number;
  created_at: string;
  updated_at: string;
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
  share_expires_at?: string;
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
  template_type: string;
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

export interface BackupConfig {
  enabled: boolean;
  time: string; // "HH:MM"
  retentionDays: number;
  lastRunAt: string | null;
  lastStatus: 'success' | 'failed' | null;
  lastSizeBytes: number | null;
  nextRunAt: string | null;
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
  invoice_number: number | null;
  period_start: string;
  period_end: string;
  status: string;
  total_hours: number;
  total_amount: number; // NETTO (exkl moms)
  vat_rate: number;     // t.ex. 0.25
  vat_amount: number;
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
  total_amount: number;   // NETTO (exkl moms)
  vat_rate: number;       // t.ex. 0.25
  vat_amount: number;
  total_incl_vat: number;
}

export interface RequesterAnalyticsRow {
  userId: string;
  name: string;
  totalTickets: number;
  statusBreakdown: {
    open: number;
    'in-progress': number;
    waiting: number;
    resolved: number;
    closed: number;
  };
  priorityBreakdown: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  completionRate: number;
  avgResolutionTime: number;
  agingTickets: number;
  lastTicketDate: string;
  ticketVelocity: number;
  topCategories: Array<{ category: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
}

// One row per month (YYYY-MM) over the trailing 12-month window. Counts are
// per-current-status of tickets created in that month — server-side aggregation
// over the full dataset (replaces the old client-side StatusFlowChart compute).
export interface StatusFlowRow {
  month: string; // YYYY-MM
  open: number;
  'in-progress': number;
  waiting: number;
  resolved: number;
  closed: number;
}

// One row per tag attached to at least one ticket. count = number of tickets
// carrying the tag, aggregated server-side over the full dataset.
export interface TagAnalyticsRow {
  id: string;
  name: string;
  color: string;
  count: number;
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL);
