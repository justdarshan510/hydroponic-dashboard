
import { useState } from 'react';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Sprout, Activity, Droplets, Thermometer, FlaskConical, Calendar } from "lucide-react";

interface SidebarProps {
  inputs: {
    moisture: number;
    temp: number;
    ec: number;
    ph: number;
    days: number;
  };
  setInputs: React.Dispatch<React.SetStateAction<{
    moisture: number;
    temp: number;
    ec: number;
    ph: number;
    days: number;
  }>>;
}

export function Sidebar({ inputs, setInputs }: SidebarProps) {
  const handleChange = (key: string, value: number[]) => {
    setInputs(prev => ({ ...prev, [key]: value[0] }));
  };

  return (
    <aside className="w-full lg:w-80 shrink-0 space-y-6 p-6 bg-sidebar border-r border-sidebar-border h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-8">
        <div className="p-2 bg-primary rounded-lg">
          <Sprout className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-bold text-xl tracking-tight">PhytoDiagnose</h1>
          <p className="text-xs text-muted-foreground">Plant Health Intelligence</p>
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Parameters</h2>
        <p className="text-xs text-muted-foreground">Adjust environmental inputs for real-time severity prediction.</p>
      </div>

      <Separator />

      <div className="space-y-6">
        
        {/* Moisture */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Droplets className="h-4 w-4 text-blue-500" />
              Soil Moisture
            </Label>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{inputs.moisture}%</span>
          </div>
          <Slider 
            value={[inputs.moisture]} 
            onValueChange={(v) => handleChange('moisture', v)} 
            max={100} step={1} 
            className="[&>.range]:bg-blue-500"
          />
        </div>

        {/* Temp */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Thermometer className="h-4 w-4 text-red-500" />
              Root Zone Temp
            </Label>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{inputs.temp}°C</span>
          </div>
          <Slider 
            value={[inputs.temp]} 
            onValueChange={(v) => handleChange('temp', v)} 
            min={0} max={50} step={0.5} 
          />
        </div>

        {/* EC */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-yellow-600" />
              Substrate EC
            </Label>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{inputs.ec} mS/cm</span>
          </div>
          <Slider 
            value={[inputs.ec]} 
            onValueChange={(v) => handleChange('ec', v)} 
            min={0} max={10} step={0.1} 
          />
        </div>

        {/* pH */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <FlaskConical className="h-4 w-4 text-purple-500" />
              Substrate pH
            </Label>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{inputs.ph}</span>
          </div>
          <Slider 
            value={[inputs.ph]} 
            onValueChange={(v) => handleChange('ph', v)} 
            min={0} max={14} step={0.1} 
          />
        </div>

        {/* Days */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4 text-green-600" />
              Days Since Planting
            </Label>
            <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{inputs.days}</span>
          </div>
          <Slider 
            value={[inputs.days]} 
            onValueChange={(v) => handleChange('days', v)} 
            min={0} max={120} step={1} 
          />
        </div>

      </div>

      <Separator />
      
      <Card className="bg-sidebar-accent/50 border-sidebar-border shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium">System Status</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Model Online (v2.4)
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
