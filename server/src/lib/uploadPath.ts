import { resolve, sep } from 'node:path';

/**
 * Löser en uppladdad fils sökväg (DB:ns file_path) mot uppladdningskatalogen och
 * returnerar null om resultatet hamnar utanför den (t.ex. `../`-sekvenser i en
 * manipulerad rad). Anropare behandlar null som "filen finns inte".
 */
export function resolveUploadPath(uploadDir: string, filePath: string): string | null {
  const root = resolve(uploadDir);
  const full = resolve(root, filePath);
  return full.startsWith(root + sep) ? full : null;
}
