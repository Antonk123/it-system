import { useDeflectionStats } from '@/hooks/useDeflectionStats';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function DeflectionReportCard() {
  const { data, isLoading, isError, refetch } = useDeflectionStats();

  return (
    <Card aria-busy={isLoading}>
      <CardHeader>
        <CardTitle>Självservice med AI</CardTitle>
        <CardDescription>Senaste 30 dagarna, oberoende av rapportens datumfilter.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-8 w-64 max-w-full" /> : isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-destructive">Kunde inte hämta statistik för självservice.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Försök igen</Button>
          </div>
        ) : data && data.total > 0 ? (
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{data.solved} av {data.total}</strong> förslag markerades som lösta av beställaren ({data.deflectionRate} %).
          </p>
        ) : <p className="text-sm text-muted-foreground">Inga AI-förslag under de senaste 30 dagarna.</p>}
      </CardContent>
    </Card>
  );
}
