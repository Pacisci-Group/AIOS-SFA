import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { createRole, type AgencyRole } from '@/lib/roles-api';

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new role so the page can select it straight away. */
  onCreated: (role: AgencyRole) => void;
}

/**
 * Data scope is chosen here and nowhere else in the flow, so the copy has to
 * carry the whole idea. It is the single most consequential field on a role —
 * it decides which *records* the holder sees, independently of which pages.
 */
const SCOPES = [
  {
    value: 'own',
    label: 'Own records only',
    hint: 'Sees only what they are assigned. The safe default.',
  },
  {
    value: 'branch',
    label: 'Their branch',
    hint: 'Sees everything in the branch they belong to.',
  },
  {
    value: 'agency',
    label: 'The whole agency',
    hint: 'Sees every record in the agency, in every branch.',
  },
];

/**
 * Create a custom role.
 *
 * Deliberately minimal: name, description, scope. Permissions are set
 * afterwards on the matrix the page already has — asking for both in one dialog
 * would mean a 13-page grid inside a modal, and a new role granting nothing
 * until it is configured is the safe intermediate state.
 *
 * `isSystemTemplate` and `grantsAllEnabledModules` are not offered because the
 * API refuses them: the first would make the role undeletable, the second would
 * mint a second all-access role outside the owner-protection rules.
 */
export function CreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateRoleDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataScope, setDataScope] = useState('own');

  const create = useMutation({
    mutationFn: () =>
      createRole({
        name: name.trim(),
        description: description.trim() || undefined,
        dataScope,
      }),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(`“${role.name}” created`, {
        description: 'It grants nothing yet — set its access below.',
      });
      setName('');
      setDescription('');
      setDataScope('own');
      onCreated(role);
      onOpenChange(false);
    },
    onError: (error) => {
      // 409 on a duplicate slug arrives with the offending name in it; show the
      // server's sentence rather than guessing at the cause.
      toast.error(
        error instanceof ApiError ? error.message : 'Could not create the role.',
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            A role is a named set of access that people can be assigned to.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Senior Producer"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for (optional)"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="role-scope">Which records they see</Label>
            <Select value={dataScope} onValueChange={setDataScope}>
              <SelectTrigger id="role-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((scope) => (
                  <SelectItem key={scope.value} value={scope.value}>
                    {scope.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {SCOPES.find((s) => s.value === dataScope)?.hint}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || name.trim().length < 2}
          >
            {create.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : null}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
