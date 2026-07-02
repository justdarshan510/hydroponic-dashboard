import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as ss from 'simple-statistics';
import { Activity, AlertCircle, FileText, Upload } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseCSV } from '@/lib/csvData';
import { type HydroponicImageRecord } from '@/lib/hydroponicMetadata';

interface DatasetDashboardProps {
  data: HydroponicImageRecord[];
  filename: string;
  onDataChange: (records: HydroponicImageRecord[]) => void;
  onFilenameChange: (filename: string) => void;
}

const CLASS_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  'K Deficiency': '#f59e0b',
  'N Deficiency': '#eab308',
  'P Deficiency': '#7c3aed',
  'Fungal Infection': '#dc2626',
  Unknown: '#64748b',
};

const FEATURE_META = [
  { key: 'Mean_R', label: 'Mean R' },
  { key: 'Mean_G', label: 'Mean G' },
  { key: 'Mean_B', label: 'Mean B' },
  { key: 'Brightness', label: 'Brightness' },
  { key: 'Green_Coverage_Pct', label: 'Green Cover %' },
  { key: 'Excess_Green_Index', label: 'Excess Green' },
  { key: 'Contrast', label: 'Contrast' },
  { key: 'Edge_Density', label: 'Edge Density' },
  { key: 'Leaf_Area_Ratio', label: 'Leaf Area Ratio' },
] as const;

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeCorrelation(a: number[], b: number[]) {
  if (a.length < 2 || b.length < 2 || a.length !== b.length) return 0;
  if (new Set(a).size < 2 || new Set(b).size < 2) return 0;

  try {
    return ss.sampleCorrelation(a, b);
  } catch {
    return 0;
  }
}

function buildBins(values: number[], step: number) {
  if (values.length === 0) return [];
  const min = Math.floor(Math.min(...values) / step) * step;
  const max = Math.ceil(Math.max(...values) / step) * step;
  const bins: Array<{ range: string; count: number }> = [];

  for (let start = min; start <= max; start += step) {
    const end = start + step;
    const count = values.filter((value) => value >= start && value < end).length;
    bins.push({ range: `${start}-${end}`, count });
  }

  return bins.filter((bin) => bin.count > 0);
}

