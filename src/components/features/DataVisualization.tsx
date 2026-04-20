
import React from 'react';
import { CardTitle } from "@/components/ui/card";
import {
  DashboardChartCard,
  DashboardStatCard,
  dashboardAnalyticsHeaderClassName,
} from "@/components/ui/dashboard-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area, ScatterChart, Scatter, ZAxis } from 'recharts';
import { Pothole, Severity, Status } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataVisualizationProps {
  potholes: Pothole[];
}

/** Surface area in m² (fusion). */
function potholeSurfaceAreaM2(p: Pothole): number | undefined {
  if (p.fusion?.surfaceAreaM2 != null) return p.fusion.surfaceAreaM2;
  return undefined;
}

/** Opening width in cm for charts. */
function potholeWidthCm(p: Pothole): number | undefined {
  if (p.fusion?.widthM != null) return p.fusion.widthM * 100;
  return undefined;
}

export const DataVisualization = ({ potholes }: DataVisualizationProps) => {
  const isMobile = useIsMobile();
  
  // Basic severity and status counts
  const severityCounts = {
    low: potholes.filter(p => p.severity === 'low').length,
    medium: potholes.filter(p => p.severity === 'medium').length,
    high: potholes.filter(p => p.severity === 'high').length,
    critical: potholes.filter(p => p.severity === 'critical').length,
  };
  
  const statusCounts = {
    reported: potholes.filter(p => p.status === 'reported').length,
    inspected: potholes.filter(p => p.status === 'inspected').length,
    scheduled: potholes.filter(p => p.status === 'scheduled').length,
    'in-progress': potholes.filter(p => p.status === 'in-progress').length,
    completed: potholes.filter(p => p.status === 'completed').length,
  };
  
  // Data for charts
  const severityData = [
    { name: 'Low', value: severityCounts.low, color: '#10b981' },
    { name: 'Medium', value: severityCounts.medium, color: '#f59e0b' },
    { name: 'High', value: severityCounts.high, color: '#f97316' },
    { name: 'Critical', value: severityCounts.critical, color: '#ef4444' },
  ];
  
  const statusData = [
    { name: 'Reported', value: statusCounts.reported, color: '#3b82f6' },
    { name: 'Inspected', value: statusCounts.inspected, color: '#8b5cf6' },
    { name: 'Scheduled', value: statusCounts.scheduled, color: '#f59e0b' },
    { name: 'In Progress', value: statusCounts['in-progress'], color: '#f97316' },
    { name: 'Completed', value: statusCounts.completed, color: '#10b981' },
  ];

  // Advanced analytics: Detection accuracy by severity
  const accuracyBySeverity = [
    { 
      name: 'Low', 
      accuracy: potholes.filter(p => p.severity === 'low').reduce((acc, p) => acc + p.detectionAccuracy, 0) / 
                (potholes.filter(p => p.severity === 'low').length || 1) * 100
    },
    { 
      name: 'Medium', 
      accuracy: potholes.filter(p => p.severity === 'medium').reduce((acc, p) => acc + p.detectionAccuracy, 0) / 
                (potholes.filter(p => p.severity === 'medium').length || 1) * 100
    },
    { 
      name: 'High', 
      accuracy: potholes.filter(p => p.severity === 'high').reduce((acc, p) => acc + p.detectionAccuracy, 0) / 
                (potholes.filter(p => p.severity === 'high').length || 1) * 100
    },
    { 
      name: 'Critical', 
      accuracy: potholes.filter(p => p.severity === 'critical').reduce((acc, p) => acc + p.detectionAccuracy, 0) / 
                (potholes.filter(p => p.severity === 'critical').length || 1) * 100
    }
  ];

  // Time-based analytics: Reports by month
  const getMonthlyData = () => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      return {
        name: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        month: date.getMonth(),
        year: date.getFullYear(),
        count: 0
      };
    }).reverse();

    potholes.forEach(pothole => {
      const reportDate = new Date(pothole.reportDate);
      const monthIndex = months.findIndex(m => 
        m.month === reportDate.getMonth() && m.year === reportDate.getFullYear()
      );
      if (monthIndex >= 0) {
        months[monthIndex].count++;
      }
    });

    return months;
  };

  const monthlyReportData = getMonthlyData();

  const fusionMetricsCount = potholes.filter((p) => potholeSurfaceAreaM2(p) != null).length;
  const estimateAreaCount = potholes.filter((p) => p.fusion?.surfaceAreaIsEstimate).length;

  const areaSamples = potholes
    .map(potholeSurfaceAreaM2)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const averageSurfaceAreaM2 = areaSamples.length
    ? areaSamples.reduce((a, b) => a + b, 0) / areaSamples.length
    : 0;

  const scatterData = potholes
    .filter((p) => potholeSurfaceAreaM2(p) != null && potholeWidthCm(p) != null)
    .map((p) => ({
      area: potholeSurfaceAreaM2(p)!,
      width: potholeWidthCm(p)!,
      severity: p.severity,
      id: p.id,
    }));

  // Calculate chart heights based on device
  const chartHeight = isMobile ? 220 : 240;

  const fusionPct =
    potholes.length > 0
      ? ((fusionMetricsCount / potholes.length) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className={cn(dashboardAnalyticsHeaderClassName, "flex-shrink-0")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Pothole Analytics
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Fleet overview from vision detections and cloud fusion (DA3)
            </p>
          </div>
          <HoverCard>
            <HoverCardTrigger asChild>
              <button
                type="button"
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-slate-100/90 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pothole-500/40"
              >
                <InfoIcon className="h-4 w-4" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 sm:w-80">
              <div className="space-y-1">
                <h4 className="text-sm font-medium">About this data</h4>
                <p className="text-xs text-muted-foreground">
                  This dashboard aggregates pothole reports from the edge pipeline and cloud fusion
                  metrics where available.
                </p>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
      </div>
      <div className="min-w-0 pt-0">
        <Tabs defaultValue="overview" className="flex w-full min-w-0 flex-col">
          <TabsList
            className={cn(
              "grid w-full gap-1 rounded-xl bg-slate-100/90 p-1 shadow-inner ring-1 ring-slate-200/60",
              isMobile ? "mb-3 grid-cols-2" : "mb-4 grid-cols-4"
            )}
          >
            <TabsTrigger value="overview" className="text-xs sm:text-sm data-[state=active]:bg-pothole-500 data-[state=active]:text-white">Overview</TabsTrigger>
            <TabsTrigger value="severity" className="text-xs sm:text-sm data-[state=active]:bg-pothole-500 data-[state=active]:text-white">Severity</TabsTrigger>
            {!isMobile && <TabsTrigger value="status" className="text-sm data-[state=active]:bg-pothole-500 data-[state=active]:text-white">Status</TabsTrigger>}
            {!isMobile && <TabsTrigger value="advanced" className="text-sm data-[state=active]:bg-pothole-500 data-[state=active]:text-white">Advanced</TabsTrigger>}
            {isMobile && (
              <TabsTrigger value="more" className="col-span-2 mt-2 text-xs sm:text-sm data-[state=active]:bg-pothole-500 data-[state=active]:text-white">
                More Analytics
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="w-full min-w-0">
            <div className="w-full min-w-0 space-y-3 sm:space-y-4 pb-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                <DashboardStatCard title="Total Potholes" accent="orange">
                  <div className="flex flex-col gap-2">
                    <div className="text-2xl font-bold tabular-nums tracking-tight text-pothole-600 sm:text-3xl">
                      {potholes.length}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {fusionMetricsCount} with surface area ({fusionPct}%)
                      {estimateAreaCount > 0
                        ? ` — ${estimateAreaCount} from width×length estimate`
                        : ''}
                    </p>
                  </div>
                </DashboardStatCard>

                <DashboardStatCard title="Average Metrics" accent="sky">
                  <div className="flex flex-col text-xs sm:text-sm">
                    <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(5.25rem,auto)] items-baseline gap-x-4 border-b border-slate-100/90 py-2.5 first:pt-0">
                      <span className="text-muted-foreground">Surface area (avg)</span>
                      <span className="text-right font-semibold tabular-nums tracking-tight text-sky-700">
                        {averageSurfaceAreaM2.toFixed(2)} m²
                      </span>
                    </div>
                    <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(5.25rem,auto)] items-baseline gap-x-4 py-2.5 last:pb-0">
                      <span className="text-muted-foreground">Critical</span>
                      <span className="text-right font-semibold tabular-nums tracking-tight text-red-600">
                        {severityCounts.critical}
                      </span>
                    </div>
                  </div>
                </DashboardStatCard>
              </div>

              <DashboardChartCard title="Monthly Trend">
                <div className="h-48 sm:h-56 md:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={monthlyReportData}
                      margin={isMobile ? { top: 10, right: 10, left: -20, bottom: 20 } : { top: 10, right: 30, left: 0, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                      <YAxis tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                      <Tooltip
                        formatter={(value: any) => {
                          if (typeof value === 'number') {
                            return [`${value} potholes`, 'Count'];
                          }
                          return [`${value}`, 'Count'];
                        }}
                        contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                      />
                      <Area type="monotone" dataKey="count" stroke="#ea580c" fill="#fed7aa" name="Reported" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </DashboardChartCard>
            </div>
          </TabsContent>


          <TabsContent value="severity" className="w-full min-w-0">
            <div className="w-full min-w-0 space-y-3 sm:space-y-4 pb-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                <DashboardChartCard title="Severity Distribution">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={severityData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={isMobile ? 60 : 75}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {severityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend layout={isMobile ? "horizontal" : "vertical"} align={isMobile ? "center" : "right"} verticalAlign={isMobile ? "bottom" : "middle"} wrapperStyle={{ fontSize: isMobile ? '11px' : '12px' }} />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value} potholes`, 'Count'];
                            }
                            return [`${value}`, 'Count'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>

                <DashboardChartCard title="Severity Comparison">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={severityData}
                        margin={isMobile ? { top: 10, right: 10, left: -20, bottom: 20 } : { top: 10, right: 30, left: 0, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="name" tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <YAxis tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value} potholes`, 'Count'];
                            }
                            return [`${value}`, 'Count'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                        <Bar dataKey="value" fill="#ea580c" name="Count" radius={[8, 8, 0, 0]}>
                          {severityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>
              </div>
            </div>
          </TabsContent>


          <TabsContent value="status" className="w-full min-w-0">
            <div className="w-full min-w-0 space-y-3 sm:space-y-4 pb-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                <DashboardChartCard title="Status Distribution">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={isMobile ? 60 : 75}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend layout={isMobile ? "horizontal" : "vertical"} align={isMobile ? "center" : "right"} verticalAlign={isMobile ? "bottom" : "middle"} wrapperStyle={{ fontSize: isMobile ? '11px' : '12px' }} />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value} potholes`, 'Count'];
                            }
                            return [`${value}`, 'Count'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>

                <DashboardChartCard title="Status Comparison">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={statusData}
                        margin={isMobile ? { top: 10, right: 10, left: -20, bottom: 20 } : { top: 10, right: 30, left: 0, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="name" tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <YAxis tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value} potholes`, 'Count'];
                            }
                            return [`${value}`, 'Count'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                        <Bar dataKey="value" name="Count" radius={[8, 8, 0, 0]}>
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>
              </div>
            </div>
          </TabsContent>


          <TabsContent value="advanced" className="w-full min-w-0">
            <div className="w-full min-w-0 space-y-3 sm:space-y-4 pb-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                <DashboardChartCard title="Detection Accuracy by Severity">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={accuracyBySeverity}
                        margin={isMobile ? { top: 10, right: 10, left: -20, bottom: 5 } : { top: 10, right: 30, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="name" tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <YAxis domain={[0, 100]} unit="%" tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }} stroke="#6b7280" />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value.toFixed(1)}%`, 'Accuracy'];
                            }
                            return [`${value}%`, 'Accuracy'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                        <Line type="monotone" dataKey="accuracy" stroke="#ea580c" strokeWidth={2} name="Accuracy" dot={{ fill: '#ea580c', r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>

                <DashboardChartCard title="Surface area vs opening width">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart
                        margin={isMobile ? { top: 10, right: 10, left: -20, bottom: 5 } : { top: 10, right: 30, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          type="number"
                          dataKey="area"
                          name="Area"
                          unit=" m²"
                          tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }}
                          stroke="#6b7280"
                        />
                        <YAxis
                          type="number"
                          dataKey="width"
                          name="Width"
                          unit="cm"
                          tick={isMobile ? { fontSize: 10 } : { fontSize: 12 }}
                          stroke="#6b7280"
                          tickFormatter={(v) => Math.round(Number(v))}
                        />
                        <ZAxis
                          type="category"
                          dataKey="severity"
                          name="Severity"
                          range={[50, 200]}
                        />
                        <Tooltip
                          formatter={(value: any, name: any) => {
                            if (typeof value !== 'number') return [value, name];
                            if (name === 'Area') return [`${value.toFixed(2)} m²`, 'Surface area'];
                            if (name === 'Width') return [`${Math.round(value)} cm`, 'Opening width'];
                            return [value, name];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                          cursor={{ strokeDasharray: '3 3' }}
                        />
                        <Scatter
                          name="Potholes"
                          data={scatterData}
                          fill="#ea580c"
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>
              </div>
            </div>
          </TabsContent>


          {/* New tab for mobile that combines Status and Advanced */}
          {isMobile && (
            <TabsContent value="more" className="w-full min-w-0">
              <div className="w-full min-w-0 space-y-3 sm:space-y-4 pb-4">
                <DashboardChartCard title="Status Distribution">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={60}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: '11px' }} />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value} potholes`, 'Count'];
                            }
                            return [`${value}`, 'Count'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>

                <DashboardChartCard title="Detection Accuracy">
                  <div className="h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={accuracyBySeverity}
                        margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#6b7280" />
                        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} stroke="#6b7280" />
                        <Tooltip
                          formatter={(value: any) => {
                            if (typeof value === 'number') {
                              return [`${value.toFixed(1)}%`, 'Accuracy'];
                            }
                            return [`${value}%`, 'Accuracy'];
                          }}
                          contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        />
                        <Line type="monotone" dataKey="accuracy" stroke="#ea580c" strokeWidth={2} name="Accuracy" dot={{ fill: '#ea580c', r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardChartCard>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default DataVisualization;
