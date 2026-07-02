import { useEffect, useState } from 'react';
import { Calculator, Layers, LayoutDashboard, Menu, ScanLine, Sprout, Network } from 'lucide-react';

import { BatchImageTraining } from '@/components/BatchImageTraining';
import { DatasetDashboard } from '@/components/DatasetDashboard';
import { FeatureAnalysis } from '@/components/FeatureAnalysis';
import { ImageDiagnostics } from '@/components/ImageDiagnostics';
import { ModelPrediction } from '@/components/ModelPrediction';
import { Button } from '@/components/ui/button';
import { DEFAULT_PARSED_DATA, parseCSV } from '@/lib/csvData';
import { type HydroponicImageRecord } from '@/lib/hydroponicMetadata';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'features' | 'predict' | 'batch' | 'classify'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Persistent dataset training state (v1.8.5)
  const [dataset, setDataset] = useState<HydroponicImageRecord[]>(() => {
    try {
      const cached = localStorage.getItem('phyto_dataset');
      return cached ? JSON.parse(cached) : DEFAULT_PARSED_DATA;
    } catch {
      return DEFAULT_PARSED_DATA;
    }
  });
  
  const [filename, setFilename] = useState(() => {
    return localStorage.getItem('phyto_filename') || 'metadata.csv (Default)';
  });

  // Track if we are using the real trained dataset or synthetic defaults
  const isTrained = filename !== 'metadata.csv (Default)' || dataset.length > 60;

  // Persist "training" progress to local storage
  useEffect(() => {
    localStorage.setItem('phyto_dataset', JSON.stringify(dataset));
    localStorage.setItem('phyto_filename', filename);
  }, [dataset, filename]);

  // Auto-Load Custom CSV (v1.8.7): Aggressive detection
  useEffect(() => {
    const loadCustomDataset = async () => {
      try {
        const res = await fetch('/api/dataset/custom-csv');
        if (res.ok) {
          const { content, filename: remoteName } = await res.json();
          const parsed = parseCSV(content);
          if (parsed.length > 0) {
            setDataset(parsed);
            setFilename(remoteName);
            console.log("Auto-loaded industrial dataset:", remoteName);
            // Refresh storage flag
            localStorage.setItem('phyto_dataset', JSON.stringify(parsed));
            localStorage.setItem('phyto_filename', remoteName);
          }
        }
      } catch (e) {
        console.warn("Custom dataset auto-load failed.");
      }
    };
    loadCustomDataset();
  }, []); // Run on startup

  const menuItems = [
    { id: 'dashboard', label: 'Dataset Dashboard', icon: LayoutDashboard, desc: 'Hydroponic Metadata Charts' },
    { id: 'features', label: 'Feature Analysis', icon: Network, desc: 'Advanced ML Metrics' },
    { id: 'predict', label: 'Manual Prediction', icon: Calculator, desc: 'Metadata Feature Input' },
    { id: 'batch', label: 'Model Training', icon: Layers, desc: 'ZIP to CSV Metadata' },
    { id: 'classify', label: 'Image Classifier', icon: ScanLine, desc: 'Diagnostic Tool' },
  ] as const;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          'flex flex-col border-r border-slate-100 bg-white transition-all duration-300',
          isSidebarOpen ? 'w-64' : 'w-[70px]',
        )}
      >
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-xl font-bold text-primary">
            <div className="shrink-0 rounded-lg bg-primary/10 p-2">
              <Sprout className="h-6 w-6" />
            </div>
            {isSidebarOpen && <span className="tracking-tight">PhytoDiagnose</span>}
          </div>
        </div>

        <div className="flex-1 space-y-1 px-4 py-8">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'group relative flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors',
                activeTab === item.id
                  ? 'bg-slate-50 text-slate-900 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:bg-slate-50/50 hover:text-slate-900',
              )}
            >
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0',
                  activeTab === item.id ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600',
                )}
              />

              {isSidebarOpen && (
                <div className="overflow-hidden">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className={cn('text-xs opacity-80 mt-0.5', activeTab === item.id ? 'text-slate-500' : 'text-slate-400')}>
                    {item.desc}
                  </div>
                </div>
              )}

              {!isSidebarOpen && (
                <div className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md group-hover:opacity-100">
                  {item.label}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="p-4">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      <main className="relative flex-1 overflow-auto bg-[#FAFAFA]">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between px-10 pt-4 pb-2 bg-[#FAFAFA]/90 backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{menuItems.find((item) => item.id === activeTab)?.label}</h1>
            <p className="text-xs text-muted-foreground">{filename}</p>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              Engine Status: 
              <span className={cn(
                "font-bold uppercase text-[10px] px-2 py-0.5 rounded-full border",
                isTrained ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
              )}>
                {isTrained ? 'Trained on Local Data' : 'Using Synthetic Defaults'}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            System Status: <span className="font-medium text-green-600">Operational</span>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-10 py-6">
          {activeTab === 'dashboard' && (
            <DatasetDashboard
              data={dataset}
              filename={filename}
              onDataChange={setDataset}
              onFilenameChange={setFilename}
            />
          )}
          {activeTab === 'features' && <FeatureAnalysis data={dataset} />}
          {activeTab === 'predict' && <ModelPrediction data={dataset} />}
          {activeTab === 'batch' && (
            <BatchImageTraining data={dataset} onDatasetGenerated={setDataset} onFilenameChange={setFilename} />
          )}
          {activeTab === 'classify' && <ImageDiagnostics data={dataset} activeFilename={filename} />}
        </div>
      </main>
    </div>
  );
}
