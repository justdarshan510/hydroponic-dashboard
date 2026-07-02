import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ss from 'simple-statistics';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type HydroponicImageRecord } from '@/lib/hydroponicMetadata';

interface ModelPredictionProps {
  data: HydroponicImageRecord[];
}

const FEATURE_FIELDS = [
  { key: 'Mean_R', label: 'Red Value', placeholder: 'e.g. 150.2' },
  { key: 'Mean_G', label: 'Green Value', placeholder: 'e.g. 165.4' },
  { key: 'Mean_B', label: 'Blue Value', placeholder: 'e.g. 123.6' },
  { key: 'Brightness', label: 'Brightness', placeholder: 'e.g. 160.8' },
  { key: 'Saturation_Pct', label: 'Saturation %', placeholder: 'e.g. 42.6' },
  { key: 'Green_Coverage_Pct', label: 'Green Area %', placeholder: 'e.g. 44.1' },
  { key: 'Excess_Green_Index', label: 'Excess Green Index', placeholder: 'e.g. 12.3' },
  { key: 'Contrast', label: 'Contrast', placeholder: 'e.g. 76.2' },
  { key: 'Edge_Density', label: 'Edge Density', placeholder: 'e.g. 0.28' },
  { key: 'Leaf_Area_Ratio', label: 'Leaf Area Ratio', placeholder: 'e.g. 0.61' },
  { key: 'Homogeneity', label: 'Homogeneity', placeholder: 'e.g. 18.4' },
] as const;

type FieldKey = (typeof FEATURE_FIELDS)[number]['key'];

interface PredictionResult {
  label: string;
  confidence: number;
  matchCount: number;
  simpleReason: string;
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeValue(value: number, mean: number, deviation: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(deviation) || deviation === 0) return value - mean;
  return (value - mean) / deviation;
}

