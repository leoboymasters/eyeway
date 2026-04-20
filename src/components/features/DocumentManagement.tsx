import React, { useMemo, useState } from 'react';
import { CardTitle } from '@/components/ui/card';
import { dashboardAnalyticsHeaderClassName } from '@/components/ui/dashboard-card';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Search } from 'lucide-react';
import { Pothole } from '@/types';
import { format } from 'date-fns';

interface DocumentManagementProps {
  potholes: Pothole[];
  onDeletePothole: (id: string) => Promise<void>;
  /** Highlights the row when this pothole is open in the map sidebar. */
  selectedPotholeId?: string | null;
  className?: string;
}

export const DocumentManagement: React.FC<DocumentManagementProps> = ({
  potholes,
  onDeletePothole,
  selectedPotholeId = null,
  className = '',
}) => {
  const [query, setQuery] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const sorted = useMemo(() => {
    return [...potholes].sort(
      (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime(),
    );
  }, [potholes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => {
      const id = p.id.toLowerCase();
      const road = (p.location.roadId ?? p.location.address ?? '').toLowerCase();
      return id.includes(q) || road.includes(q);
    });
  }, [sorted, query]);

  const pendingPothole = pendingId ? potholes.find((p) => p.id === pendingId) : null;

  const handleConfirmDelete = async () => {
    if (!pendingId) return;
    setDeleteBusy(true);
    try {
      await onDeletePothole(pendingId);
      setDeleteOpen(false);
      setPendingId(null);
    } catch {
      /* parent toast */
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      <div className={cn(dashboardAnalyticsHeaderClassName, 'flex-shrink-0')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl font-bold text-gray-900">All potholes</CardTitle>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by ID or road…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Filter potholes"
            />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length} of {potholes.length} shown. Deletes sync to Supabase.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-white">
            <TableRow>
              <TableHead className="min-w-[7rem]">ID</TableHead>
              <TableHead className="hidden sm:table-cell">Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Road / location</TableHead>
              <TableHead className="hidden lg:table-cell">Reported</TableHead>
              <TableHead className="w-[1%] whitespace-nowrap text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn(selectedPotholeId === p.id && 'bg-pothole-50/80')}
                >
                  <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                  <TableCell className="hidden capitalize sm:table-cell">{p.severity}</TableCell>
                  <TableCell className="capitalize">{p.status.replace('-', ' ')}</TableCell>
                  <TableCell className="hidden max-w-[220px] truncate text-sm text-muted-foreground md:table-cell">
                    {p.location.address || p.location.roadId || '—'}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {format(new Date(p.reportDate), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      onClick={() => {
                        setPendingId(p.id);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 sm:mr-1" aria-hidden />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  {potholes.length === 0 ? 'No potholes loaded yet.' : 'No potholes match your search.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleteBusy) return;
          setDeleteOpen(open);
          if (!open) setPendingId(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => deleteBusy && e.preventDefault()}
          onEscapeKeyDown={(e) => deleteBusy && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Delete this pothole?</DialogTitle>
            <DialogDescription>
              {pendingPothole
                ? `This will remove pothole #${pendingPothole.id.slice(0, 8)} from the database. Linked documents and processing tasks are unlinked, not deleted.`
                : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DocumentManagement;
