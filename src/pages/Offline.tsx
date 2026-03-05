import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const Offline = () => {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <WifiOff className="h-16 w-16 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">Ingen internetanslutning</CardTitle>
          <CardDescription>
            Det verkar som att du är offline. Vissa funktioner kanske inte fungerar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Kontrollera din internetanslutning och försök igen.
          </p>
          <Button
            onClick={handleRetry}
            className="w-full"
            size="lg"
          >
            Försök igen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Offline;
