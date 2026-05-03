import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import RootLayout from "@/app-pages/layout";
import DashboardLayout from "@/app-pages/(dashboard)/layout";
import BoardTabsLayout from "@/app-pages/(dashboard)/board/layout";


type PageModule = { default: ComponentType };
type PageEntry = {
  modulePath: string;
  loader: unknown;
  routePath: string;
};

const allPageModules = import.meta.glob("./app-pages/**/page.tsx");
const pageModules = Object.fromEntries(
  Object.entries(allPageModules).filter(([modulePath]) => {
    const isDashboardRoute = modulePath.includes("/(dashboard)/");
    const isDashboardDocsRoute = modulePath.includes("/(dashboard)/pages/page.tsx");
    const isSignInRoute = modulePath.endsWith("/auth/sign-in/page.tsx");
    return (isDashboardRoute && !isDashboardDocsRoute) || isSignInRoute;
  })
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
        Unable to discover routes. Reload the app and verify page files are present.
      </div>
    </div>
  );
}

function toRelativeRoutePath(routePath: string): string {
  return routePath.replace(/^\//, "");
}

function renderPage(Page: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Page />
    </Suspense>
  );
}

export function AppRouter() {
  const [authState, setAuthState] = useState<"checking" | "guest" | "authed">("checking");

  const refreshAuth = useCallback(async (silent = false) => {
    if (typeof window === "undefined" || !window.desktopApi?.invoke) {
      setAuthState("authed");
      return;
    }

    if (!silent) {
      setAuthState("checking");
    }

    try {
      const result = await window.desktopApi.invoke<{ authenticated?: boolean }>("auth:checkSession");
      setAuthState(result?.authenticated ? "authed" : "guest");
    } catch {
      setAuthState("guest");
    }
  }, []);

  useEffect(() => {
    void refreshAuth();

    if (typeof window === "undefined") return;

    const onFocus = () => {
      void refreshAuth(true);
    };
    window.addEventListener("focus", onFocus);

    let dispose = null;
    if (window.desktopApi?.on) {
      dispose = window.desktopApi.on("auth:sessionUpdated", () => {
        void refreshAuth(true);
      });
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      if (typeof dispose === "function") dispose();
    };
  }, [refreshAuth]);

  useEffect(() => {
    if (authState !== "guest") return;

    const intervalId = window.setInterval(() => {
      void refreshAuth(true);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authState, refreshAuth]);

  const pageEntries = useMemo<PageEntry[]>(
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

  const dashboardEntries = useMemo(
    () => pageEntries.filter((entry) => entry.modulePath.includes("/(dashboard)/")),
    [pageEntries]
  );

  const boardEntries = useMemo(
    () => dashboardEntries.filter((entry) => entry.modulePath.includes("/(dashboard)/board/")),
    [dashboardEntries]
  );

  const nonBoardDashboardEntries = useMemo(
    () => dashboardEntries.filter((entry) => !entry.modulePath.includes("/(dashboard)/board/")),
    [dashboardEntries]
  );

  const signInEntry = useMemo(
    () => pageEntries.find((entry) => entry.routePath === "/auth/sign-in") || null,
    [pageEntries]
  );

  const publicEntries = useMemo(
    () => pageEntries.filter((entry) => !entry.modulePath.includes("/(dashboard)/") && entry.routePath !== "/auth/sign-in"),
    [pageEntries]
  );

  const authedDefaultRoutePath = useMemo(() => {
    if (!pageEntries.length) return null;
    const knownDefaults = ["/dashboard", "/board"];
    for (const path of knownDefaults) {
      if (pageEntries.some((entry) => entry.routePath === path)) return path;
    }
    return pageEntries.find((entry) => entry.modulePath.includes("/(dashboard)/"))?.routePath || pageEntries[0]?.routePath || null;
  }, [pageEntries]);

  const defaultRoutePath = authState === "guest" ? "/auth/sign-in" : authedDefaultRoutePath;

  const lazyPagesByModulePath = useMemo<Record<string, LazyExoticComponent<ComponentType>>>(
    () =>
      Object.fromEntries(
        pageEntries.map((entry) => [
          entry.modulePath,
          lazy(entry.loader as () => Promise<PageModule>),
        ])
      ),
    [pageEntries]
  );

  if (authState === "checking") {
    return (
      <RootLayout>
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-5 py-10 text-sm text-[var(--text-secondary)]">
          Checking session...
        </div>
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      <Routes>
        <Route path="/sprint_plan" element={<Navigate to="/sprint-plan" replace />} />

        {signInEntry ? (
          <Route
            path={signInEntry.routePath}
            element={
              authState === "authed" ? (
                <Navigate to={authedDefaultRoutePath || "/dashboard"} replace />
              ) : (
                renderPage(lazyPagesByModulePath[signInEntry.modulePath])
              )
            }
          />
        ) : null}

        {publicEntries.map((entry) => (
          <Route
            key={entry.modulePath}
            path={entry.routePath}
            element={renderPage(lazyPagesByModulePath[entry.modulePath])}
          />
        ))}

        <Route
          element={
            authState === "guest" ? (
              <Navigate to="/auth/sign-in" replace />
            ) : (
              <DashboardLayout>
                <Outlet />
              </DashboardLayout>
            )
          }
        >
          {nonBoardDashboardEntries.map((entry) => (
            <Route
              key={entry.modulePath}
              path={toRelativeRoutePath(entry.routePath)}
              element={renderPage(lazyPagesByModulePath[entry.modulePath])}
            />
          ))}

          {boardEntries.length ? (
            <Route
              element={
                <BoardTabsLayout>
                  <Outlet />
                </BoardTabsLayout>
              }
            >
              {boardEntries.map((entry) => (
                <Route
                  key={entry.modulePath}
                  path={toRelativeRoutePath(entry.routePath)}
                  element={renderPage(lazyPagesByModulePath[entry.modulePath])}
                />
              ))}
            </Route>
          ) : null}
        </Route>

        {defaultRoutePath ? <Route path="/" element={<Navigate to={defaultRoutePath} replace />} /> : null}
        {defaultRoutePath ? <Route path="*" element={<Navigate to={defaultRoutePath} replace />} /> : null}
        {!defaultRoutePath ? <Route path="*" element={<RouteDiscoveryFallback />} /> : null}
      </Routes>
    </RootLayout>
  );
}
