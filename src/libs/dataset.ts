import Papa from "papaparse";
import type {Feature, FeatureCollection, GeoJsonProperties, Point} from "geojson";

export type BaseDataset<TType extends string, TData> = {
  readonly id: string;
  readonly name: string;
  readonly type: TType;
  readonly createdAt: number;
  readonly data: TData;
};

export type CsvDataset = BaseDataset<
  "csv",
  {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  }
>;

export type Dataset = CsvDataset;

export type PointGeometryMapping = {
  readonly type: "Point";
  readonly coordinates: readonly [string, string];
};

export type DatasetWorkspace = {
  get(id: string): Dataset | undefined;

  readonly csv: {
    toGeoJSON(
      dataset: CsvDataset,
      geometry: PointGeometryMapping
    ): FeatureCollection<Point>;
  };
};

export const DATASET_TYPE_REFERENCE = `type BaseDataset<TType extends string, TData> = {
  readonly id: string;
  readonly name: string;
  readonly type: TType;
  readonly createdAt: number;
  readonly data: TData;
};

type CsvDataset = BaseDataset<
  "csv",
  {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  }
>;

type Dataset = CsvDataset;

type PointGeometryMapping = {
  readonly type: "Point";
  readonly coordinates: readonly [string, string];
};

type DatasetWorkspace = {
  get(id: string): Dataset | undefined;

  readonly csv: {
    toGeoJSON(
      dataset: CsvDataset,
      geometry: PointGeometryMapping
    ): FeatureCollection<Point>;
  };
};`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isStringMatrix(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(isStringArray);
}

export function parseStoredDataset(value: unknown): Dataset | undefined {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.createdAt !== "number"
  ) {
    return undefined;
  }

  switch (value.type) {
    case "csv": {
      if (
        !isRecord(value.data)
        || !isStringArray(value.data.columns)
        || !isStringMatrix(value.data.rows)
      ) {
        return undefined;
      }
      return value as CsvDataset;
    }
    default:
      return undefined;
  }
}

export function parseCsv(csvText: string): CsvDataset["data"] {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0) {
    const details = result.errors.map(error => error.message).join("; ");
    throw new Error(`Could not parse CSV: ${details}`);
  }

  const [header, ...rows] = result.data;
  const columns = header?.map(column => column.trim()) ?? [];
  if (columns.length === 0 || columns.every(column => column === "")) {
    throw new Error("Could not parse CSV: the file does not contain a valid header");
  }

  return {columns, rows};
}

export function csvDatasetToGeoJSON(
  dataset: CsvDataset,
  mapping: PointGeometryMapping
): FeatureCollection<Point> {
  const [longitudeColumn, latitudeColumn] = mapping.coordinates;
  const longitudeIndex = dataset.data.columns.indexOf(longitudeColumn);
  const latitudeIndex = dataset.data.columns.indexOf(latitudeColumn);

  if (longitudeIndex === -1) {
    throw new Error(`CSV coordinate column '${longitudeColumn}' does not exist`);
  }
  if (latitudeIndex === -1) {
    throw new Error(`CSV coordinate column '${latitudeColumn}' does not exist`);
  }

  const features: Feature<Point>[] = [];
  for (const row of dataset.data.rows) {
    const longitudeText = row[longitudeIndex];
    const latitudeText = row[latitudeIndex];
    if (
      longitudeText === undefined
      || latitudeText === undefined
      || longitudeText.trim() === ""
      || latitudeText.trim() === ""
    ) {
      continue;
    }

    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      continue;
    }

    const properties: GeoJsonProperties = {};
    dataset.data.columns.forEach((column, index) => {
      properties[column] = row[index];
    });
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties,
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

export function createDatasetWorkspace(
  source: Pick<DatasetWorkspace, "get">
): DatasetWorkspace {
  return {
    get: id => source.get(id),
    csv: {
      toGeoJSON: csvDatasetToGeoJSON,
    },
  };
}
