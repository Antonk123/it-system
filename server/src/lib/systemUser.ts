// Systemanvändare som äger kommentarer som kommit in via e-post (ticket_comments.user_id
// har FK mot users). Raden skapas av migrationen 'create_system_user'. Filen är
// medvetet fri från databasimport: migrations.ts importerar konstanterna härifrån.
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
export const SYSTEM_USER_EMAIL = 'system@it-ticket.local';

export function getSystemUserId(): string {
  return SYSTEM_USER_ID;
}
