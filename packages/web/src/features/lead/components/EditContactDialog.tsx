import { zodResolver } from "@hookform/resolvers/zod";
import type { LeadDetailContact } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/hooks/usePermissions";
import {
  contactFormSchema,
  toUpdateContactInput,
  type ContactFormValues,
} from "./contact-schema";
import { useUpdateContact } from "./useUpdateContact";

interface EditContactDialogProps {
  leadId: string;
  contact: LeadDetailContact;
}

/**
 * Legacy's "Edit Primary Contact", ported (PAC-38).
 *
 * Gates itself on **`clients:write`**, not `leads:write` — a `Contact` is a CRM
 * record shared across the household, so `PATCH /contacts/:id` lives under the
 * `clients` module. PAC-38 added that permission to the Producer template; the
 * server still derives per-contact reach from the caller's own leads, so this
 * check is about showing the control, not about authorization.
 *
 * Self-gating and returning `null`, matching `QuoteRecapAction` /
 * `SoldDealAction`, so the card doesn't have to check first.
 */
export function EditContactDialog({ leadId, contact }: EditContactDialogProps) {
  const { canWrite } = usePermissions();
  const [open, setOpen] = useState(false);
  const mutation = useUpdateContact(leadId, contact.id);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      // The API already returns `YYYY-MM-DD`, which is exactly what
      // `<input type="date">` wants — no parsing on either side.
      dateOfBirth: contact.dateOfBirth ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    },
    mode: "onBlur",
  });

  // Re-seed when the dialog opens so a cancelled edit doesn't persist, and so
  // the form reflects any change made since this component mounted.
  useEffect(() => {
    if (!open) return;
    form.reset({
      firstName: contact.firstName,
      lastName: contact.lastName,
      dateOfBirth: contact.dateOfBirth ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
  }, [open, contact, form]);

  if (!canWrite(ModuleKey.Clients)) return null;

  const onSubmit = (values: ContactFormValues) => {
    mutation.mutate(toUpdateContactInput(values), {
      onSuccess: () => setOpen(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${contact.name}`}
        >
          <Pencil size={12} />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit primary contact</DialogTitle>
          <DialogDescription>
            Corrections here also update how this lead appears on the Leads
            list.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input className="bg-card border-border" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input className="bg-card border-border" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      className="bg-card border-border"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      className="bg-card border-border"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      className="bg-card border-border"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-muted-foreground">
              Leave a field blank to clear it.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
