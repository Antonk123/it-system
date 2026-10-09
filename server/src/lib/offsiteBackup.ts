import { execFile } from 'child_process';
import { logger } from './logger.js';

// Ett hängande rclone/curl får aldrig blockera backup-pipelinen (och därmed
// shutdown) för evigt. SIGKILL eftersom sh -c annars kan lämna barnprocessen kvar.
const OFFSITE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Off-site backup stub.
 *
 * Reads OFFSITE_BACKUP_CMD from the environment (optional). If set, the
 * shell template is run via `sh -c` with `filePath` injected through the
 * `BACKUP_FILE` environment variable — never interpolated into the shell
 * string. This means the operator writes `{file}` in the template as a
 * placeholder, but at runtime it is replaced by the env-var reference
 * `"$BACKUP_FILE"` so the shell expands it safely without any risk of
 * path metacharacters being interpreted as shell syntax.
 *
 * Example OFFSITE_BACKUP_CMD value:
 *   rclone copy {file} remote:backups/
 *
 * If the variable is not set the function logs a notice and returns without
 * doing anything — the local backup cron continues unaffected.
 *
 * NOTE for ops: sätt OFFSITE_BACKUP_CMD i Portainer-stackens env (se docs/OPERATIONS.md
 * och .env.example), t.ex. `rclone copy {file} remote:itticket/`.
 *
 * Fynd backup-audit-7 + M13: håll en in-memory-räknare över KONSEKUTIVA misslyckade
 * offsite-uppladdningar — ökar vid fel, nollställs vid lyckad uppladdning (annars
 * skulle en enstaka historisk miss varna för evigt i admin-UI:t). Om
 * OFFSITE_BACKUP_REQUIRED === 'true' är en misslyckad uppladdning fatal — vi kastar
 * så att anroparen kan markera körningen. Annars icke-fatalt: logga och fortsätt.
 */
let offsiteFailureCount = 0;

/** Antal konsekutiva misslyckade offsite-uppladdningar (in-memory, ingen DB). */
export function getOffsiteFailureCount(): number {
  return offsiteFailureCount;
}

/**
 * Varnar vid uppstart i produktion när ingen off-site-backup är konfigurerad: då ligger
 * alla backuper på samma host/volym som databasen och går förlorade med den.
 */
export function warnIfOffsiteMissing(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.OFFSITE_BACKUP_CMD) {
    logger.warn('Ingen off-site-backup konfigurerad — backuper ligger på samma host som databasen. Sätt OFFSITE_BACKUP_CMD (se docs/OPERATIONS.md).');
  }
}

export async function uploadBackupOffsite(filePath: string): Promise<void> {
  const cmdTemplate = process.env.OFFSITE_BACKUP_CMD;

  if (!cmdTemplate) {
    logger.info('Off-site backup ej konfigurerad (sätt OFFSITE_BACKUP_CMD)');
    return;
  }

  // Replace {file} placeholder with the env-var reference "$BACKUP_FILE".
  // filePath is then passed via the child process environment — never
  // interpolated into the shell string — so path characters like spaces or
  // parentheses cannot affect shell parsing.
  const shellCmd = cmdTemplate.replace(/\{file\}/g, '"$BACKUP_FILE"');

  try {
    await new Promise<void>((resolve, reject) => {
      execFile('sh', ['-c', shellCmd], {
        env: { ...process.env, BACKUP_FILE: filePath },
        timeout: OFFSITE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        if (stdout) logger.info('Off-site backup stdout', { stdout: stdout.trim() });
        if (stderr) logger.warn('Off-site backup stderr', { stderr: stderr.trim() });
        resolve();
      });
    });
    if (offsiteFailureCount > 0) {
      logger.info('Off-site backup recovered after consecutive failures', { previousFailures: offsiteFailureCount });
    }
    offsiteFailureCount = 0;
    logger.info('Off-site backup completed', { file: filePath });
  } catch (err) {
    offsiteFailureCount += 1;
    const required = process.env.OFFSITE_BACKUP_REQUIRED === 'true';
    if (required) {
      // Fatal: operatören har markerat offsite som obligatorisk. Logga ERROR och kasta
      // så att anroparen behandlar hela backupen som misslyckad.
      logger.error('Off-site backup failed (REQUIRED — backupen markeras som misslyckad)', {
        file: filePath,
        error: String(err),
        failureCount: offsiteFailureCount,
      });
      throw err instanceof Error ? err : new Error(String(err));
    }
    // Non-fatal — log at ERROR and return so the local backup cron is never interrupted.
    logger.error('Off-site backup failed (non-fatal)', {
      file: filePath,
      error: String(err),
      failureCount: offsiteFailureCount,
    });
  }
}
