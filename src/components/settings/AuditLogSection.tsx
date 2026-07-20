import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
  user_email: string | null;
  user_display_name: string | null;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

function actorLabel(entry: AuditLogEntry): string {
  return entry.user_display_name || entry.user_email || 'System';
}

export function AuditLogSection() {
  const [entityTypeInput, setEntityTypeInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [offset, setOffset] = useState(0);

  const entityType = useDebounce(entityTypeInput, 350);
  const action = useDebounce(actionInput, 350);

  useEffect(() => {
    setOffset(0);
  }, [entityType, action]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-log', entityType, action, offset],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (entityType.trim()) params.set('entity_type', entityType.trim());
      if (action.trim()) params.set('action', action.trim());
      return api.request<AuditLogResponse>(`/auth/audit-log?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.limit ?? PAGE_SIZE;
  const hasNext = offset + pageSize < total;
  const hasPrev = offset > 0;

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="audit-log-entity-type">Entitetstyp</Label>
          <Input
            id="audit-log-entity-type"
            placeholder="t.ex. user, invoice, session..."
            value={entityTypeInput}
            onChange={(e) => setEntityTypeInput(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="audit-log-action">Åtgärd</Label>
          <Input
            id="audit-log-action"
            placeholder="t.ex. user_delete, login_success..."
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="p-4 text-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Laddar granskningslogg...
        </div>
      ) : isError ? (
        <p className="p-4 text-center text-destructive">
          Kunde inte ladda granskningsloggen. Kontrollera att du är admin.
        </p>
      ) : entries.length === 0 ? (
        <div className="p-4 text-center text-muted-foreground border rounded-lg">
          Inga poster.
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">Granskningslogg över känsliga åtgärder</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Tidpunkt</TableHead>
                <TableHead>Användare</TableHead>
                <TableHead>Åtgärd</TableHead>
                <TableHead>Entitet</TableHead>
                <TableHead>Detaljer</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(entry.created_at, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{actorLabel(entry)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{entry.action}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entry.entity_type}
                    {entry.entity_id && <span className="text-muted-foreground"> #{entry.entity_id}</span>}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    {entry.details ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate cursor-default" tabIndex={0}>
                            {entry.details}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm break-words">
                          {entry.details}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{entry.ip_address || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Visar {offset + 1}–{Math.min(offset + pageSize, total)} av {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
              disabled={!hasPrev || isLoading}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Föregående
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => o + pageSize)}
              disabled={!hasNext || isLoading}
            >
              Nästa
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
