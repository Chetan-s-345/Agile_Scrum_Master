import React from "react";
import { Link as RouterLink } from "react-router-dom";

type LinkProps = {
  href: string;
  replace?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
};

function normalizeHref(href: string): string {
  if (!href) return "/";
  if (href.startsWith("#")) return href.slice(1) || "/";
  return href;
}

export default function Link({ href, replace, children, ...rest }: LinkProps) {
  const normalized = normalizeHref(href);
  if (/^https?:\/\//i.test(normalized)) {
    return (
      <a href={normalized} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={normalized} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
}