export function DatasetDashboard({
  data,
  filename,
  onDataChange,
  onFilenameChange,
}: DatasetDashboardProps) {
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;

    const file = e.target.files[0];
    onFilenameChange(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? '');
        const parsed = parseCSV(text);
        if (parsed.length === 0) throw new Error('No valid records found');
        onDataChange(parsed);
        setError(null);
      } catch (err) {
        console.error(err);
        setError('Failed to parse the metadata CSV. Please upload the generated hydroponic image-metadata file.');
      }
    };
    reader.readAsText(file);
  };

  const dashboard = useMemo(() => {
    if (!data.length) return null;

    const classLabels = Array.from(new Set(data.map((record) => record.Class_Label))).sort();
    const classCounts = classLabels.map((label) => ({
      name: label,
      value: data.filter((record) => record.Class_Label === label).length,
      fill: CLASS_COLORS[label] ?? CLASS_COLORS.Unknown,
    }));

    const barData = classLabels.map((label) => {
      const rows = data.filter((record) => record.Class_Label === label);
      return {
        name: label,
        Average_Brightness: round(ss.mean(rows.map((record) => record.Brightness))),
        Average_GreenCoverage: round(ss.mean(rows.map((record) => record.Green_Coverage_Pct))),
        count: rows.length,
      };
    });

    const histogramData = buildBins(data.map((record) => record.Brightness), 10);

    const correlationMatrix = FEATURE_META.map((rowFeature) =>
      FEATURE_META.map((colFeature) => ({
        row: rowFeature.label,
        col: colFeature.label,
        value: safeCorrelation(
          data.map((record) => Number(record[rowFeature.key])),
          data.map((record) => Number(record[colFeature.key])),
        ),
      })),
    );

    const brightnessValues = data.map((record) => record.Brightness);
    const greenCoverageValues = data.map((record) => record.Green_Coverage_Pct);
    const correlation = safeCorrelation(brightnessValues, greenCoverageValues);

    const groupedByClass = classLabels.map((label) => ({
      label,
      values: data.filter((record) => record.Class_Label === label).map((record) => record.Brightness),
    }));
    const sortedGroups = [...groupedByClass].sort((a, b) => b.values.length - a.values.length);
    const tGroupA = sortedGroups[0];
    const tGroupB = sortedGroups[sortedGroups.length - 1];

    let tTestResult = 0;
    let zScore = 0;
    if (tGroupA && tGroupB && tGroupA.values.length > 1 && tGroupB.values.length > 1) {
      tTestResult = ss.tTestTwoSample(tGroupA.values, tGroupB.values) ?? 0;
      const meanDiff = ss.mean(tGroupA.values) - ss.mean(tGroupB.values);
      const varianceA = ss.variance(tGroupA.values) || 0;
      const varianceB = ss.variance(tGroupB.values) || 0;
      const denominator = Math.sqrt(varianceA / tGroupA.values.length + varianceB / tGroupB.values.length);
      zScore = denominator === 0 ? 0 : meanDiff / denominator;
    }

    let anovaFStat = 0;
    const validGroups = groupedByClass.filter((group) => group.values.length > 0);
    if (validGroups.length > 1) {
      const grandMean = ss.mean(brightnessValues);
      let ssBetween = 0;
      let ssWithin = 0;

      validGroups.forEach((group) => {
        const groupMean = ss.mean(group.values);
        ssBetween += group.values.length * (groupMean - grandMean) ** 2;
        group.values.forEach((value) => {
          ssWithin += (value - groupMean) ** 2;
        });
      });

      const dfBetween = validGroups.length - 1;
      const dfWithin = brightnessValues.length - validGroups.length;
      const msBetween = dfBetween > 0 ? ssBetween / dfBetween : 0;
      const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
      anovaFStat = msWithin === 0 ? 0 : msBetween / msWithin;
    }

    const dominantClass = classCounts.reduce((best, current) => (current.value > best.value ? current : best), classCounts[0]);

    return {
      classCounts,
      barData,
      histogramData,
      correlationMatrix,
      dominantClass,
      correlation,
      tTestResult,
      zScore,
      anovaFStat,
      tTestLabel: tGroupA && tGroupB ? `${tGroupA.label} vs ${tGroupB.label}` : 'Class A vs Class B',
      avgBrightness: round(ss.mean(data.map((record) => record.Brightness))),
      avgGreenness: round(ss.mean(data.map((record) => record.Excess_Green_Index))),
      avgLeafCoverage: round(ss.mean(data.map((record) => record.Leaf_Area_Ratio)) * 100),
    };
  }, [data]);

  if (!dashboard) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>No Metadata Loaded</AlertTitle>
        <AlertDescription>
          Upload a hydroponic metadata CSV or generate one from the image dataset in the Model Training tab.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-12 animate-in fade-in duration-700 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-slate-400">
             <FileText className="h-5 w-5" />
             <span className="text-xs font-semibold uppercase tracking-[0.2em]">{filename}</span>
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-slate-900 line-clamp-1">Dataset Overview</h2>
          <p className="text-lg text-slate-500 max-w-2xl leading-relaxed">
             Deep analysis of {data.length} hydroponic image records. Predictive modeling validation and feature distribution insights.
          </p>
        </div>
        <div className="flex gap-4">
          <input 
            id="csv-upload" 
            type="file" 
            accept=".csv" 
            className="hidden" 
            onChange={handleFileUpload} 
          />
          <Button 
            onClick={() => document.getElementById('csv-upload')?.click()}
            className="bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 rounded-2xl px-8 h-12 shadow-sm transition-all active:scale-95 whitespace-nowrap"
          >
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Correlation (r)" value={round(dashboard.correlation, 4).toFixed(4)} subtitle="Brightness vs Green Cover" />
        <StatCard title="T-Test (t-stat)" value={round(dashboard.tTestResult, 4).toFixed(4)} subtitle={dashboard.tTestLabel} />
        <StatCard title="Z-Score" value={round(dashboard.zScore, 2).toFixed(2)} subtitle="Statistical Significance" />
        <StatCard title="ANOVA (F-stat)" value={round(dashboard.anovaFStat, 4).toFixed(4)} subtitle="Group Variance" />
      </div>

      <div className="space-y-10">
        <div className="w-full">
           <ChartCard 
             title="Average Brightness per Deficiency Group" 
             description="Estimated average brightness highlighting luminance variations across nutrient deficiency segments."
             className="min-h-[480px]"
           >
            <BarChart data={dashboard.barData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={0} height={54} />
              <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="Average_Brightness" name="Average Brightness" radius={[8, 8, 0, 0]} barSize={60}>
                {dashboard.barData.map((entry) => (
                  <Cell key={entry.name} fill={CLASS_COLORS[entry.name] ?? CLASS_COLORS.Unknown} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <ChartCard title="Class Proportion" description="Category distribution." compact>
            <PieChart>
              <Pie
                data={dashboard.classCounts}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                dataKey="value"
                paddingAngle={4}
                stroke="none"
              >
                {dashboard.classCounts.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} opacity={0.8} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '20px' }} />
            </PieChart>
          </ChartCard>

          <ChartCard title="Brightness Distribution" description="Luminance frequency." compact>
            <BarChart data={dashboard.histogramData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip />
              <Bar dataKey="count" name="Images" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Luminance vs Coverage" description="Scatter density." compact>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" dataKey="Brightness" name="Brightness" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis type="number" dataKey="Green_Coverage_Pct" name="Green Coverage %" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter name="Leaf Samples" data={data} fill="hsl(var(--chart-4))" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-3xl border border-slate-100/50 bg-white p-6 shadow-sm ring-1 ring-slate-100/10">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">{title}</div>
      <div className="text-3xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="mt-2 text-xs text-slate-400 font-medium">{subtitle}</div>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
  className,
  compact = false,
}: {
  title: string;
  description: string;
  children: React.ReactElement;
  className?: string;
  compact?: boolean;
}) {
  return (
    <Card className={cn("overflow-hidden border-none shadow-sm ring-1 ring-slate-200/20 bg-white rounded-3xl", className)}>
      <CardHeader className={cn("border-b border-slate-50 bg-white px-8", compact ? "py-4" : "py-6")}>
        <CardTitle className="text-sm font-semibold text-slate-800">{title}</CardTitle>
        <CardDescription className="text-xs text-slate-400">{description}</CardDescription>
      </CardHeader>
      <CardContent className={cn("p-8", compact ? "h-[300px]" : "h-[400px]")}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
