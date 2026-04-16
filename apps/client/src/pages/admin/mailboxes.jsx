import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";

const initialForm = {
  name: "",
  emailAddress: "",
  slug: "",
  description: "",
};

export default function AdminMailboxes() {
  const { fetchWithAuth } = useUser();
  const [mailboxes, setMailboxes] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadMailboxes = async () => {
    try {
      setLoading(true);
      const response = await fetchWithAuth("/v1/mailboxes", { method: "GET" });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Failed to fetch mailboxes");
      }

      setMailboxes(Array.isArray(data.mailboxes) ? data.mailboxes : []);
    } catch (error) {
      toast.error(error.message || "Failed to fetch mailboxes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMailboxes();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setSaving(true);
      const response = await fetchWithAuth("/v1/mailboxes", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          emailAddress: form.emailAddress.trim(),
          slug: form.slug.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Failed to save mailbox");
      }

      toast.success("Mailbox saved");
      setForm(initialForm);
      await loadMailboxes();
    } catch (error) {
      toast.error(error.message || "Failed to save mailbox");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mailboxes</h1>
        <p className="text-sm text-muted-foreground">
          Create shared inboxes that threads can be assigned to.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-lg font-medium">Create Mailbox</h2>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Name</span>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Support Inbox"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Email Address</span>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              type="email"
              value={form.emailAddress}
              onChange={(event) => setForm((current) => ({ ...current, emailAddress: event.target.value }))}
              placeholder="support@example.com"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Slug</span>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              placeholder="support"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <textarea
              className="min-h-24 w-full rounded-md border px-3 py-2 text-sm"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Shared mailbox for customer communication"
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : "Create Mailbox"}
          </button>
        </form>

        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-lg font-medium">Existing Mailboxes</h2>
          </div>

          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading mailboxes...</div>
          ) : mailboxes.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No mailboxes created yet.</div>
          ) : (
            <div className="divide-y">
              {mailboxes.map((mailbox) => (
                <div key={mailbox._id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{mailbox.name}</div>
                      <div className="text-sm text-muted-foreground">{mailbox.emailAddress}</div>
                    </div>
                    <span className="rounded-full border px-2 py-1 text-xs">
                      {mailbox.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground">
                    Slug: {mailbox.slug || "-"} | Shared: {mailbox.isShared ? "Yes" : "No"}
                  </div>
                  {mailbox.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">{mailbox.description}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
