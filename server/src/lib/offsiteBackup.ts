import { execFile } from 'child_process';
import { logger } from './logger.js';

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
 * NOTE for ops: add the following line to your .env (see .env.example):
 *   # OFFSITE_BACKUP_CMD=rclone copy {file} remote:itticket/
 */
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
    logger.info('Off-site backup completed', { file: filePath });
  } catch (err) {
    // Non-fatal — log and return so the local backup cron is never interrupted.
    logger.error('Off-site backup failed (non-fatal)', { file: filePath, error: String(err) });
  }
}
