import { HomeNavbar } from "@/components/home-navbar";

export const metadata = {
  title: "Solution - Agile Scrum Master",
  description: "Our comprehensive solution for agile project management",
};

export default function SolutionPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-12">
          <section className="space-y-4">
            <h1 className="text-5xl font-bold">Our Solution</h1>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              A complete platform for agile teams to manage, collaborate, and deliver faster
            </p>
          </section>

          <div className="space-y-8">
            <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h2 className="text-3xl font-bold">Why Choose Agile Scrum Master?</h2>
              <ul className="space-y-3 text-gray-600 dark:text-gray-400">
                <li className="flex gap-3">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Built by agile practitioners with 10+ years of experience</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Trusted by 500+ companies worldwide</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>99.9% uptime SLA guaranteed</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>24/7 customer support</span>
                </li>
              </ul>
            </section>

            <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
              <h2 className="text-3xl font-bold">How It Works</h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">1</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Create Your Team</h3>
                    <p className="text-gray-600 dark:text-gray-400">Set up your team members and assign roles</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">2</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Define Your Sprints</h3>
                    <p className="text-gray-600 dark:text-gray-400">Plan sprints and add user stories to your backlog</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">3</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Track Progress</h3>
                    <p className="text-gray-600 dark:text-gray-400">Monitor sprint progress and team velocity</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">4</div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Deliver Results</h3>
                    <p className="text-gray-600 dark:text-gray-400">Release features and celebrate team achievements</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
