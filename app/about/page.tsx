import { HomeNavbar } from "@/components/home-navbar";
import { HomeFooter } from "@/components/home-footer";

export const metadata = {
  title: "About - Agile Scrum Master",
  description: "Learn about Agile Scrum Master and our mission",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-12">
          <section className="space-y-4">
            <h1 className="text-5xl font-bold">About Agile Scrum Master</h1>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              Empowering agile teams to collaborate, innovate, and deliver excellence
            </p>
          </section>

          <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
            <h2 className="text-3xl font-bold">Our Mission</h2>
            <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed">
              We believe that great software is built by great teams working in harmony. Our mission is to provide tools and platforms 
              that enable agile teams to focus on what matters most: delivering value to their customers.
            </p>
          </section>

          <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
            <h2 className="text-3xl font-bold">Our Story</h2>
            <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed mb-4">
              Agile Scrum Master was founded in 2019 by a group of passionate developers and product managers who experienced 
              firsthand the challenges of managing complex projects across distributed teams.
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed">
              What started as a simple tool to track sprints has evolved into a comprehensive platform used by hundreds of companies 
              worldwide. Today, we&#39;re committed to continuously innovating and improving our platform to meet the evolving needs of 
              agile teams.
            </p>
          </section>

          <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
            <h2 className="text-3xl font-bold">Our Values</h2>
            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Simplicity</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  We believe in keeping things simple. No complex configurations, just straightforward tools that work.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Collaboration</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Great products come from great collaboration. We foster a culture of teamwork and mutual respect.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Innovation</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  We constantly push boundaries and explore new ways to help teams work better.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Customer Focus</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Your success is our success. We listen to and learn from every customer.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 p-8 border border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 transition">
            <h2 className="text-3xl font-bold">Get In Touch</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Have questions or feedback? We&#39;d love to hear from you!
            </p>
            <div className="space-y-2">
              <p><strong>Email:</strong> <a href="mailto:hello@agilescrumaster.com" className="text-blue-600 hover:underline">hello@agilescrumaster.com</a></p>
              <p><strong>Address:</strong> 123 Tech Street, San Francisco, CA 94105</p>
              <p><strong>Phone:</strong> <a href="tel:+14155551234" className="text-blue-600 hover:underline">+1 (415) 555-1234</a></p>
            </div>
          </section>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
