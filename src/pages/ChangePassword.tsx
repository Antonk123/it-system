import { useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

const ChangePassword = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <KeyRound className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold leading-none tracking-tight">Byt lösenord</h1>
          <CardDescription>
            {user?.mustChangePassword
              ? 'Du måste välja ett nytt lösenord innan du kan fortsätta.'
              : 'Välj ett nytt lösenord för ditt konto.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordForm onSuccess={() => navigate('/', { replace: true })} />
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
            Logga ut
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ChangePassword;