export function ModelPrediction({ data }: ModelPredictionProps) {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    Mean_R: '',
    Mean_G: '',
    Mean_B: '',
    Brightness: '',
    Saturation_Pct: '',
    Green_Coverage_Pct: '',
    Excess_Green_Index: '',
    Contrast: '',
    Edge_Density: '',
    Leaf_Area_Ratio: '',
    Homogeneity: '',
  });
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);

  const model = useMemo(() => {
    const labeledData = data.filter((record) => record.Class_Label !== 'Unknown');
    if (labeledData.length < 5) return null;

    const featureStats = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => {
        const series = labeledData.map((record) => Number(record[key]));
        return [
          key,
          {
            mean: ss.mean(series),
            deviation: ss.standardDeviation(series) || 1,
          },
        ];
      }),
    ) as Record<FieldKey, { mean: number; deviation: number }>;

    const samples = labeledData.map((record) => ({
      label: record.Class_Label,
      values: Object.fromEntries(
        FEATURE_FIELDS.map(({ key }) => [
          key,
          normalizeValue(Number(record[key]), featureStats[key].mean, featureStats[key].deviation),
        ]),
      ) as Record<FieldKey, number>,
    }));

    const total = samples.length;
    const correct = samples.reduce((sum, sample, index) => {
      const neighbors = samples
        .filter((_, candidateIndex) => candidateIndex !== index)
        .map((candidate) => {
          const distance = Math.sqrt(
            FEATURE_FIELDS.reduce((accumulator, { key }) => {
              return accumulator + (sample.values[key] - candidate.values[key]) ** 2;
            }, 0),
          );

          return { label: candidate.label, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);

      const votes = neighbors.reduce((map, neighbor) => {
        const weight = 1 / (neighbor.distance + 1e-6);
        map.set(neighbor.label, (map.get(neighbor.label) ?? 0) + weight);
        return map;
      }, new Map<string, number>());

      const predicted = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      return sum + Number(predicted === sample.label);
    }, 0);

    const accuracy = total > 0 ? (correct / total) * 100 : 0;

    return {
      featureStats,
      samples,
      k: Math.min(5, Math.max(3, Math.floor(Math.sqrt(samples.length)))),
      accuracy: round(accuracy, 1),
    };
  }, [data]);

  const populateFromDataset = () => {
    if (!data.length) return;
    const averageValues = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => [key, String(round(ss.mean(data.map((record) => Number(record[key]))), 2))]),
    ) as Record<FieldKey, string>;
    setValues(averageValues);
  };

  const populateFromFirstSample = () => {
    if (!data.length) return;
    const sample = data[0];
    const sampleValues = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => [key, String(sample[key])]),
    ) as Record<FieldKey, string>;
    setValues(sampleValues);
  };

  const handlePredict = () => {
    if (!model) return;

    const parsed = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => [key, Number(values[key])]),
    ) as Record<FieldKey, number>;

    if (Object.values(parsed).some((value) => Number.isNaN(value))) {
      setPrediction({
        label: 'Input Required',
        confidence: 0,
        matchCount: 0,
        simpleReason: 'Fill all fields with numbers before running prediction.',
      });
      return;
    }

    const normalizedInput = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => [
        key,
        normalizeValue(parsed[key], model.featureStats[key].mean, model.featureStats[key].deviation),
      ]),
    ) as Record<FieldKey, number>;

    const neighbors = model.samples
      .map((sample) => {
        const distance = Math.sqrt(
          FEATURE_FIELDS.reduce((accumulator, { key }) => {
            return accumulator + (normalizedInput[key] - sample.values[key]) ** 2;
          }, 0),
        );

        return { label: sample.label, distance };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, model.k);

    const weightedVotes = neighbors.reduce((map, neighbor) => {
      const weight = 1 / (neighbor.distance + 1e-6);
      map.set(neighbor.label, (map.get(neighbor.label) ?? 0) + weight);
      return map;
    }, new Map<string, number>());

    const sortedVotes = Array.from(weightedVotes.entries()).sort((a, b) => b[1] - a[1]);
    const bestLabel = sortedVotes[0]?.[0] ?? 'Unknown';
    const totalVote = sortedVotes.reduce((sum, [, weight]) => sum + weight, 0);
    const confidence = totalVote > 0 ? round((sortedVotes[0]?.[1] ?? 0) / totalVote * 100, 1) : 0;
    const matchCount = neighbors.filter((neighbor) => neighbor.label === bestLabel).length;
    const minDistance = neighbors[0]?.distance ?? 0;
    const finalLabel = confidence < 42 || minDistance > 4.6 ? 'Unknown' : bestLabel;
    const simpleReason =
      finalLabel === 'Unknown'
        ? 'The entered feature profile is outside the trained decision boundary, so the model is withholding a diagnosis.'
        : `${matchCount} of the ${model.k} closest samples in your dataset belong to ${finalLabel}.`;

    setPrediction({
      label: finalLabel,
      confidence: finalLabel === 'Unknown' ? 0 : confidence,
      matchCount: finalLabel === 'Unknown' ? 0 : matchCount,
      simpleReason,
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-12 animate-in slide-in-from-bottom-4 duration-700 pb-10">
      <div className="space-y-4 text-center">
        <h2 className="text-4xl font-bold tracking-tight text-slate-900">Predictive Intelligence</h2>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
           Real-time plant deficiency classification. Input image metadata features to interpret health status using our k-NN model.
        </p>
      </div>

      {!model && (
        <Alert>
          <AlertTitle>Metadata model not ready</AlertTitle>
          <AlertDescription>
            The predictor needs a labeled metadata dataset with enough rows before it can train the classifier.
          </AlertDescription>
        </Alert>
      )}

      {model && (
        <div className="grid gap-6 md:grid-cols-2">
          <StatCard title="Dataset Samples" value={String(model.samples.length)} subtitle="Searchable reference rows" />
          <StatCard title="Accuracy" value={`${model.accuracy}%`} subtitle="Cross-validation estimate" icon={<Activity className="h-4 w-4" />} />
        </div>
      )}

      <Card className="border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-[2rem]">
        <CardHeader className="px-8 pt-8 border-none">
          <CardTitle className="text-xl">Feature Parameters</CardTitle>
          <CardDescription>
            Provide the specific image characteristics extracted from the plant specimen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 p-8 md:grid-cols-2">
          {FEATURE_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
              />
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 p-8 border-t border-slate-50 lg:flex-row">
          <Button className="w-full lg:flex-1 bg-slate-900 hover:bg-slate-800 text-white shadow-md transition-all active:scale-95" size="lg" onClick={handlePredict} disabled={!model}>
            <Search className="mr-2 h-4 w-4" />
            Classify Specimen
          </Button>
          <Button variant="outline" className="w-full lg:w-auto border-slate-200 hover:bg-slate-50" onClick={populateFromDataset} disabled={!model}>
            Auto-fill Averages
          </Button>
          <Button variant="outline" className="w-full lg:w-auto border-slate-200 hover:bg-slate-50" onClick={populateFromFirstSample} disabled={!model}>
            Load Sample Record
          </Button>
        </CardFooter>
      </Card>

      {prediction && (
        <div className="animate-in zoom-in-95 duration-500">
          <Card className="overflow-hidden border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-[2.5rem]">
            <div className={`h-3 w-full ${prediction.label === 'Healthy' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <CardHeader className="p-10 pb-6 border-none">
              <CardTitle className="text-2xl font-bold">Inference Result</CardTitle>
              <CardDescription>Based on high-dimensional similarity matching against existing dataset.</CardDescription>
            </CardHeader>
            <CardContent className="p-10 pt-0 space-y-10">
              <div className="flex items-center gap-6">
                <div className={cn(
                  "rounded-3xl p-5 shadow-inner transition-colors",
                  prediction.label === 'Healthy' ? "bg-emerald-50" : "bg-amber-50"
                )}>
                  {prediction.label === 'Healthy' ? (
                    <Check className="h-10 w-10 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-10 w-10 text-amber-600" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-4xl font-extrabold tracking-tight text-slate-900">{prediction.label}</div>
                  <div className="text-sm font-medium text-slate-400">
                    <span className="text-slate-900">{prediction.confidence}%</span> Model Confidence
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] bg-slate-50 p-8 border border-white">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Logical Rationale</div>
                <p className="text-sm text-slate-600 leading-relaxed font-medium">{prediction.simpleReason}</p>
                <div className="mt-4 flex gap-4 text-xs font-semibold text-slate-400">
                  <span className="px-3 py-1 bg-white rounded-full border border-slate-100 shadow-sm transition-transform hover:scale-105">
                    Search Space: {model?.samples.length} records
                  </span>
                  <span className="px-3 py-1 bg-white rounded-full border border-slate-100 shadow-sm transition-transform hover:scale-105">
                    Matches: {prediction.matchCount} / {model?.k}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}



function StatCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-100/50 bg-white p-7 shadow-sm ring-1 ring-slate-100/10">
      <div className="flex items-center gap-2 text-slate-300 mb-4">
        {icon || <Activity className="h-4 w-4" />}
        <div className="text-[10px] font-bold uppercase tracking-[0.2em]">{title}</div>
      </div>
      <div className="text-3xl font-semibold text-slate-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-2 text-xs text-slate-400 font-medium truncate">{subtitle}</div>
    </div>
  );
}
