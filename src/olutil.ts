import type JstsGeometry from 'jsts/org/locationtech/jts/geom/Geometry.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import JstsPolygon from 'jsts/org/locationtech/jts/geom/Polygon.js';
import OL3Parser from 'jsts/org/locationtech/jts/io/OL3Parser.js';
import JstsBufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import JstsRelatedOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import JstsIsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import { Feature, getUid } from 'ol';
import type { Extent } from 'ol/extent';
import * as olExtent from 'ol/extent';
import WMTSCapabilities from 'ol/format/WMTSCapabilities';
import {
  GeometryCollection,
  LineString,
  LinearRing,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
} from 'ol/geom';
import { fromExtent } from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import type VectorSource from 'ol/source/Vector';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS';
import { assertIsDefined } from './assert.ts';

export const loadTileLayerFromWmtsCapabilities = async ({
  url,
  layer,
  matrixSet,
}: {
  url: string;
  layer: string;
  matrixSet: string;
}): Promise<TileLayer<WMTS>> => {
  const parser = new WMTSCapabilities();

  const capResp = await fetch(url);
  const capString = await capResp.text();
  const result = parser.read(capString);

  const options = optionsFromCapabilities(result, {
    layer: layer,
    matrixSet: matrixSet,
  });
  assertIsDefined(options);

  // biome-ignore lint/suspicious/noExplicitAny: it can be any type
  const layerDef = result?.Contents?.Layer?.find((layerDef: any) => {
    return layerDef?.Identifier === layer;
  });
  assertIsDefined(layerDef);

  const matrixSetDef = result?.Contents?.TileMatrixSet?.find(
    // biome-ignore lint/suspicious/noExplicitAny: it can be any type
    (matrixSetDef: any) => {
      return matrixSetDef?.Identifier === matrixSet;
    },
  );
  assertIsDefined(matrixSetDef);

  const bboxCrs = matrixSetDef?.SupportedCRS as string;

  // biome-ignore lint/suspicious/noExplicitAny: it can be any type
  const bboxDef = layerDef?.BoundingBox?.find((bboxDef: any) => {
    return bboxDef?.crs === bboxCrs;
  });

  const bboxExtent = bboxDef?.extent as Extent;

  const tileLayer = new TileLayer({
    opacity: 1,
    source: new WMTS(options),
    extent: bboxExtent || undefined,
  });
  return tileLayer;
};

export const getMainExtents = ({
  features,
  minExtentRadius,
}: { features: Feature[]; minExtentRadius: number }): Extent[] => {
  const mainExtents: Extent[] = [];

  for (const feature of features) {
    const featureExtent = feature.getGeometry()?.getExtent();
    let newExtent = featureExtent
      ? assertMinExtentRadius({
          extent: featureExtent.concat(),
          minExtentRadius,
        })
      : undefined;
    while (newExtent) {
      const overlappedExtentIdx = mainExtents.findIndex((ext) => {
        // @ts-ignore
        return newExtent !== ext && olExtent.intersects(newExtent, ext);
      });
      if (overlappedExtentIdx >= 0) {
        const overlappedExtent = mainExtents[overlappedExtentIdx];
        if (olExtent.containsExtent(overlappedExtent, newExtent)) {
          newExtent = undefined;
        } else {
          mainExtents.splice(overlappedExtentIdx, 1);
          newExtent = olExtent.extend(overlappedExtent, newExtent);
        }
      } else {
        mainExtents.push(newExtent);
        newExtent = undefined;
      }
    }
  }
  return mainExtents;
};

export const extentsToFeatures = ({
  extents,
}: { extents: Extent[] }): Feature[] => {
  return extents.map((extent) => {
    const polygon = fromExtent(extent);
    const feature = new Feature({
      geometry: polygon,
    });
    return feature;
  });
};

export const assertMinExtentRadius = ({
  extent,
  minExtentRadius,
}: { extent: Extent; minExtentRadius: number }): Extent => {
  const minExtent = olExtent.buffer(
    olExtent.boundingExtent([olExtent.getCenter(extent)]),
    minExtentRadius,
  );

  if (!olExtent.containsExtent(extent, minExtent)) {
    olExtent.extend(extent, minExtent);
  }
  return extent;
};

export const getIntersectedParcels = ({
  parcels,
  featureSource,
}: {
  parcels: Record<string, Feature>;
  featureSource: VectorSource;
}): Feature[] => {
  const featuresByParcel: Record<string, Feature[]> = {};

  const parcelsByExtent = Object.values(parcels).filter((parcel) => {
    const parcelGeom = parcel.getGeometry();
    assertIsDefined(parcelGeom);
    const parcelId = parcel.getId() as string;
    const foundFeatures = featureSource.getFeaturesInExtent(
      parcelGeom.getExtent(),
    );
    if (foundFeatures.length > 0) {
      featuresByParcel[parcelId] = foundFeatures;
    }
    return foundFeatures.length > 0;
  });

  const geometryFactory = new GeometryFactory();
  const parser = new OL3Parser(geometryFactory, undefined);
  parser.inject(
    Point,
    LineString,
    LinearRing,
    Polygon,
    MultiPoint,
    MultiLineString,
    MultiPolygon,
    GeometryCollection,
  );

  const featuresJstsGeoms: Record<string, JstsGeometry> = {};

  const parcelsByGeom = parcelsByExtent.filter((parcel) => {
    const parcelJstsGeom = parser.read(parcel.getGeometry());
    console.assert(parcelJstsGeom instanceof JstsPolygon);
    const parcelId = parcel.getId() as string;
    const parcelFeaturesByExtent = featuresByParcel[parcelId];
    const intersects = parcelFeaturesByExtent.some((feature) => {
      const featureUid = getUid(feature);
      if (!(featureUid in featuresJstsGeoms)) {
        const geom = parser.read(feature.getGeometry());
        featuresJstsGeoms[featureUid] = JstsIsValidOp.isValid(geom)
          ? geom
          : JstsBufferOp.bufferOp(geom, 0);
      }
      const featureJstsGeom = featuresJstsGeoms[featureUid];
      try {
        return JstsRelatedOp.intersects(parcelJstsGeom, featureJstsGeom);
      } catch (e) {
        console.error(
          `Some problem when intersecting ${parcelId} x ${featureUid}`,
        );
        console.error(e);
      }
    });
    return intersects;
  });

  return parcelsByGeom;
};
