"use client";

import React from "react";

type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
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

export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
}: PageHeaderProps) {
  const showActions = hasRenderableNode(actions);

  return (
    <div className={["rounded-[22px] border border-white/8 bg-black/10 px-4 py-4 sm:px-5", className].join(" ")}>
      <div className="space-y-2">
        {subtitle ? (
          <div className="font-display text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/52">
            {subtitle}
          </div>
        ) : null}
        <h1 className="font-display text-[clamp(1.8rem,2.4vw,2.8rem)] font-semibold leading-tight text-foreground">
          {title}
        </h1>
      </div>
      {showActions ? (
        <div className="page-actions-enter flex flex-wrap items-center gap-2 rounded-[18px] border border-white/8 bg-white/[0.03] px-2 py-2 sm:ml-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
