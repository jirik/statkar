import type { Feature } from 'ol';
import type VectorSource from 'ol/source/Vector';
import { createSelector } from 'reselect';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { MIN_FEATURE_EXTENT_RADIUS } from '../constants.ts';
import { assertIsDefined } from './assert.ts';
import * as olUtil from './olutil.ts';
import { extentsToFeatures, getIntersectedParcels } from './olutil.ts';

interface State {
  fileName: string | null;
  features: Feature[];
  parcels: Record<string, Feature> | null;
  highlightedParcel: string | null;
  highlightedFeature: number | null;
}

interface Actions {
  fileOpened: ({
    name,
    features,
  }: { name: string; features: Feature[] }) => void;
  parcelsLoaded: ({
    parcels,
    featureSource,
  }: { parcels: Feature[][]; featureSource: VectorSource }) => void;
  mapPointerMove: ({
    highlightedParcel,
    highlightedFeature,
  }: {
    highlightedParcel?: Feature | null;
    highlightedFeature?: Feature | null;
  }) => void;
}

export const useAppStore = create<State & Actions>()(
  immer((set) => ({
    fileName: null,
    features: [],
    parcels: null,
    highlightedParcel: null,
    highlightedFeature: null,
    fileOpened: ({ name, features }: { name: string; features: Feature[] }) =>
      set((state) => {
        state.fileName = name;
        state.features = features;
        state.parcels = null;
      }),
    parcelsLoaded: ({
      parcels,
      featureSource,
    }: { parcels: Feature[][]; featureSource: VectorSource }) =>
      set((state) => {
        const parcelsDict: Record<string, Feature> = {};
        for (const parcelGroup of parcels) {
          for (const parcel of parcelGroup) {
            const parcelId = parcel.getId();
            if (typeof parcelId === 'string' && !(parcelId in parcelsDict)) {
              parcelsDict[parcelId] = parcel;
            }
          }
        }
        const intersectedParcels = getIntersectedParcels({
          parcels: parcelsDict,
          featureSource,
        });
        state.parcels = intersectedParcels.reduce(
          (prev: Record<string, Feature>, parcel) => {
            const parcelId = parcel.getId() as string;
            prev[parcelId] = parcel;
            return prev;
          },
          {},
        );
      }),
    mapPointerMove: ({
      highlightedParcel,
      highlightedFeature,
    }: {
      highlightedParcel?: Feature | null;
      highlightedFeature?: Feature | null;
    }) =>
      set((state) => {
        state.highlightedParcel =
          (highlightedParcel?.getId() as string) || null;
        const featureFid = highlightedFeature?.get('fid');
        state.highlightedFeature =
          typeof featureFid === 'number' ? featureFid : null;
      }),
  })),
);

const createAppSelector = createSelector.withTypes<State>();

export const getMainExtents = createAppSelector(
  [(state) => state.features],
  (features) => {
    const mainExtents = olUtil.getMainExtents({
      features,
      minExtentRadius: MIN_FEATURE_EXTENT_RADIUS, // meters
    });
    return mainExtents;
  },
);

export const getMainExtentFeatures = createAppSelector(
  [getMainExtents],
  (mainExtents) => {
    const extentFeatures = extentsToFeatures({ extents: mainExtents });
    return extentFeatures;
  },
);

export type Zoning = {
  id: string;
  title: string;
  parcels: Feature[];
};

export const getParcelsByZoning = createAppSelector(
  [(state) => state.parcels],
  (parcels) => {
    const zonings: Record<string, Zoning> = {};
    for (const parcel of Object.values(parcels || {})) {
      const zoningUrl = parcel.get('zoning')['xlink:href'] as string;
      const zoningTitle = parcel.get('zoning')['xlink:title'] as string;
      const zoningId = URL.parse(zoningUrl)?.searchParams.get('Id');
      assertIsDefined(zoningId);
      if (!(zoningId in zonings)) {
        zonings[zoningId] = {
          id: zoningId,
          title: zoningTitle,
          parcels: [],
        };
      }
      zonings[zoningId].parcels.push(parcel);
    }
    for (const zoning of Object.values(zonings)) {
      zoning.parcels.sort((a, b) => {
        const aParts = (a.get('label') as string)
          .split(/\D+/)
          .map((s) => Number.parseInt(s));
        const bParts = (b.get('label') as string)
          .split(/\D+/)
          .map((s) => Number.parseInt(s));
        return aParts[0] - bParts[0] || aParts[1] - bParts[1];
      });
    }
    return zonings;
  },
);
