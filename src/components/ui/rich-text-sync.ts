/**
 * Decide whether an incoming controlled `value` should be pushed into the
 * TipTap editor via setContent().
 *
 * The editor is a controlled component: the parent owns `value`, the editor
 * emits changes through onChange. The hard part is telling apart two kinds of
 * `value` change on the same prop:
 *
 *   - an ECHO of what the editor itself just emitted (parent stored our onChange
 *     output and handed it straight back). Re-applying it would move the caret
 *     to the end and drop the user's latest keystroke.
 *   - a genuinely EXTERNAL change (clearing the field after submit, loading an
 *     existing ticket's description, a programmatic reset). This MUST be applied
 *     or the editor drifts out of sync with its own value.
 *
 * We distinguish them by tracking the last HTML the editor emitted: if `value`
 * equals that, it's an echo and we leave the editor alone. Otherwise, if it
 * also differs from the editor's current HTML, it's external and we apply it.
 *
 * This replaces an earlier `isLocalChange` ref that was reset inside a render
 * effect — a design that got STUCK in the "local" state whenever an onUpdate
 * emitted HTML identical to the current value (React bails out of the re-render,
 * so the resetting effect never runs), which then swallowed the next external
 * change. Concretely: after posting a comment, `setContent('')` was skipped and
 * the just-sent text stayed in the box.
 */
export function shouldApplyExternalValue(
  value: string,
  editorHTML: string,
  lastEmitted: string,
  isInserting: boolean,
): boolean {
  // Echo of our own emission — don't fight the caret.
  if (value === lastEmitted) return false;
  // A media insert is mid-flight; don't clobber the transient editor state.
  if (isInserting) return false;
  // Already in sync — nothing to do (also avoids a needless caret reset).
  if (value === editorHTML) return false;
  return true;
}
