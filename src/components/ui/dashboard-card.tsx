import * as React from "react"

import { cn } from "@/lib/utils"

const surface =
  "relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/50 text-card-foreground shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-950/[0.04] transition-[box-shadow,ring-color] duration-300 hover:shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14)] hover:ring-slate-950/[0.07]"

const accentBar = {
  orange:
    "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gradient-to-b before:from-pothole-400 before:to-pothole-600",
  slate:
    "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gradient-to-b before:from-slate-400 before:to-slate-600",
  sky:
    "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gradient-to-b before:from-sky-400 before:to-sky-600",
} as const

export type DashboardStatAccent = keyof typeof accentBar

export const dashboardAnalyticsRootClassName = cn(
  "flex flex-col h-full overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-white to-slate-50/40 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-950/[0.04]",
  "backdrop-blur-[2px]"
)

export const dashboardAnalyticsHeaderClassName =
  "flex-shrink-0 border-b border-slate-100/95 bg-gradient-to-r from-slate-50/70 via-white/40 to-transparent pb-4"

export function DashboardStatCard({
  title,
  children,
  accent = "orange",
  className,
}: {
  title: string
  children: React.ReactNode
  accent?: DashboardStatAccent
  className?: string
}) {
  return (
    <div className={cn(surface, "min-w-0 px-5 py-5", accentBar[accent], className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function DashboardChartCard({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn(surface, "flex min-w-0 w-full flex-col", className)}>
      <div className="flex items-center gap-2.5 border-b border-slate-100/90 bg-gradient-to-r from-slate-50/70 to-transparent px-4 py-3 sm:px-5">
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-pothole-400 to-pothole-600 shadow-[0_0_0_3px_rgba(249,115,22,0.18)]"
          aria-hidden
        />
        <h3 className="text-xs sm:text-sm font-semibold tracking-tight text-slate-800">
          {title}
        </h3>
      </div>
      <div className="flex-1 p-4 sm:p-5 sm:pt-4">{children}</div>
    </div>
  )
}
