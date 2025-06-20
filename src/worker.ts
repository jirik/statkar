import { GeoJSON } from 'ol/format';
import type { GeoJSONFeatureCollection } from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import {
  type ParcelAreas,
  ParcelCoveredAreaM2PropName,
  ParcelCoveredAreaPercPropName,
  getIntersectedParcels,
  getParcelsByFeatureExtent,
  setParcelIntersections,
} from './olutil.ts';

export type IncomingMessage = {
  features: GeoJSONFeatureCollection;
  parcels: GeoJSONFeatureCollection;
};

export type OutgoingMessage =
  | {
      type: 'coveredParcels';
      parcels: GeoJSONFeatureCollection;
    }
  | {
      type: 'parcelAreasProgress';
      processedParcels: number;
    }
  | {
      type: 'parcelAreas';
      parcelAreas: Record<string, ParcelAreas>;
    };

self.onmessage = async (event) => {
  const data: IncomingMessage = event.data;
  const format = new GeoJSON();
  const features = format.readFeatures(data.features);
  const parcels = format.readFeatures(data.parcels);

  const featureSource = new VectorSource({
    features,
  });

  const { parcelsByExtent, featuresByParcel } = getParcelsByFeatureExtent({
    parcels,
    featureSource,
  });
  const coveredParcels = getIntersectedParcels({
    parcelsByExtent,
    featuresByParcel,
  });

  const coveredParcelsGeojson: GeoJSONFeatureCollection =
    format.writeFeaturesObject(coveredParcels);

  self.postMessage({
    type: 'coveredParcels',
    parcels: coveredParcelsGeojson,
  } satisfies OutgoingMessage);

  const progress = setParcelIntersections({
    parcels: coveredParcels,
    featuresByParcel,
  });
  const numParcels = coveredParcels.length;
  let processedParcels = 0;
  while (processedParcels < numParcels) {
    self.postMessage({
      type: 'parcelAreasProgress',
      processedParcels,
    } satisfies OutgoingMessage);
    processedParcels = progress.next().value;
  }
  const parcelAreas = coveredParcels.reduce(
    (prev: Record<string, ParcelAreas>, parcel) => {
      const id = parcel.getId() as number;
      prev[id] = {
        coveredAreaM2: parcel.get(ParcelCoveredAreaM2PropName) as number,
        coveredAreaPerc: parcel.get(ParcelCoveredAreaPercPropName) as number,
      };
      return prev;
    },
    {},
  );

  self.postMessage({
    type: 'parcelAreas',
    parcelAreas,
  } satisfies OutgoingMessage);
};
