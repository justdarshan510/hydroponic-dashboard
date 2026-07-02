import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Check, FolderArchive, RefreshCw, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  extractMetadataFromImageBlob,
  inferClassLabel,
  recordsToCSV,
  type HydroponicImageRecord,
} from '@/lib/hydroponicMetadata';

interface BatchImageTrainingProps {
  data: HydroponicImageRecord[];
  onDatasetGenerated: (records: HydroponicImageRecord[]) => void;
  onFilenameChange: (filename: string) => void;
}

interface PreviewImage {
  filename: string;
  url: string;
  classLabel: string;
}

export function BatchImageTraining({
  data,
  onDatasetGenerated,
  onFilenameChange,
}: BatchImageTrainingProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;

    const file = e.target.files[0];
    setIsUploading(true);
    setProgress(8);

    try {
      const zip = await JSZip.loadAsync(file);
      const imageEntries = Object.entries(zip.files).filter(
        ([path, fileData]) => !fileData.dir && /\.(jpg|jpeg|png|webp)$/i.test(path),
      );

      const records: HydroponicImageRecord[] = [];
      const previews: PreviewImage[] = [];

      for (let index = 0; index < imageEntries.length; index++) {
        const [path, fileData] = imageEntries[index];
        const blob = await fileData.async('blob');
        const filename = path.split('/').pop() || `image_${index + 1}.png`;
        const metadata = await extractMetadataFromImageBlob(blob, filename, path);

        records.push(metadata);

        if (previews.length < 12) {
          previews.push({
            filename,
            url: URL.createObjectURL(blob),
            classLabel: metadata.Class_Label,
          });
        }

        setProgress(10 + ((index + 1) / imageEntries.length) * 85);
      }

      onDatasetGenerated(records);
      onFilenameChange(`${file.name.replace(/\.zip$/i, '')}_metadata.csv`);
      setPreviewImages(previews);
      setIsReady(true);
      setProgress(100);
    } catch (error) {
      console.error('Failed to process ZIP:', error);
      alert('Failed to process the ZIP file. Please check that it contains readable images.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleLocalSync = async () => {
    setIsUploading(true);
    setIsReady(false);
    setProgress(5);

    try {
      const response = await fetch('/api/dataset/local-files');
      if (!response.ok) throw new Error('Failed to connect to local sync API');
      
      const { files } = await response.json() as { files: { path: string, category: string }[] };
      if (!files.length) {
        alert("No images found in your local plant-health/ folders. Please add .jpg or .png images there first.");
        return;
      }

      const records: HydroponicImageRecord[] = [];
      const previews: PreviewImage[] = [];
      const CHUNK_SIZE = 8; // Process in small batches for stability

      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        
        await Promise.all(chunk.map(async (fileInfo) => {
          try {
            const res = await fetch(fileInfo.path);
            const blob = await res.blob();
            const filename = fileInfo.path.split('/').pop() || 'image.png';
            const metadata = await extractMetadataFromImageBlob(blob, filename, fileInfo.path);
            
            // Keep explicit healthy folder labels, otherwise preserve filename/path inference.
            if (fileInfo.category === 'Healthy') {
              const healthyClass = inferClassLabel(fileInfo.category);
              metadata.Class_Label = healthyClass.label;
              metadata.Class_Index = healthyClass.index;
            }
            
            records.push(metadata);

            if (previews.length < 12) {
              previews.push({
                filename,
                url: URL.createObjectURL(blob),
                classLabel: metadata.Class_Label,
              });
            }
          } catch (err) {
            console.warn(`Skipping file ${fileInfo.path} due to load error`);
          }
        }));

        setProgress(10 + ((Math.min(i + CHUNK_SIZE, files.length)) / files.length) * 85);
      }

      onDatasetGenerated(records);
      onFilenameChange(`local_sync_${new Date().toISOString().split('T')[0]}.csv`);
      setPreviewImages(previews);
      setIsReady(true);
      setProgress(100);
    } catch (error) {
      console.error('Local sync failed:', error);
      alert('Local synchronization failed. Ensure your server is running and images are in the plant-health directory.');
    } finally {
      setIsUploading(false);
    }
  };

  const classDistribution = useMemo(() => {
    return Array.from(
      data.reduce((map, record) => {
        map.set(record.Class_Label, (map.get(record.Class_Label) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    );
  }, [data]);

  const downloadCsv = () => {
    if (!data.length) return;
    const csv = recordsToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hydroponic_image_metadata.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-12 animate-in slide-in-from-bottom-4 duration-700 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-4">
          <h2 className="text-4xl font-bold tracking-tight text-slate-900">Synthetic Metadata Generator</h2>
          <p className="text-lg text-slate-500 max-w-2xl leading-relaxed">
            Generate industrial-grade feature metadata from plant image archives. Extract luminance, coverage, and spectral indices in bulk.
          </p>
        </div>
        {data.length > 0 && (
          <Button onClick={downloadCsv} className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl px-8 h-12 shadow-lg transition-all active:scale-95">
             <Upload className="mr-2 h-4 w-4 rotate-180" />
            Export Metadata.csv
          </Button>
        )}
      </div>

      {!isReady ? (
        <label htmlFor="zip-upload" className="block group cursor-pointer">
          <Card className="border-2 border-dashed border-slate-200 bg-white transition-all hover:bg-slate-50/50 hover:border-slate-300 rounded-[2.5rem] p-16">
            <div className="flex flex-col items-center justify-center text-center space-y-6">
              <div className="rounded-full bg-slate-50 p-6 group-hover:scale-110 transition-transform duration-300">
                <FolderArchive className="h-12 w-12 text-slate-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Process Image Dataset</h3>
                <p className="text-slate-500 font-medium">Drop your `.zip` archive here to begin extraction.</p>
              </div>

              {isUploading ? (
                <div className="w-full max-w-xs space-y-4">
                  <Progress value={progress} className="h-1.5 bg-slate-100" />
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Parsing Archive... {Math.round(progress)}%</p>
                </div>
              ) : (
                <div className="pt-4">
                  <input id="zip-upload" type="file" accept=".zip" className="hidden" onChange={handleUpload} />
                  <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
                    <div 
                      onClick={() => document.getElementById('zip-upload')?.click()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-8 py-3.5 text-sm font-semibold text-slate-900 shadow-sm transition-all hover:bg-slate-50 active:scale-95 cursor-pointer"
                    >
                      <Upload className="h-4 w-4" />
                      Select ZIP Dataset
                    </div>
                    
                    <div 
                      onClick={(e) => {
                        e.preventDefault();
                        handleLocalSync();
                      }}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-8 py-3.5 text-sm font-semibold text-white shadow-xl transition-all hover:bg-slate-800 active:scale-95 cursor-pointer"
                    >
                      <RefreshCw className={cn("h-4 w-4", isUploading && "animate-spin")} />
                      Sync Local Storage
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </label>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[2rem] bg-emerald-50/50 border border-emerald-100 p-8 flex flex-col md:flex-row items-center gap-6">
            <div className="h-14 w-14 rounded-full bg-emerald-500 shadow-lg shadow-emerald-200 flex items-center justify-center text-white shrink-0">
              <Check className="h-6 w-6" />
            </div>
            <div className="flex-1 text-center md:text-left space-y-1">
              <p className="text-xl font-bold text-emerald-900">Success: Processing Complete</p>
              <p className="text-emerald-700/80 font-medium">Mapped {data.length} specimens into dynamic feature space.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {classDistribution.map(([label, count]) => (
                <Badge key={label} className="bg-white text-emerald-700 border-none shadow-sm px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {label}: {count}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard title="Total records" value={String(data.length)} subtitle="Processed from ZIP" />
            <StatCard title="Labeled" value={String(data.filter((record) => record.Class_Label !== 'Unknown').length)} subtitle="Classified samples" />
            <StatCard title="Avg Green" value={`${(data.reduce((sum, record) => sum + record.Green_Coverage_Pct, 0) / Math.max(data.length, 1)).toFixed(1)}%`} subtitle="Lushness index" />
            <StatCard title="Avg Contrast" value={(data.reduce((sum, record) => sum + record.Contrast, 0) / Math.max(data.length, 1)).toFixed(1)} subtitle="Feature sharpness" />
          </div>

          <Card className="overflow-hidden border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-[2rem]">
            <CardHeader className="p-8 border-b border-slate-50">
              <CardTitle className="text-base font-semibold text-slate-800 text-center md:text-left">Sampled Extraction Previews</CardTitle>
            </CardHeader>
            <CardContent className="p-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {previewImages.map((image, index) => (
                  <div key={`${image.filename}-${index}`} className="group space-y-3">
                    <div className="aspect-square overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 transition-all group-hover:shadow-md">
                      <img src={image.url} alt={image.filename} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    </div>
                    <div className="space-y-1">
                      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400" title={image.filename}>{image.filename}</p>
                      <Badge className={cn(
                        "text-[10px] px-2 py-0 h-5 border-none",
                        image.classLabel === 'Healthy' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                      )}>
                        {image.classLabel}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-3xl border border-slate-100/50 bg-white p-7 shadow-sm ring-1 ring-slate-100/10">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-4">{title}</div>
      <div className="text-3xl font-semibold text-slate-900 tabular-nums leading-tight">{value}</div>
      <div className="mt-2 text-xs text-slate-400 font-medium truncate">{subtitle}</div>
    </div>
  );
}
