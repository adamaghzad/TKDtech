'use client';
import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  requireReason = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason?: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const canSubmit = !pending && (!requireReason || reason.trim().length >= 4);

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    try {
      await onConfirm(reason);
      onOpenChange(false);
      setReason('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div
          className="space-y-5"
          onKeyDown={(event) => {
            if (requireReason && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSubmit) {
              event.preventDefault();
              void submit();
            }
          }}
        >
          {requireReason && (
            <Field label="Audit reason" hint="Stored permanently with this correction. (Ctrl+Enter to submit)">
              <Textarea
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this change is necessary…"
              />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              autoFocus={!requireReason}
              variant={danger ? 'danger' : 'default'}
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
