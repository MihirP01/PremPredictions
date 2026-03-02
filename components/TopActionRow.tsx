"use client";

import React from "react";
import PageHeader from "./PageHeader";

type TopActionRowProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export default function TopActionRow({
  title,
  subtitle,
  actions,
  className = "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
}: TopActionRowProps) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} className={className} />;
}
