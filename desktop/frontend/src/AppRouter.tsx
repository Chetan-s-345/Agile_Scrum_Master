import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RootLayout from "@/app-pages/layout";
import DashboardLayout from "@/app-pages/(dashboard)/layout";
import BoardTabsLayout from "@/app-pages/(dashboard)/board/layout";

type PageModule = { default: ComponentType };

const allPageModules = import.meta.glob("./app-pages/**/page.tsx");

const pageModules = Object.fromEntries(
  Object.entries(allPageModules).filter(([modulePath]) => modulePath.includes("/(dashboard)/"))
);

function toRoutePath(modulePath: string): string {
  const raw = modulePath
    .replace("./app-pages", "")
    .replace(/\/page\.tsx$/, "")
    .replace(/\/\([^/]+\)/g, "")
    .replace(/\[([^\]]+)\]/g, ":$1");

  const normalized = raw.replace(/\/+/g, "/");
  return normalized || "/";
}

function LoadingFallback() {
  return <div className="p-6 text-sm text-[var(--text-secondary)]">Loading page...</div>;
}

function RouteDiscoveryFallback() {
  return (
    <div className="p-6">
      <div className="max-w-xl rounded-md border border-[#5a1f1f] bg-[#2a1616] px-4 py-3 text-sm text-[#f3b6b6]">
        Unable to discover dashboard routes. Reload the app and verify dashboard page files are present.
      </div>
    </div>
  );
}

export function AppRouter() {
  const pageEntries = useMemo(
    () =>
      Object.entries(pageModules)
        .map(([modulePath, loader]) => ({
          modulePath,
          loader,
          routePath: toRoutePath(modulePath),
        }))
        .sort((a, b) => {
          const aDynamic = (a.routePath.match(/:/g) || []).length;
          const bDynamic = (b.routePath.match(/:/g) || []).length;
          if (aDynamic !== bDynamic) return aDynamic - bDynamic;
          return b.routePath.length - a.routePath.length;
        }),
    []
  );

  const defaultRoutePath = useMemo(() => {
    if (!pageEntries.length) return null;
    const knownDefaults = ["/dashboard", "/board"];
    for (const path of knownDefaults) {
      if (pageEntries.some((entry) => entry.routePath === path)) return path;
    }
    return pageEntries[0]?.routePath || null;
  }, [pageEntries]);

  return (
    <RootLayout>
      <Routes>
        {pageEntries.map((entry) => {
          const Page = lazy(entry.loader as () => Promise<PageModule>);

          const isBoardNested = entry.modulePath.includes("/(dashboard)/board/");

          let element = (
            <Suspense fallback={<LoadingFallback />}>
              <Page />
            </Suspense>
          );

          if (isBoardNested) {
            element = <BoardTabsLayout>{element}</BoardTabsLayout>;
          }
          element = <DashboardLayout>{element}</DashboardLayout>;

          return <Route key={entry.modulePath} path={entry.routePath} element={element} />;
        })}

        {defaultRoutePath ? <Route path="/" element={<Navigate to={defaultRoutePath} replace />} /> : null}
        {defaultRoutePath ? <Route path="*" element={<Navigate to={defaultRoutePath} replace />} /> : null}
        {!defaultRoutePath ? <Route path="*" element={<RouteDiscoveryFallback />} /> : null}
      </Routes>
    </RootLayout>
  );
}
