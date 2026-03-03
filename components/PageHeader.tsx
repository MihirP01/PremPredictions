"use client";

import React from "react";

type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

type MobileVisibilityAwareType = {
  hidesOnMobile?: boolean;
};

function hasRenderableNode(node: React.ReactNode): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some(hasRenderableNode);
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (typeof node.type === "string") return hasRenderableNode(props.children);
    return props.children === undefined ? true : hasRenderableNode(props.children);
  }
  return true;
}

function hasMobileRenderableNode(node: React.ReactNode): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some(hasMobileRenderableNode);
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (typeof node.type !== "string" && (node.type as MobileVisibilityAwareType).hidesOnMobile) {
      return false;
    }
    if (typeof node.type === "string") return hasMobileRenderableNode(props.children);
    return props.children === undefined ? true : hasMobileRenderableNode(props.children);
  }
  return true;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
}: PageHeaderProps) {
  const showActions = hasRenderableNode(actions);
  const showActionsOnMobile = hasMobileRenderableNode(actions);

  return (
    <div
      className={["rounded-[22px] border px-4 py-4 sm:px-5", className].join(" ")}
      style={{
        borderColor: "var(--editorial-header-border)",
        background: "var(--editorial-header-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <div className="space-y-2">
        {subtitle ? (
          <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/50">
            {subtitle}
          </div>
        ) : null}
        <h1 className="font-display text-[clamp(1.9rem,2.4vw,2.95rem)] font-semibold leading-[0.96] text-foreground">
          {title}
        </h1>
      </div>
      {showActions ? (
        <div
          className={[
            "page-actions-enter flex-wrap items-center gap-2 rounded-[18px] border px-2 py-2 sm:ml-auto sm:flex",
            showActionsOnMobile ? "flex" : "hidden",
          ].join(" ")}
          style={{
            borderColor: "var(--editorial-action-border)",
            background: "var(--editorial-action-bg)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
