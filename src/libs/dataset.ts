import Papa from "papaparse";
import type {Feature, FeatureCollection, Point} from "geojson";

export type DatasetValue = string | number | null;
export type DatasetRow = Record<string, DatasetValue>;

export type Dataset = {
  id: string;
  name: string;
  columns: string[];
  rows: DatasetRow[];
  createdAt: number;
};

export type DatasetSummary = Dataset & {
  rowCount: number;
};

export type PointGeometryMapping = {
  type: "Point";
  coordinates: [string, string];
};

export type GeometryMapping = PointGeometryMapping;

export type DatasetWorkspace = {
  list(): DatasetSummary[];
  get(id: string): Dataset | undefined;
  addCsv(name: string, csvText: string): Promise<Dataset>;
  remove(id: string): Promise<void>;
  columns(id: string): string[];
  query(id: string, predicate: (row: DatasetRow) => boolean): DatasetRow[];
  toGeoJSON(id: string, geometry: GeometryMapping): FeatureCollection;
};

export function normalizeColumnName(value: string) {
  return value.trim();
}

export function parseCsv(csvText: string): Pick<Dataset, "columns" | "rows"> {
  const result = Papa.parse<Record<string, DatasetValue>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeColumnName,
    transform: value => value.trim() === "" ? null : value,
  });

  const rows = result.data.map(row => {
    const cleaned: DatasetRow = {};
    for (const [key, value] of Object.entries(row)) {
      cleaned[key] = value;
    }
    return cleaned;
  });

  return {
    columns: result.meta.fields ?? [],
    rows,
  };
}

export function datasetToSummary(dataset: Dataset): DatasetSummary {
  return {
    ...dataset,
    rowCount: dataset.rows.length,
  };
}

export function datasetToGeoJSON(dataset: Dataset, mapping: GeometryMapping): FeatureCollection {
  const [longitudeColumn, latitudeColumn] = mapping.coordinates;
  const features: Feature<Point>[] = [];

  for (const row of dataset.rows) {
    const longitude = Number(row[longitudeColumn]);
    const latitude = Number(row[latitudeColumn]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      continue;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties: {...row},
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

export function queryDataset(dataset: Dataset, predicate: (row: DatasetRow) => boolean): DatasetRow[] {
  return dataset.rows.filter(predicate);
}
