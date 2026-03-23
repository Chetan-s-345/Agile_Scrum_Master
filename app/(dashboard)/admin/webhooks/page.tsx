import { WebhookDLQPanel } from "@/components/WebhookDLQPanel";

export default function AdminWebhooksPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Admin Webhooks</h1>
        <p className="text-slate-600 dark:text-slate-300 mb-6">Manage dead-letter webhook events and retries.</p>
        <WebhookDLQPanel />
      </div>
    </div>
  );
}
