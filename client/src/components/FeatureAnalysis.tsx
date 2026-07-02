import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import * as ss from 'simple-statistics';
import { BrainCircuit, Activity, Network, Target } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type HydroponicImageRecord } from '@/lib/hydroponicMetadata';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface FeatureAnalysisProps {
  data: HydroponicImageRecord[];
}

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

// Calculate Gini Impurity for an array of string labels
function giniImpurity(labels: string[]) {
  if (labels.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  let impurity = 1;
  const total = labels.length;
  for (const count of Array.from(counts.values())) {
    const prob = count / total;
    impurity -= prob * prob;
  }
  return impurity;
}

// Approximate RF Feature Importance using Best Single Split Gini Decrease
function computeFeatureImportance(data: any[], featureKey: string, labels: string[]) {
  const values = data.map((d, i) => ({ val: Number(d[featureKey]), label: labels[i] }));
  values.sort((a, b) => a.val - b.val);

  const totalGini = giniImpurity(labels);
  let maxDecrease = 0;

  // Evaluate splits points between adjacent values
  for (let i = 1; i < values.length; i++) {
    if (values[i].val === values[i - 1].val) continue;

    const leftLabels = values.slice(0, i).map(v => v.label);
    const rightLabels = values.slice(i).map(v => v.label);

    const leftGini = giniImpurity(leftLabels);
    const rightGini = giniImpurity(rightLabels);

    const weightedGini = 
      (leftLabels.length / values.length) * leftGini +
      (rightLabels.length / values.length) * rightGini;

    const decrease = totalGini - weightedGini;
    if (decrease > maxDecrease) maxDecrease = decrease;
  }
  return maxDecrease;
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

function euclideanDistance(a: number[], b: number[]) {
  let distanceSquared = 0;
  for (let index = 0; index < a.length; index++) {
    distanceSquared += (a[index] - b[index]) ** 2;
  }
  return Math.sqrt(distanceSquared);
}

function voteByDistance(neighbors: Array<{ label: string; distance: number }>) {
  const votes = new Map<string, number>();
  neighbors.forEach((neighbor) => {
    const weight = 1 / (neighbor.distance + 1e-6);
    votes.set(neighbor.label, (votes.get(neighbor.label) || 0) + weight);
  });
  return Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';
}

export function FeatureAnalysis({ data }: FeatureAnalysisProps) {
  const analysis = useMemo(() => {
    const labeledData = data.filter((record) => record.Class_Label !== 'Unknown');
    if (labeledData.length < 5) return null;

    const classLabels = Array.from(new Set(labeledData.map((d) => d.Class_Label)));
    const classCounts = classLabels
      .map((label) => ({
        label,
        count: labeledData.filter((record) => record.Class_Label === label).length,
      }))
      .sort((a, b) => b.count - a.count);
    const majorityClass = classCounts[0]?.label ?? 'Unknown';

    const featureStats = FEATURE_META.map(({ key }) => {
      const series = labeledData.map((record) => Number(record[key as keyof HydroponicImageRecord]));
      return {
        key,
        mean: ss.mean(series),
        deviation: ss.standardDeviation(series) || 1,
      };
    });

    const normalizedSamples = labeledData.map(record => {
      return {
        label: record.Class_Label,
        values: FEATURE_META.map(({ key }, index) => {
          const stats = featureStats[index];
          return (Number(record[key as keyof typeof record]) - stats.mean) / stats.deviation;
        }),
      };
    });

    const k = Math.min(5, Math.max(3, Math.floor(Math.sqrt(normalizedSamples.length))));

    const benchmarkModels = [
      {
        name: 'Weighted k-NN',
        shortName: 'Best Match Voting',
        description: 'Compares each sample to its nearest neighbors and weights closer examples more heavily.',
        predict: (sampleIndex: number) => {
          const sample = normalizedSamples[sampleIndex];
          const neighbors = normalizedSamples
            .filter((_, idx) => idx !== sampleIndex)
            .map((candidate) => ({
              label: candidate.label,
              distance: euclideanDistance(sample.values, candidate.values),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, k);
          return voteByDistance(neighbors);
        },
      },
      {
        name: 'Nearest Centroid',
        shortName: 'Class Center Match',
        description: 'Builds one center point per class and predicts the class whose centroid is closest.',
        predict: (sampleIndex: number) => {
          const trainSamples = normalizedSamples.filter((_, idx) => idx !== sampleIndex);
          const centroids = classLabels.map((label) => {
            const classSamples = trainSamples.filter((sample) => sample.label === label);
            const centroid = FEATURE_META.map((_, valueIndex) => ss.mean(classSamples.map((sample) => sample.values[valueIndex])));
            return { label, centroid };
          });

          return centroids
            .map((centroid) => ({
              label: centroid.label,
              distance: euclideanDistance(normalizedSamples[sampleIndex].values, centroid.centroid),
            }))
            .sort((a, b) => a.distance - b.distance)[0]?.label ?? 'Unknown';
        },
      },
      {
        name: 'Majority Baseline',
        shortName: 'Most Common Class',
        description: 'Always predicts the most frequent class. Useful as a minimum benchmark.',
        predict: () => majorityClass,
      },
    ].map((model) => {
      let correct = 0;

      normalizedSamples.forEach((sample, sampleIndex) => {
        const predicted = model.predict(sampleIndex);
        if (predicted === sample.label) correct++;
      });

      return {
        ...model,
        accuracy: round((correct / normalizedSamples.length) * 100, 1),
      };
    }).sort((a, b) => b.accuracy - a.accuracy);

    const bestModel = benchmarkModels[0];
    const predictAccuracy = bestModel?.accuracy ?? 0;

    // 2. ANOVA F-Scores
    const anovaScores = FEATURE_META.map(({ key, label }) => {
      const allValues = labeledData.map(d => Number(d[key as keyof typeof d]));
      const grandMean = ss.mean(allValues);
      
      const grouped = classLabels.map(cls => labeledData.filter(d => d.Class_Label === cls).map(d => Number(d[key as keyof typeof d])));
      const validGroups = grouped.filter(g => g.length > 0);

      let ssBetween = 0;
      let ssWithin = 0;

      validGroups.forEach(group => {
        const groupMean = ss.mean(group);
        ssBetween += group.length * (groupMean - grandMean) ** 2;
        group.forEach(val => {
          ssWithin += (val - groupMean) ** 2;
        });
      });

      const dfBetween = validGroups.length - 1;
      const dfWithin = allValues.length - validGroups.length;
      const msBetween = dfBetween > 0 ? ssBetween / dfBetween : 0;
      const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
      const fStat = msWithin === 0 ? 0 : msBetween / msWithin;

      return { feature: label, score: fStat };
    }).sort((a, b) => b.score - a.score);

    // 3. RF Gini Importance
    const labels = labeledData.map(d => d.Class_Label);
    let totalDecrease = 0;
    const rawGiniScores = FEATURE_META.map(({ key, label }) => {
      const decrease = computeFeatureImportance(labeledData, key, labels);
      totalDecrease += decrease;
      return { feature: label, decrease };
    });

    const giniImportance = rawGiniScores.map(g => ({
      feature: g.feature,
      importance: totalDecrease > 0 ? round((g.decrease / totalDecrease) * 100, 1) : 0
    })).sort((a, b) => b.importance - a.importance);

    // 4. Class Separability (Average Centroid Distance)
    const centroids = classLabels.map(cls => {
      const classData = normalizedSamples.filter(s => s.label === cls);
      const centroidValues = FEATURE_META.map((_, i) => ss.mean(classData.map(s => s.values[i])));
      return { cls, centroidValues };
    });

    let totalSeparability = 0;
    let comparisons = 0;
    for (let i = 0; i < centroids.length; i++) {
        for (let j = i + 1; j < centroids.length; j++) {
            let distSq = 0;
            for (let k = 0; k < centroids[i].centroidValues.length; k++) {
                distSq += (centroids[i].centroidValues[k] - centroids[j].centroidValues[k]) ** 2;
            }
            totalSeparability += Math.sqrt(distSq);
            comparisons++;
        }
    }
    const classSeparability = comparisons > 0 ? round(totalSeparability / comparisons, 2) : 0;

    // 5. Correlation Matrix
    const correlationMatrix: number[][] = [];
    FEATURE_META.forEach((rowFeat) => {
      const row: number[] = [];
      FEATURE_META.forEach((colFeat) => {
        const corr = safeCorrelation(
          labeledData.map(d => Number(d[rowFeat.key as keyof typeof d])),
          labeledData.map(d => Number(d[colFeat.key as keyof typeof d]))
        );
        row.push(round(corr, 2));
      });
      correlationMatrix.push(row);
    });

    const sampleRows = labeledData.slice(0, 6).map((record) => ({
      id: record.Image_ID,
      label: record.Class_Label,
      brightness: round(record.Brightness, 1),
      greenCoverage: round(record.Green_Coverage_Pct, 1),
      excessGreen: round(record.Excess_Green_Index, 1),
      edgeDensity: round(record.Edge_Density, 3),
    }));

    const datasetSummary = {
      totalSamples: labeledData.length,
      totalClasses: classLabels.length,
      avgBrightness: round(ss.mean(labeledData.map((record) => record.Brightness)), 1),
      avgGreenCoverage: round(ss.mean(labeledData.map((record) => record.Green_Coverage_Pct)), 1),
      avgLeafArea: round(ss.mean(labeledData.map((record) => record.Leaf_Area_Ratio)) * 100, 1),
    };

    const toolDescriptions = [
      {
        name: 'Metadata Extraction Engine',
        description: 'Converts every image into numeric descriptors such as RGB averages, brightness, hue, green coverage, excess green index, contrast, edge density, and leaf-area ratio.',
      },
      {
        name: 'Normalization Pipeline',
        description: 'Standardizes each feature before model comparison so distance-based methods are not dominated by larger numeric ranges.',
      },
      {
        name: 'Model Benchmark Panel',
        description: 'Runs multiple prediction models on the same dataset and ranks them by observed accuracy for a fair comparison.',
      },
      {
        name: 'Correlation Matrix',
        description: 'Checks which features move together, helping identify redundant measurements and strong linear relationships.',
      },
    ];

    const statisticalTests = [
      {
        name: 'Leave-One-Out Cross-Validation',
        description: 'Evaluates each record one at a time using all remaining records as the training set. This is reliable for smaller datasets because every sample is tested.',
      },
      {
        name: 'ANOVA F-Score',
        description: 'Measures how strongly each feature changes across class groups. Higher scores suggest stronger discriminatory power.',
      },
      {
        name: 'RF Gini Importance',
        description: 'Approximates tree-based feature importance by measuring how much a feature can reduce class impurity during a split.',
      },
      {
        name: 'Pearson Correlation',
        description: 'Quantifies the strength and direction of linear relationships between two numeric features.',
      },
      {
        name: 'Centroid Separability',
        description: 'Measures the average distance between class centers after normalization. Larger separation usually means easier classification.',
      },
    ];

    return {
      sampleCount: labeledData.length,
      classCounts,
      featureCount: FEATURE_META.length,
      benchmarkModels,
      bestModel,
      predictAccuracy,
      anovaScores: anovaScores.slice(0, 6),
      giniImportance: giniImportance.slice(0, 6),
      classSeparability,
      correlationMatrix,
      datasetSummary,
      sampleRows,
      toolDescriptions,
      statisticalTests,
    };
  }, [data]);

  if (!analysis) {
    return (
      <div className="mx-auto max-w-4xl pt-10">
        <Alert>
            <AlertTitle>Insufficient Data</AlertTitle>
            <AlertDescription>We need at least 5 labeled samples to run the feature analysis.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-12 animate-in slide-in-from-bottom-4 duration-700 pb-10">
      <div className="space-y-4">
        <h2 className="text-4xl font-bold tracking-tight text-slate-900">Feature Intelligence</h2>
        <p className="text-lg text-slate-500 max-w-2xl leading-relaxed">
           Deep statistical evaluation of image features, model accuracy, and the testing methods applied to your plant dataset.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Predict Accuracy" value={`${analysis.predictAccuracy}%`} subtitle="LOO Cross-validation" icon={<Target className="h-4 w-4" />} />
          <StatCard title="Class Separability" value={String(analysis.classSeparability)} subtitle="Avg Centroid Dist" icon={<Network className="h-4 w-4" />} />
          <StatCard title="Highest F-Score" value={String(round(analysis.anovaScores[0]?.score || 0, 1))} subtitle={analysis.anovaScores[0]?.feature || 'N/A'} icon={<Activity className="h-4 w-4" />} />
          <StatCard title="Top RF Gini" value={`${analysis.giniImportance[0]?.importance}%`} subtitle={analysis.giniImportance[0]?.feature || 'N/A'} icon={<BrainCircuit className="h-4 w-4" />} />
      </div>

      <div className="space-y-10">
        <AnalysisCard
          title="Best Model For This Dataset"
          description="A direct comparison of the prediction models currently evaluated in the app."
        >
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/60 p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">Best Accuracy</div>
              <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">{analysis.bestModel?.name}</div>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                For the current dataset, <span className="font-semibold text-slate-900">{analysis.bestModel?.name}</span> provides the best measured accuracy. {analysis.bestModel?.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-xs font-semibold text-slate-600">
                <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-emerald-100">
                  Accuracy: {analysis.bestModel?.accuracy}%
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-emerald-100">
                  Samples: {analysis.sampleCount}
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-emerald-100">
                  Features: {analysis.featureCount}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Dataset Composition</div>
              <div className="grid gap-3">
                {analysis.classCounts.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className="font-bold text-slate-900">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AnalysisCard>

        <AnalysisCard
          title="Sample Data And Dataset Summary"
          description="A compact preview of the current dataset and the type of records used for model evaluation."
        >
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-5">
              <MiniStat label="Total Samples" value={String(analysis.datasetSummary.totalSamples)} />
              <MiniStat label="Classes" value={String(analysis.datasetSummary.totalClasses)} />
              <MiniStat label="Avg Brightness" value={String(analysis.datasetSummary.avgBrightness)} />
              <MiniStat label="Avg Green Cover" value={`${analysis.datasetSummary.avgGreenCoverage}%`} />
              <MiniStat label="Avg Leaf Area" value={`${analysis.datasetSummary.avgLeafArea}%`} />
            </div>

            <div className="overflow-x-auto rounded-[1.5rem] border border-slate-100">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-slate-500">
                    <th className="px-4 py-3 font-semibold">Image ID</th>
                    <th className="px-4 py-3 font-semibold">Class</th>
                    <th className="px-4 py-3 font-semibold">Brightness</th>
                    <th className="px-4 py-3 font-semibold">Green Cover %</th>
                    <th className="px-4 py-3 font-semibold">Excess Green</th>
                    <th className="px-4 py-3 font-semibold">Edge Density</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.sampleRows.map((row) => (
                    <tr key={`${row.id}-${row.label}`} className="border-t border-slate-100 text-slate-700">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.id}</td>
                      <td className="px-4 py-3">{row.label}</td>
                      <td className="px-4 py-3 tabular-nums">{row.brightness}</td>
                      <td className="px-4 py-3 tabular-nums">{row.greenCoverage}</td>
                      <td className="px-4 py-3 tabular-nums">{row.excessGreen}</td>
                      <td className="px-4 py-3 tabular-nums">{row.edgeDensity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </AnalysisCard>

        <AnalysisCard
          title="Prediction Models Applied"
          description="Every prediction model benchmarked against the current dataset."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {analysis.benchmarkModels.map((model, index) => (
              <div key={model.name} className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{model.name}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{model.shortName}</div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-900 shadow-sm ring-1 ring-slate-100">
                    #{index + 1}
                  </div>
                </div>
                <div className="mt-4 text-3xl font-black tracking-tight text-slate-900">{model.accuracy}%</div>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{model.description}</p>
              </div>
            ))}
          </div>
        </AnalysisCard>

        <AnalysisCard
          title="Methods And Statistical Tests"
          description="What each method, statistical test, and analysis tool means and why it is useful."
        >
          <div className="space-y-8">
            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Statistical Testing</div>
              <div className="grid gap-4 md:grid-cols-2">
                {analysis.statisticalTests.map((method) => (
                  <div key={method.name} className="rounded-[1.5rem] border border-slate-100 bg-white p-5 shadow-sm">
                    <div className="text-sm font-bold text-slate-900">{method.name}</div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{method.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Tools Applied In The Dashboard</div>
              <div className="grid gap-4 md:grid-cols-2">
                {analysis.toolDescriptions.map((tool) => (
                  <div key={tool.name} className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-5">
                    <div className="text-sm font-bold text-slate-900">{tool.name}</div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{tool.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AnalysisCard>

        <AnalysisCard 
          title="ANOVA F-Scores" 
          description="Statistical significance of individual features across segments. Hero metric for feature selection."
        >
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={analysis.anovaScores} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis dataKey="feature" type="category" width={110} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="score" fill="hsl(var(--chart-1))" radius={[0, 6, 6, 0]} name="F-Score" barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnalysisCard>

        <div className="grid gap-8 lg:grid-cols-2">
            <AnalysisCard 
              title="RF Gini Importance" 
              description="Heuristic capability to separate data segments."
            >
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={analysis.giniImportance} margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis dataKey="feature" type="category" width={100} fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip />
                    <Bar dataKey="importance" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} name="Importance %" barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AnalysisCard>

            <AnalysisCard title="Pearson Correlation" description="Feature interaction matrix.">
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] text-left">
                  <thead>
                    <tr>
                      <th className="p-1.5 border-b border-r border-slate-50 bg-slate-50/50 font-semibold text-slate-400"></th>
                      {FEATURE_META.map((feat) => (
                        <th key={feat.key} className="p-1.5 border-b border-slate-50 bg-slate-50/50 font-semibold text-slate-400 text-center">
                          {feat.label.replace(' ', '\n')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.correlationMatrix.map((row, i) => (
                      <tr key={FEATURE_META[i].key}>
                        <td className="p-1.5 border-b border-r border-slate-50 bg-slate-50/50 font-medium text-slate-500 whitespace-nowrap">
                          {FEATURE_META[i].label}
                        </td>
                        {row.map((val, j) => {
                          const intensity = Math.abs(val);
                          const color = val > 0 
                            ? `rgba(156, 197, 161, ${intensity * 0.5})` 
                            : `rgba(239, 110, 110, ${intensity * 0.5})`;
                          return (
                            <td 
                              key={FEATURE_META[j].key} 
                              className="p-1.5 border-b border-slate-50 text-center font-semibold tabular-nums"
                              style={{ backgroundColor: i === j ? 'rgba(0,0,0,0.03)' : color, color: intensity > 0.6 ? '#1e293b' : '#64748b' }}
                            >
                              {val.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AnalysisCard>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-100/50 bg-white p-7 shadow-sm ring-1 ring-slate-100/10">
      <div className="flex items-center gap-2 text-slate-300 mb-4">
        {icon}
        <div className="text-[10px] font-bold uppercase tracking-[0.2em]">{title}</div>
      </div>
      <div className="text-3xl font-semibold text-slate-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-2 text-xs text-slate-400 font-medium truncate">{subtitle}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-slate-100 bg-slate-50/70 px-4 py-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

function AnalysisCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-none shadow-sm ring-1 ring-slate-100/20 bg-white rounded-[2rem]">
      <CardHeader className="border-b border-slate-50 bg-white px-10 py-8">
        <CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle>
        <CardDescription className="text-xs text-slate-400">{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-10">
        {children}
      </CardContent>
    </Card>
  );
}
