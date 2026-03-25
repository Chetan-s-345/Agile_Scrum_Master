import { HomeNavbar } from "@/components/home-navbar";
import { HomeFooter } from "@/components/home-footer";

export const metadata = {
  title: "Features - Agile Scrum Master",
  description: "Discover our powerful features built for agile teams",
};

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-12">
          <section className="space-y-4">
            <h1 className="text-5xl font-bold">Features</h1>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              Everything you need to manage agile projects efficiently
            </p>
          </section>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">Sprint Planning</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Plan your sprints efficiently with intuitive tools for creating and managing sprints, backlog items, and team capacity.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">Real-time Collaboration</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Work together seamlessly with real-time updates, comments, and team discussions on tasks and epics.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">Progress Tracking</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Monitor sprint progress with burndown charts, velocity metrics, and detailed reports for data-driven decisions.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">Team Management</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Manage your team members, roles, and permissions with ease. Track workload and optimize resource allocation.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">CI/CD Integration</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Integrate with your development tools and automate workflows for continuous integration and deployment.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h3 className="text-2xl font-semibold">Custom Workflows</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Create custom workflows tailored to your team&#39;s specific processes and requirements.
              </p>
            </div>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
