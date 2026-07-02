
import { useMemo } from 'react';
import { MOCK_DATA, PREDICT_SEVERITY, REMEDIAL_MEASURES, RootRotSeverity } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis
} from 'recharts';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface DataAnalysisProps {
  inputs: {
    moisture: number;
    temp: number;
    ec: number;
    ph: number;
    days: number;
  };
}

const COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#b91c1c']; // Green to Red

export function DataAnalysis({ inputs }: DataAnalysisProps) {
  const prediction = PREDICT_SEVERITY(inputs);
  const remedial = REMEDIAL_MEASURES[prediction];

  // Stats Calculations
  const stats = useMemo(() => {
    const grouped = MOCK_DATA.reduce((acc, curr) => {
      acc[curr.Root_Rot_Severity] = (acc[curr.Root_Rot_Severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const pieData = Object.keys(grouped).map(key => ({
      name: key,
      value: grouped[key]
    }));

    const barData = Object.keys(grouped).map(severity => {
      const subset = MOCK_DATA.filter(d => d.Root_Rot_Severity === severity);
      const avgPh = subset.reduce((sum, d) => sum + d.Substrate_pH, 0) / subset.length;
      const avgEc = subset.reduce((sum, d) => sum + d.Substrate_EC_mS_cm, 0) / subset.length;
      return {
        name: severity,
        pH: parseFloat(avgPh.toFixed(2)),
        EC: parseFloat(avgEc.toFixed(2))
      };
    });

    return { pieData, barData };
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Prediction Section */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Real-time Analysis</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 border-l-4" style={{ 
            borderLeftColor: prediction === 'Healthy' ? '#22c55e' : prediction === 'Severe' ? '#b91c1c' : '#eab308' 
          }}>
            <CardHeader>
              <CardTitle className="text-lg">Current Prediction</CardTitle>
              <CardDescription>Based on sidebar inputs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-2" style={{ 
                color: prediction === 'Healthy' ? '#15803d' : prediction === 'Severe' ? '#b91c1c' : '#b45309' 
              }}>
                {prediction}
              </div>
              <p className="text-sm text-muted-foreground">Severity Level</p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                Recommended Action
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="font-medium text-lg">{remedial.title}</div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {remedial.actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Historical Data Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Historical Data Insights</h2>
            <p className="text-muted-foreground">Analysis of synthetic_root_rot_metadata.csv (N=100)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Pie Chart */}
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Severity Distribution</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {stats.pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Bar Chart */}
          <Card className="col-span-1 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Substrate pH & EC by Severity</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.barData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="pH" fill="#8884d8" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="EC" fill="#82ca9d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Scatter Plot */}
          <Card className="col-span-1 md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Soil Moisture vs. Days Since Planting</CardTitle>
              <CardDescription>Color coded by Root Rot Severity</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid />
                  <XAxis type="number" dataKey="Days_Since_Planting" name="Days" unit="d" />
                  <YAxis type="number" dataKey="Soil_Moisture_Percent" name="Moisture" unit="%" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  {stats.pieData.map((entry, index) => (
                    <Scatter 
                      key={entry.name}
                      name={entry.name} 
                      data={MOCK_DATA.filter(d => d.Root_Rot_Severity === entry.name)} 
                      fill={COLORS[index % COLORS.length]} 
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

        </div>
      </section>
    </div>
  );
}

import { Separator } from "@/components/ui/separator";
