import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Browser confirm() is blocked by Navet's iframe sandbox. Use the existing
// accessible dialog so the same explicit choice works embedded and standalone.
export function useConfirmDiscard() {
  const [question, setQuestion] = useState<{ message: string; action: string } | null>(null);
  const answer = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback((message: string, action = 'Byt mall') => new Promise<boolean>(resolve => {
    answer.current?.(false);
    answer.current = resolve;
    setQuestion({ message, action });
  }), []);
  const finish = (confirmed: boolean) => {
    answer.current?.(confirmed);
    answer.current = null;
    setQuestion(null);
  };
  useEffect(() => () => { answer.current?.(false); }, []);
  const confirmationDialog = (
    <AlertDialog open={!!question} onOpenChange={open => { if (!open) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Du har ifyllt innehåll</AlertDialogTitle>
          <AlertDialogDescription>{question?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Behåll innehållet</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => finish(true)}>{question?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, confirmationDialog };
}
