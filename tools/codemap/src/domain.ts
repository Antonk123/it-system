/**
 * Klassificerar en nod till en affärsdomän för gruppering i kartan.
 * Reglerna matchas i ordning (första träff vinner) på label + id i gemener.
 * Ordningen är medveten: mer specifika domäner (sla, tid, notiser) före bredare
 * (automation, användare) så att t.ex. slaScheduler hamnar i "sla", inte "automation".
 */
const DOMAIN_RULES: Array<[string, string[]]> = [
  ['fakturering', ['billing', 'invoice', 'faktur']],
  ['tid', ['time-entr', 'timeentr', 'timeentry', 'duration', 'billable']],
  ['sla', ['sla']],
  ['tickets', ['ticket']],
  ['notiser', ['push', 'notification', 'notif', 'reminder']],
  ['företag', ['compan', 'company']],
  ['kontakter', ['contact']],
  ['kunskapsbas', ['kb', 'knowledge', 'article', 'deflection']],
  ['auth', ['auth', 'login', 'logout', 'password', 'passwordpolicy', 'refreshtoken', 'jwt', 'csrf', 'forgotpassword', 'resetpassword']],
  ['användare', ['user', 'role', 'systemuser']],
  ['webhooks', ['webhook']],
  ['e-post', ['email', 'imap', 'smtp', 'inbound', 'mailer']],
  ['bilagor', ['attachment', 'upload']],
  ['kommentarer', ['comment']],
  ['checklistor', ['checklist']],
  ['mallar', ['template']],
  ['taggar', ['tag']],
  ['rapporter', ['report', 'dashboard', 'kpi', 'analytic', 'stat', 'activityfeed', 'overview']],
  ['återkommande', ['recurring']],
  ['backup', ['backup', 'offsite']],
  ['inställningar', ['setting', 'appearance', 'mode']],
  ['api-nycklar', ['apikey', 'api-key', 'apikeys']],
  ['länkar', ['ticketlink', '/links', 'link']],
  ['delning', ['share', 'shared']],
  ['kategorier', ['categor']],
  ['arkiv', ['archive']],
  ['ai', ['aihelper', 'claude']],
  ['automation', ['automation', 'autoclose', 'scheduler']],
  ['system', ['logger', 'auditlog', 'htmlsanitizer', 'sanitize', 'connection', 'migration', 'init', 'cleanup', 'secure', 'safejson', 'maptickets', 'mapticket', 'validation', 'textvalidation', 'date', 'avatar', 'constant', 'recentlyviewed', 'commandpalette', 'notfound', 'index', 'utils', 'html', 'contentmigration']],
];

export function classifyDomain(label: string, id = ''): string {
  const t = (label + ' ' + id).toLowerCase();
  for (const [domain, kws] of DOMAIN_RULES) {
    for (const kw of kws) if (t.includes(kw)) return domain;
  }
  return 'övrigt';
}
