import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Loader2, Upload, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ss from 'simple-statistics';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { REMEDIAL_MEASURES } from '@/lib/mockData';
import { extractMetadataFromImageBlob, type HydroponicImageRecord } from '@/lib/hydroponicMetadata';
import { DEFAULT_PARSED_DATA } from '@/lib/csvData';

import healthyLeaf from '@assets/generated_images/close_up_of_a_healthy_green_plant_leaf.png';
import kDefLeaf from '@assets/generated_images/plant_leaf_showing_potassium_deficiency_symptoms.png';

interface ImageDiagnosticsProps {
  data: HydroponicImageRecord[];
  activeFilename?: string;
}

const FEATURE_FIELDS = [
  { key: 'Mean_R', label: 'red value' },
  { key: 'Mean_G', label: 'green value' },
  { key: 'Mean_B', label: 'blue value' },
  { key: 'Brightness', label: 'brightness' },
  { key: 'Saturation_Pct', label: 'saturation' },
  { key: 'Green_Coverage_Pct', label: 'green area' },
  { key: 'Excess_Green_Index', label: 'excess green index' },
  { key: 'Contrast', label: 'contrast' },
  { key: 'Edge_Density', label: 'edge density' },
  { key: 'Leaf_Area_Ratio', label: 'leaf area ratio' },
  { key: 'Homogeneity', label: 'texture homogeneity' },
] as const;

type FieldKey = (typeof FEATURE_FIELDS)[number]['key'];

interface DiagnosticResult {
  class: string;
  confidence: number;
  explanation: string;
  featureNotes: string[];
  nearestMatch?: string;
}

type SamplePoint = {
  label: string;
  raw: HydroponicImageRecord & { _isGlobal?: boolean };
  values: Record<FieldKey, number>;
};

const IMAGE_CLASSIFIER_LABELS = ['Healthy', 'K Deficiency', 'N Deficiency', 'P Deficiency', 'Fungal Infection'] as const;

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeValue(value: number, mean: number, deviation: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(deviation) || deviation === 0) return value - mean;
  return (value - mean) / deviation;
}

async function imageUrlToBlob(imageUrl: string) {
  const response = await fetch(imageUrl);
  return response.blob();
}

