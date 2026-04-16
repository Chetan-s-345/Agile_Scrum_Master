import { useMemo } from "react";
import {
  useLocation,
  useNavigate,
  useParams as useReactRouterParams,
} from "react-router-dom";

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("#") ? path.slice(1) || "/" : path;
}

export function useRouter() {
  const navigate = useNavigate();

  return {
    push: (path: string, _options?: Record<string, unknown>) => navigate(normalizePath(path)),
    replace: (path: string, _options?: Record<string, unknown>) => navigate(normalizePath(path), { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: async () => {},
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const search = useLocation().search;
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string | undefined>>() {
  return useReactRouterParams() as T;
}

export function redirect(path: string): never {
  const normalized = normalizePath(path);
  window.location.hash = `#${normalized}`;
  return undefined as never;
}
