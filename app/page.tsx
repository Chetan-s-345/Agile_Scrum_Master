import { HeroSection } from "@/components/herosection";
import { HomeNavbar } from "@/components/home-navbar";
import SmoothScrollSections from "@/components/smooth-scroll";

export default function Home() {
  return (
    <div className="bg-white dark:bg-black">
      <HomeNavbar />
      <HeroSection />
      <SmoothScrollSections />
    </div>
  );
}
