import { HeroSection } from "@/components/herosection";
import { HomeSections } from "@/components/home-sections";
import { HomeNavbar } from "@/components/home-navbar";

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-black dark:text-white">
      <HomeNavbar />
      <HeroSection />
      <HomeSections />
    </div>
  );
}
