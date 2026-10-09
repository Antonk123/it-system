import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MIN_LENGTH = 12;
const MAX_BYTES = 72;
const PASSPHRASE_LENGTH = 16;
const MIN_CHARACTER_CLASSES = 3;

const CURRENT_PASSWORD_INCORRECT = 'Current password is incorrect';

// Speglar serverns lösenordspolicy (server/src/lib/passwordPolicy.ts) så att
// felet visas direkt. Servern är fortfarande den som avgör.
const validateNewPassword = (password: string): string | null => {
  const length = [...password].length;
  if (length < MIN_LENGTH) {
    return `Lösenordet måste vara minst ${MIN_LENGTH} tecken långt`;
  }
  if (new TextEncoder().encode(password).length > MAX_BYTES) {
    return `Lösenordet får vara högst ${MAX_BYTES} byte långt`;
  }
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{Ll}\p{Lu}\p{Nd}]/u].filter((re) => re.test(password)).length;
  if (length < PASSPHRASE_LENGTH && classes < MIN_CHARACTER_CLASSES) {
    return `Lösenordet måste innehålla minst tre av: liten bokstav, stor bokstav, siffra, specialtecken — eller vara minst ${PASSPHRASE_LENGTH} tecken långt`;
  }
  return null;
};

interface ChangePasswordFormProps {
  onSuccess?: () => void;
}

export const ChangePasswordForm = ({ onSuccess }: ChangePasswordFormProps) => {
  const { refreshUser } = useAuth();
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const policyError = validateNewPassword(newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Lösenorden matchar inte');
      return;
    }

    setIsSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await refreshUser();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Lösenordet har ändrats');
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message === CURRENT_PASSWORD_INCORRECT
        ? 'Nuvarande lösenord är fel'
        : message || 'Lösenordet kunde inte ändras — försök igen');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${id}-current`}>Nuvarande lösenord</Label>
        <Input
          id={`${id}-current`}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-new`}>Nytt lösenord</Label>
        <Input
          id={`${id}-new`}
          type="password"
          autoComplete="new-password"
          aria-describedby={`${id}-hint`}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Minst {MIN_LENGTH} tecken med tre av: liten bokstav, stor bokstav, siffra, specialtecken — eller minst {PASSPHRASE_LENGTH} tecken.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-confirm`}>Upprepa nytt lösenord</Label>
        <Input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      <Button type="submit" disabled={isSaving}>
        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {isSaving ? 'Sparar...' : 'Byt lösenord'}
      </Button>
    </form>
  );
};