export function ImageDiagnostics({ data, activeFilename }: ImageDiagnosticsProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => {
    // v14.1.0: Sovereign Model Intelligence
    // Always inject the default dataset so global knowledge is never lost.
    const globalData = DEFAULT_PARSED_DATA.map(r => ({ ...r, _isGlobal: true }));

    // v14.1.3 Data Overwrite Fix: 
    // If the user's custom dataset has identical Image_IDs, it overwrites the global data in uniqueMap.
    // We isolate local data by prefixing their IDs, making sovereignty truly un-overwriteable.
    const isCustomDataset = activeFilename && activeFilename !== 'metadata.csv (Default)';
    const localData = isCustomDataset
      ? data.map((r, i) => ({ ...r, Image_ID: `local_${r.Image_ID || i}`, _isGlobal: false }))
      : []; // v14.1.5: Do NOT duplicate the default dataset if custom is NOT active.


    const combinedData = [...globalData, ...localData];
    const uniqueMap = new Map();
    combinedData.forEach(r => uniqueMap.set(r.Image_ID, r));
    const finalData = Array.from(uniqueMap.values());

    const labeledData = finalData.filter(
      (record) =>
        record.Class_Label !== 'Unknown' &&
        IMAGE_CLASSIFIER_LABELS.includes(record.Class_Label as (typeof IMAGE_CLASSIFIER_LABELS)[number]),
    );
    if (labeledData.length < 5) return null;

    const globalLabeled = globalData.filter(
      (record) =>
        record.Class_Label !== 'Unknown' &&
        IMAGE_CLASSIFIER_LABELS.includes(record.Class_Label as (typeof IMAGE_CLASSIFIER_LABELS)[number]),
    );
    if (globalLabeled.length < 5) return null;
    const localLabeled = localData.filter(
      (record) =>
        record.Class_Label !== 'Unknown' &&
        IMAGE_CLASSIFIER_LABELS.includes(record.Class_Label as (typeof IMAGE_CLASSIFIER_LABELS)[number]),
    );

    const statsSource = isCustomDataset && localLabeled.length >= 20 ? localLabeled : globalLabeled;

    const featureStats = Object.fromEntries(
      FEATURE_FIELDS.map(({ key }) => {
        const series = statsSource.map((record) => Number(record[key]));
        return [
          key,
          {
            mean: ss.mean(series),
            deviation: ss.standardDeviation(series) || 1e-6,
          },
        ];
      }),
    ) as Record<FieldKey, { mean: number; deviation: number }>;

    const samples = labeledData.map((record) => ({
      label: record.Class_Label,
      raw: record,
      values: Object.fromEntries(
        FEATURE_FIELDS.map(({ key }) => [
          key,
          normalizeValue(Number(record[key]), featureStats[key].mean, featureStats[key].deviation),
        ]),
      ) as Record<FieldKey, number>,
    }));

    const classFrequencies = labeledData.reduce((map, record) => {
      map.set(record.Class_Label, (map.get(record.Class_Label) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

    const groupedByClass = Array.from(
      samples.reduce((map, sample) => {
        if (!map.has(sample.label)) map.set(sample.label, []);
        map.get(sample.label)?.push(sample);
        return map;
      }, new Map<string, typeof samples>()),
    ) as Array<[string, typeof samples]>;

    const rawGroupedByClass = Array.from(
      labeledData.reduce((map, record) => {
        if (!map.has(record.Class_Label)) map.set(record.Class_Label, []);
        map.get(record.Class_Label)?.push(record);
        return map;
      }, new Map<string, HydroponicImageRecord[]>()),
    ) as Array<[string, HydroponicImageRecord[]]>;

    return {
      featureStats,
      samples,
      classFrequencies,
      localSampleCount: localLabeled.length,
      totalSamples: globalLabeled.length,
      k: Math.min(7, Math.max(5, Math.floor(Math.sqrt(samples.length)))),
      classCentroids: groupedByClass.map(([label, records]) => ({
        label,
        centroid: Object.fromEntries(
          FEATURE_FIELDS.map(({ key }) => [key, ss.mean(records.map((record) => Number(record.values[key])))]),
        ) as Record<FieldKey, number>,
      })),
      rawClassCentroids: rawGroupedByClass.map(([label, records]) => ({
        label,
        centroid: Object.fromEntries(
          FEATURE_FIELDS.map(({ key }) => [key, ss.mean(records.map((record) => Number(record[key])))]),
        ) as Record<FieldKey, number>,
      })),
    };
  }, [data, activeFilename]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploadedFile(file);
    setSelectedImage(URL.createObjectURL(file));
    setResult(null);
  };

  const handleDemoImage = (imageUrl: string) => {
    setUploadedFile(null);
    setSelectedImage(imageUrl);
    setResult(null);
  };

  const analyzeImage = async () => {
    if (!selectedImage || !model) return;

    setIsAnalyzing(true);

    try {
      const blob = uploadedFile ?? await imageUrlToBlob(selectedImage);
      const metadata = await extractMetadataFromImageBlob(
        blob,
        uploadedFile?.name ?? 'demo-image.png',
        uploadedFile?.name ?? selectedImage,
      );

      const normalizedInput = Object.fromEntries(
        FEATURE_FIELDS.map(({ key }) => [
          key,
          normalizeValue(Number(metadata[key]), model.featureStats[key].mean, model.featureStats[key].deviation),
        ]),
      ) as Record<FieldKey, number>;

      const isCustomDataset = activeFilename && activeFilename !== 'metadata.csv (Default)';

      const globalSamples = model.samples.filter(s => (s.raw as any)._isGlobal);
      const localSamples = model.samples.filter(s => !(s.raw as any)._isGlobal);
      const useLocalPrimary = isCustomDataset && model.localSampleCount >= 20;
      const activeSamples = useLocalPrimary && localSamples.length >= 12 ? localSamples : globalSamples;

      const FEATURE_WEIGHTS: Record<string, number> = {
        'Contrast': 2.2,
        'Edge_Density': 1.8,
        'Homogeneity': 1.4,
        'Saturation_Pct': 1.2,
        'Excess_Green_Index': 1.0,
        'Leaf_Area_Ratio': 1.0
      };

      const calcDistance = (sample: typeof globalSamples[0]) =>
        Math.sqrt(
          FEATURE_FIELDS.reduce((acc, { key }) => {
            const weight = FEATURE_WEIGHTS[key] || 1.0;
            return acc + ((normalizedInput[key] - sample.values[key]) ** 2) * weight;
          }, 0)
        );

      const rankedActiveSamples = activeSamples
        .map((sample) => ({
          label: sample.label,
          distance: calcDistance(sample),
          raw: sample.raw,
        }))
        .sort((a, b) => a.distance - b.distance);

      const nearestOverall = rankedActiveSamples[0];
      const nearestMatch = (nearestOverall?.raw.Image_ID ?? '').replace(/^local_/, '');

      const averageTopDistance = (samplesForClass: SamplePoint[], topK: number) => {
        if (!samplesForClass.length) return Number.POSITIVE_INFINITY;
        const distances = samplesForClass
          .map((sample) => calcDistance(sample))
          .sort((a, b) => a - b)
          .slice(0, Math.min(topK, samplesForClass.length));
        return ss.mean(distances);
      };

      let predictedClass = 'Unknown';
      let confidence = 0;
      let matchingNeighbors = 0;

      const nearestNeighbors = rankedActiveSamples.slice(0, model.k);

      const closestLabelNeighbors = nearestNeighbors.reduce((map, neighbor) => {
          map.set(neighbor.label, (map.get(neighbor.label) ?? 0) + 1);
          return map;
        }, new Map<string, number>());

      const weightedVotes = nearestNeighbors.reduce((map, neighbor) => {
        const weight = 1 / (neighbor.distance + 1e-6);
        map.set(neighbor.label, (map.get(neighbor.label) ?? 0) + weight);
        return map;
      }, new Map<string, number>());

      const sortedVotes = Array.from(weightedVotes.entries()).sort((a, b) => b[1] - a[1]);
      const voteWinner = sortedVotes[0]?.[0] ?? 'Unknown';
      matchingNeighbors = closestLabelNeighbors.get(voteWinner) ?? 0;
      const voteTotal = sortedVotes.reduce((sum, [, score]) => sum + score, 0);
      const voteConfidence = voteTotal > 0 ? ((sortedVotes[0]?.[1] ?? 0) / voteTotal) * 100 : 0;

      const centroidRanking = model.classCentroids
        .map((entry: { label: string; centroid: Record<FieldKey, number> }) => ({
          label: entry.label,
          distance: Math.sqrt(
            FEATURE_FIELDS.reduce((acc, { key }) => {
              const weight = FEATURE_WEIGHTS[key] || 1.0;
              return acc + ((normalizedInput[key] - entry.centroid[key]) ** 2) * weight;
            }, 0),
          ),
        }))
        .sort((a, b) => a.distance - b.distance);

      const centroidWinner = centroidRanking[0]?.label ?? 'Unknown';
      const centroidMargin = (centroidRanking[1]?.distance ?? Number.POSITIVE_INFINITY) - (centroidRanking[0]?.distance ?? 0);
      const bestClassDistance = averageTopDistance(
        activeSamples.filter((sample) => sample.label === voteWinner),
        Math.min(5, model.k),
      );
      const secondClassDistance = averageTopDistance(
        activeSamples.filter((sample) => sample.label === (sortedVotes[1]?.[0] ?? 'Unknown')),
        Math.min(5, model.k),
      );
      const classDistanceMargin = secondClassDistance - bestClassDistance;

      // --- Domain Verification Filters ---
      const minDistance = nearestOverall?.distance ?? 0;
      const greenPct = Number(metadata.Green_Coverage_Pct);
      const leafRatio = Number(metadata.Leaf_Area_Ratio);
      const edgeDensity = Number(metadata.Edge_Density);
      const contrast = Number(metadata.Contrast);
      const saturation = Number(metadata.Saturation_Pct);
      const exg = Number(metadata.Excess_Green_Index);
      const homogeneity = Number(metadata.Homogeneity);

      // Heurestically determine if the image is likely NOT a plant leaf.
      // v1.7.1: Relaxed thresholds to accommodate high-quality photography on clean backgrounds.
      // v1.8.7: Nearly disable 'Not a Plant' for custom datasets 
      // to ensure real-world photography is never rejected.
      // v8.0.0 (Industrial Equilibrium) - Balanced Safety & Identification
      let botanyScore = 0;
      const texturePoints = (homogeneity >= 15 && homogeneity <= 85) ? 1 : 0;
      const structurePoints = (edgeDensity >= 0.03 && edgeDensity <= 0.45) ? 1 : 0;
      const colorPoints = (exg > 1.2 && greenPct > 15) ? 1 : 0;
      const spectralPoints = (saturation < 92 && contrast < 210) ? 1 : 0;
      const geometryPoints = (leafRatio > 0.05) ? 1 : 0;

      botanyScore = texturePoints + structurePoints + colorPoints + spectralPoints + geometryPoints;

      // v8.0.0 Balanced Penalties
      if (edgeDensity > 0.55) botanyScore -= 5;   // Very strict mechanical spokes
      if (contrast > 240) botanyScore -= 5;      // Extreme industrial chrome
      if (saturation > 98) botanyScore -= 5;     // Pure neon pigments
      if (homogeneity > 94) botanyScore -= 5;    // Total flat graphics

      // Tier-Aware Equilibrium Logic
      const isVeryCloseMatch = minDistance < 2.2; // Statistical Trust Anchor
      const isNotAPlant = isCustomDataset
        ? (botanyScore < 2 && minDistance > 7.2)
        : (botanyScore < 2 && !isVeryCloseMatch) || (botanyScore < 1);

      // Update Diagnostics Global
      (window as any).__DIAGNOSTIC_METRICS = {
        dist: minDistance.toFixed(2),
        edge: edgeDensity.toFixed(2),
        texture: homogeneity.toFixed(1),
        score: botanyScore,
        isCustom: isCustomDataset ? "YES" : "NO"
      };

      if (isNotAPlant) {
        predictedClass = 'Not a Plant';
      } else {
        const winnersAgree = voteWinner === centroidWinner;
        const hasStrongLocalEvidence =
          voteConfidence >= 42 ||
          (matchingNeighbors >= Math.ceil(model.k / 2) && minDistance < 3.8) ||
          classDistanceMargin > 0.18 ||
          centroidMargin > 0.18;

        predictedClass = voteWinner;
        confidence = round(
          Math.max(
            35,
            Math.min(
              99,
              voteConfidence * 0.75 +
                Math.max(0, 28 - minDistance * 4.2) +
                (winnersAgree ? 8 : 0) +
                Math.max(0, classDistanceMargin * 18),
            ),
          ),
          1,
        );
        matchingNeighbors = closestLabelNeighbors.get(predictedClass) ?? 0;

        if (
          predictedClass === 'Unknown' ||
          (!hasStrongLocalEvidence && minDistance > 4.9) ||
          (voteConfidence < 34 && !winnersAgree && minDistance > 4.2)
        ) {
          predictedClass = 'Unknown';
          confidence = 0;
        }
      }

      if (predictedClass !== 'Unknown' && predictedClass !== 'Not a Plant' && closestLabelNeighbors.get(predictedClass) === 0) {
        predictedClass = 'Unknown';
        confidence = 0;
      }

      const centroid = model.rawClassCentroids.find((entry: { label: string; centroid: Record<FieldKey, number> }) => entry.label === predictedClass)?.centroid;
      const featureNotes = centroid
        ? FEATURE_FIELDS
          .map(({ key, label }) => {
            const value = Number(metadata[key]);
            const delta = round(value - centroid[key], key === 'Green_Coverage_Pct' ? 1 : 2);
            return {
              label,
              delta,
              note: `The image has ${delta >= 0 ? 'higher' : 'lower'} ${label} than the average ${predictedClass} sample by ${Math.abs(delta)}.`,
            };
          })
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          .slice(0, 3)
          .map((entry) => entry.note)
        : isNotAPlant
          ? [
            homogeneity > 58 ? "Digital homogeneity detected. The image appears to be an animated graphic or logo." : "Spectral distribution suggests non-botanical composition.",
            edgeDensity > 0.45 ? "Extreme edge sharpness is statistically consistent with computer-generated graphics." : "Structural analysis indicates synthetic geometry.",
            saturation > 90 ? "Spectral saturation levels indicate uniform digital fill colors." : "Chromatic profile deviates from biological norms."
          ].filter((_, i) => {
            // Only show the most relevant warnings based on what likely triggered isNotAPlant
            if (i === 0) return homogeneity > 50;
            if (i === 1) return edgeDensity > 0.40 || contrast > 90;
            if (i === 2) return saturation > 85;
            return true;
          }).slice(0, 3).length > 0 ? [
            homogeneity > 58 ? "Digital homogeneity detected. The image appears to be an animated graphic or logo." : "Pixel homogeneity suggests a digital illustration rather than a biological specimen.",
            "Extreme edge sharpness is statistically consistent with computer-generated graphics.",
            "Spectral saturation levels indicate uniform digital fill colors."
          ].filter((_, i) => {
            if (i === 0) return homogeneity > 40;
            if (i === 1) return edgeDensity > 0.35 || contrast > 80;
            if (i === 2) return saturation > 85;
            return true;
          }) : [
            "Visual features are outside the expected range for the current plant dataset.",
            "Inference confidence is below the minimum operational threshold.",
            "Image may contain artifacts or low-contrast regions affecting detection."
          ]
          : [];

      const explanation =
        predictedClass === 'Not a Plant'
          ? homogeneity > 45
            ? 'Animated/Digital Specimen Detected: The visual regularity matches vector graphics rather than authentic plant tissue.'
            : 'Digital Artifact Detected: Subject identified as a non-organic specimen (illustration, logo, or icon).'
          : predictedClass === 'Unknown'
            ? 'The uploaded image is plant-like, but it does not match the trained classes strongly enough for a reliable diagnosis.'
            : predictedClass === 'Healthy'
              ? `${matchingNeighbors} of the closest reference samples match Healthy, so this leaf is closer to healthy plant structure than deficiency patterns.`
              : `${matchingNeighbors} of the closest reference samples match ${predictedClass}, so this leaf most closely matches that deficiency pattern.`;

      setResult({
        class: predictedClass,
        confidence: isNotAPlant ? 0 : confidence,
        explanation,
        featureNotes,
        nearestMatch: predictedClass === 'Unknown' || predictedClass === 'Not a Plant' ? undefined : nearestMatch,
      });
    } catch (error) {
      console.error(error);
      setResult({
        class: 'Unknown',
        confidence: 0,
        explanation: 'The image could not be analyzed. Please upload a clearer single-leaf image.',
        featureNotes: [],
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const remedial = result ? REMEDIAL_MEASURES[result.class as keyof typeof REMEDIAL_MEASURES] : null;

  return (
    <div className="mx-auto max-w-6xl space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-10">
      <div className="space-y-4 text-center">
        <h2 className="text-4xl font-bold tracking-tight text-slate-900 flex items-center justify-center gap-3">
          Image Diagnostics
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest text-emerald-500 border-emerald-100 bg-emerald-50/50 px-2">v15.0.0</Badge>
        </h2>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          Visual leaf analysis against your dataset. Upload a plant specimen for real-time deficiency classification and remedial guidance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Card className="border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-[2rem] overflow-hidden">
          <CardHeader className="p-8 pb-4">
            <CardTitle className="text-xl">Image Upload</CardTitle>
            <CardDescription>Support for high-resolution JPG or PNG specimens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 p-8 pt-4">
            <div
              className={`
                cursor-pointer rounded-[1.5rem] border-2 border-dashed p-12 text-center transition-all duration-300
                ${selectedImage ? 'border-primary/40 bg-slate-50/50' : 'border-slate-200 bg-slate-50/10 hover:border-primary/40 hover:bg-slate-50/50'}
              `}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
              />

              {selectedImage ? (
                <div className="group relative aspect-video w-full overflow-hidden rounded-[1rem] shadow-sm">
                  <img src={selectedImage} alt="Preview" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <p className="text-white font-bold text-sm bg-black/40 px-4 py-2 rounded-full">Change Specimen</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 py-10">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100">
                    <Upload className="h-10 w-10 text-slate-300" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-bold text-slate-900">Select plant specimen</p>
                    <p className="text-sm text-slate-400 font-medium">Click or drag image here</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 text-center mb-1">Interactive Demo Cases</div>
              <div className="flex justify-center gap-4">
                <Button variant="outline" className="rounded-xl border-slate-200 bg-white hover:bg-slate-50" size="sm" onClick={() => handleDemoImage(healthyLeaf)}>
                  Case: Healthy
                </Button>
                <Button variant="outline" className="rounded-xl border-slate-200 bg-white hover:bg-slate-50" size="sm" onClick={() => handleDemoImage(kDefLeaf)}>
                  Case: Potassium Def.
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="p-8 pt-0">
            <Button
              className="w-full h-14 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-xl transition-all active:scale-95"
              size="lg"
              onClick={analyzeImage}
              disabled={!selectedImage || isAnalyzing || !model}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                  Processing Features...
                </>
              ) : (
                <>
                  <Camera className="mr-3 h-5 w-5" />
                  Initialize Classification
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-6">
          {isAnalyzing && (
            <Card className="border-primary/20">
              <CardContent className="space-y-4 py-10">
                <div className="mb-2 flex justify-between text-sm font-medium">
                  <span>Comparing image with dataset samples...</span>
                  <span className="text-muted-foreground">78%</span>
                </div>
                <Progress value={78} className="h-2" />
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="h-20 animate-pulse rounded bg-muted delay-75" />
                  <div className="h-20 animate-pulse rounded bg-muted delay-150" />
                  <div className="h-20 animate-pulse rounded bg-muted delay-300" />
                </div>
              </CardContent>
            </Card>
          )}

          {!isAnalyzing && result && (
            <div className="space-y-8 animate-in slide-in-from-right-8 duration-500">
              <Card className="overflow-hidden border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-[2.5rem]">
                <div className={`h-3 w-full ${result.class === 'Healthy' ? 'bg-emerald-400' :
                    result.class === 'Not a Plant' ? 'bg-amber-500' : 'bg-rose-400'
                  }`} />
                <CardHeader className="p-10 pb-6 border-none">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-2xl font-bold">Inference Detail</CardTitle>
                    <Badge className={cn(
                      "px-4 py-1 h-8 text-xs font-bold uppercase tracking-wider rounded-full border-none",
                      result.class === 'Healthy' ? "bg-emerald-50 text-emerald-600" :
                        result.class === 'Not a Plant' ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
                    )}>
                      {result.class === 'Unknown' || result.class === 'Not a Plant' ? 'Domain Mismatch' : `${result.confidence}% Match`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-10 pt-0 space-y-10">
                  {/* v6.0.0 High-Visibility Diagnostic Scoreboard */}
                  <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-50">
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Diagnostic Score</div>
                      <div className="text-2xl font-black text-emerald-500">{(window as any).__DIAGNOSTIC_METRICS?.score ?? '0'}/5 <span className="text-xs font-medium text-slate-300 ml-1 tracking-normal">Botany Pts</span></div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Similarity</div>
                      <div className="text-sm font-mono text-slate-600">{(window as any).__DIAGNOSTIC_METRICS?.dist ?? '0.00'} <span className="text-[10px] text-slate-300">σ</span></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "h-20 w-20 rounded-[2rem] flex items-center justify-center shadow-inner",
                      result.class === 'Healthy' ? "bg-emerald-50" :
                        result.class === 'Not a Plant' ? "bg-amber-50" : "bg-rose-50"
                    )}>
                      {result.class === 'Healthy' ? (
                        <Check className="h-10 w-10 text-emerald-500" />
                      ) : (
                        <AlertTriangle className={cn(
                          "h-10 w-10",
                          result.class === 'Not a Plant' ? "text-amber-500" : "text-rose-500"
                        )} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-5xl font-black tracking-tighter text-slate-900">{result.class}</h3>
                      <p className="text-sm font-medium text-slate-400 leading-relaxed">{result.explanation}</p>
                      {result.nearestMatch && (
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                          Closest trained sample: {result.nearestMatch}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-[2rem]">
                <CardHeader className="px-8 pt-8 pb-4">
                  <CardTitle className="text-base font-bold">Feature Rationalization</CardTitle>
                  <CardDescription>Logical mapping against dataset distribution.</CardDescription>
                </CardHeader>
                <CardContent className="px-8 pb-8">
                  <div className="space-y-3">
                    {result.featureNotes.length > 0 ? (
                      result.featureNotes.map((note) => (
                        <div key={note} className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-xs font-medium text-slate-600 leading-relaxed shadow-sm transition-transform hover:scale-[1.02]">
                          {note}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-slate-50 border border-slate-100 p-8 text-center text-xs font-semibold text-slate-400 italic">
                        No distinct feature outliers detected.
                      </div>
                    )}
                  </div>

                </CardContent>
              </Card>

              {remedial && (
                <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-[2.5rem] overflow-hidden">
                  <div className="bg-slate-900 p-10 text-white">
                    <CardTitle className="text-2xl font-black mb-2 tracking-tight">Industrial Remediation Plan</CardTitle>
                    <CardDescription className="text-slate-400 font-medium">Professional guidance for crop corrective action.</CardDescription>
                  </div>
                  <CardContent className="p-10 pt-8">
                    <div className="space-y-10">
                      <div>
                        <h4 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                          <div className="h-6 w-1 bg-primary rounded-full" />
                          {remedial.title}
                        </h4>
                        <div className="grid gap-4">
                          {remedial.actions.map((action, index) => (
                            <div key={index} className="group flex items-start gap-5 p-6 rounded-[1.5rem] bg-slate-50 transition-all hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 text-sm font-bold text-primary group-hover:scale-110 transition-transform">
                                {index + 1}
                              </span>
                              <span className="text-sm font-medium text-slate-600 leading-relaxed pt-2">{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {!isAnalyzing && !result && (
            <div className="flex h-full min-h-[500px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-slate-100 p-12 text-center bg-slate-50/20">
              <Camera className="mb-8 h-24 w-24 text-slate-200" />
              <h3 className="text-2xl font-bold text-slate-900">System Ready for Diagnosis</h3>
              <p className="max-w-xs mt-3 text-slate-400 font-medium">Upload a plant specimen image on the left to begin holographic feature mapping.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
