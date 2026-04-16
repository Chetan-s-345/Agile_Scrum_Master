import { ThemeInit } from "@/components/theme-init";
import { InitialVisitLoader } from "@/components/initial-visit-loader";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <InitialVisitLoader />
      <ThemeInit />
      {children}
    </>
  );
}
