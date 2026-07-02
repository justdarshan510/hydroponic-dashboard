import Papa from 'papaparse';
import {
  createDefaultHydroponicDataset,
  inferClassLabel,
  type HydroponicImageRecord,
} from './hydroponicMetadata';
import defaultMetadataCsv from './metadata.csv?raw';

export const parseCSV = (csvText: string): HydroponicImageRecord[] => {
  const trimmed = csvText.trim();
  if (!trimmed) return [];

  const preview = Papa.parse(trimmed, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!preview.data || preview.data.length === 0) return [];

  return (preview.data as Record<string, unknown>[])
    .map((row) => {
      const imageId = String(row.Image_ID ?? row.File_Name ?? '').trim();
      const sourcePath = String(row.Source_Path ?? row.Source_Folder ?? row.File_Name ?? imageId).trim();
      const classSource = String(row.Class_Label ?? row.Source_Folder ?? row.File_Name ?? imageId);
      const inferred = inferClassLabel(classSource);

      const meanR = Number(row.Mean_R ?? row.Avg_Red ?? 0);
      const meanG = Number(row.Mean_G ?? row.Avg_Green ?? 0);
      const meanB = Number(row.Mean_B ?? row.Avg_Blue ?? 0);
      const brightness = Number(row.Brightness ?? 0);
      const greenCoverage = Number(
        row.Green_Coverage_Pct ?? (row.Green_Pixel_Ratio !== undefined ? Number(row.Green_Pixel_Ratio) * 100 : 0),
      );
      const leafAreaRatio = Number(
        row.Leaf_Area_Ratio ??
          (row.Leaf_Area_Pixels !== undefined && row.Width !== undefined && row.Height !== undefined
            ? Number(row.Leaf_Area_Pixels) / (Number(row.Width) * Number(row.Height))
            : 0),
      );

      return {
        Image_ID: imageId,
        Source_Path: sourcePath,
        Class_Label: inferred.label,
        Class_Index: inferred.index,
        Mean_R: meanR,
        Mean_G: meanG,
        Mean_B: meanB,
        Brightness: brightness,
        Hue_Deg: Number(row.Hue_Deg ?? 0),
        Saturation_Pct: Number(row.Saturation_Pct ?? 0),
        Green_Coverage_Pct: greenCoverage,
        Excess_Green_Index: Number(row.Excess_Green_Index ?? (2 * meanG - meanR - meanB)),
        Contrast: Number(row.Contrast ?? 0),
        Edge_Density: Number(row.Edge_Density ?? 0),
        Leaf_Area_Ratio: leafAreaRatio,
        Homogeneity: Number(row.Homogeneity ?? 0),
      } satisfies HydroponicImageRecord;
    })
    .filter((record) => record.Image_ID);
};

function mergeDefaultDataset(records: HydroponicImageRecord[]) {
  const seededRecords = createDefaultHydroponicDataset();
  const combined = [...records, ...seededRecords];
  const uniqueById = new Map<string, HydroponicImageRecord>();

  for (const record of combined) {
    const key = `${record.Image_ID}:${record.Class_Label}`;
    if (!uniqueById.has(key)) {
      uniqueById.set(key, record);
    }
  }

  return Array.from(uniqueById.values());
}

export const DEFAULT_PARSED_DATA = mergeDefaultDataset(parseCSV(defaultMetadataCsv));
