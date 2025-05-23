import 'ol/ol.css';
import './App.css';
import type { FeatureLike } from 'ol/Feature';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import * as olExtent from 'ol/extent';
import { GeoJSON } from 'ol/format';
import type { Geometry } from 'ol/geom';
import { fromExtent } from 'ol/geom/Polygon';
import { DragAndDrop } from 'ol/interaction';
import VectorLayer from 'ol/layer/Vector';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import { register } from 'ol/proj/proj4';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import proj4 from 'proj4';
import { useEffect, useRef } from 'react';
import { MIN_MAIN_EXTENT_RADIUS_PX } from '../constants.ts';
import InfoBar from './InfoBar.tsx';
import { assertFeature, assertFeatures, assertIsDefined } from './assert.ts';
import { getParcelsByExtent, parcelsGmlToFeatures } from './cuzk.ts';
import {
  assertMinExtentRadius,
  loadTileLayerFromWmtsCapabilities,
} from './olutil.ts';
import { getMainExtentFeatures, getMainExtents, useAppStore } from './store.ts';

proj4.defs(
  'EPSG:5514',
  '+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs +type=crs',
);
register(proj4);

const App = () => {
  const fileOpened = useAppStore((state) => state.fileOpened);
  const parcelsLoaded = useAppStore((state) => state.parcelsLoaded);
  const mapPointerMove = useAppStore((state) => state.mapPointerMove);
  const extentFeatures = useAppStore(getMainExtentFeatures);
  const mainExtents = useAppStore(getMainExtents);
  const features = useAppStore((state) => state.features);
  const highlightedParcelId = useAppStore((state) => state.highlightedParcel);
  const highlightedFeatureId = useAppStore((state) => state.highlightedFeature);
  const parcels = useAppStore((state) => state.parcels);
  const mapRef = useRef<OlMap | null>(null);
  const vectorLayerRef = useRef<WebGLVectorLayer | null>(null);
  const vectorExtentLayerRef = useRef<VectorLayer | null>(null);
  const parcelLayerRef = useRef<WebGLVectorLayer | null>(null);

  useEffect(() => {
    (async () => {
      if (mapRef.current) {
        if (!mapRef.current.getTarget()) {
          mapRef.current.setTarget('map');
        }
        return;
      }

      const featureStrokeColor = '#c513cd';

      const vectorLayer = new WebGLVectorLayer({
        source: new VectorSource(),
        style: [
          {
            filter: ['==', ['var', 'highlightedId'], ['get', 'fid']],
            style: {
              'stroke-color': featureStrokeColor,
              'stroke-width': 3,
              'fill-color': 'rgba(255,255,255,0.4)',
            },
          },
          {
            else: true,
            style: {
              'stroke-color': featureStrokeColor,
              'stroke-width': 1,
              'fill-color': 'rgba(255,255,255,0.4)',
            },
          },
        ],
        variables: {
          highlightedId: -1,
        },
      });
      vectorLayerRef.current = vectorLayer;

      const extentStyle = [
        new Style({
          stroke: new Stroke({
            color: '#ffffffaa',
            width: 5,
          }),
          zIndex: 1,
        }),
        new Style({
          stroke: new Stroke({
            color: featureStrokeColor,
            width: 2,
            lineDash: [5, 5],
          }),
          zIndex: 2,
        }),
      ];

      const parcelLayer = new WebGLVectorLayer({
        source: new VectorSource(),
        style: [
          {
            filter: ['==', ['var', 'highlightedId'], ['id']],
            style: {
              'stroke-color': '#ffff00',
              'stroke-width': 4,
              'fill-color': 'rgba(255,255,000,0.4)',
            },
          },
          {
            else: true,
            style: {
              'stroke-color': '#ffff00',
              'stroke-width': 1,
              'fill-color': 'rgba(255,255,000,0.4)',
            },
          },
        ],
        variables: {
          highlightedId: '',
        },
      });
      parcelLayerRef.current = parcelLayer;

      const vectorExtentLayer = new VectorLayer({
        source: new VectorSource(),
        style: extentStyle,
        updateWhileAnimating: true,
        updateWhileInteracting: true,
      });
      vectorExtentLayerRef.current = vectorExtentLayer;

      const map = new OlMap({
        target: 'map',
        layers: [],
        view: new View({
          projection: 'EPSG:5514',
        }),
      });
      mapRef.current = map;

      const tileLayer = await loadTileLayerFromWmtsCapabilities({
        url: 'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/WMTS?request=GetCapabilities',
        layer: 'ORTOFOTO',
        matrixSet: 'default028mm',
      });
      const tileLayer2 = await loadTileLayerFromWmtsCapabilities({
        url: 'https://services.cuzk.cz/wmts/local-km-wmts-jtsk.asp?request=GetCapabilities&service=WMTS',
        layer: 'KN_I',
        matrixSet: 'KN_I',
      });
      const tileLayerExtent = tileLayer.getExtent();
      assertIsDefined(tileLayerExtent);

      map.getView().fit(tileLayerExtent);

      map.addLayer(tileLayer);
      map.addLayer(tileLayer2);
      map.addLayer(parcelLayer);
      map.addLayer(vectorExtentLayer);
      map.addLayer(vectorLayer);

      map.getView().on('change:resolution', (evt) => {
        const view = evt.target as View;
        const resolution = view.getResolution();
        assertIsDefined(resolution);
        const geometryFn = (feature: FeatureLike): Geometry | undefined => {
          const geom = feature.getGeometry();
          const extent = geom?.getExtent();
          assertIsDefined(extent);
          const minExtentRadius = MIN_MAIN_EXTENT_RADIUS_PX * resolution;
          const newExtent = assertMinExtentRadius({
            extent: extent.concat(),
            minExtentRadius,
          });
          return fromExtent(newExtent);
        };
        for (const style of extentStyle) {
          style.setGeometry(geometryFn);
        }
      });
    })();
    return () => {
      if (mapRef.current?.getTarget()) {
        mapRef.current?.setTarget(undefined);
      }
    };
  }, []);

  useEffect(() => {
    assertIsDefined(mapRef.current);
    assertIsDefined(vectorLayerRef.current);
    assertIsDefined(vectorExtentLayerRef.current);
    const map = mapRef.current;
    const dnd = new DragAndDrop({
      formatConstructors: [GeoJSON],
    });
    dnd.on('addfeatures', (event) => {
      const newFeatures = event.features || [];
      assertFeatures(newFeatures);
      fileOpened({ name: event.file.name, features: newFeatures });
    });
    map.addInteraction(dnd);
    return () => {
      map.removeInteraction(dnd);
    };
  }, [fileOpened]);

  useEffect(() => {
    assertIsDefined(mapRef.current);
    assertIsDefined(vectorLayerRef.current);
    assertIsDefined(vectorExtentLayerRef.current);
    assertIsDefined(parcelLayerRef.current);
    const map = mapRef.current;
    const vectorLayer = vectorLayerRef.current;
    const vectorExtentLayer = vectorExtentLayerRef.current;
    const parcelLayer = parcelLayerRef.current;
    const vectorSource = vectorLayer.getSource();
    assertIsDefined(vectorSource);
    const vectorExtentSource = vectorExtentLayer.getSource();
    assertIsDefined(vectorExtentSource);
    const parcelSource = parcelLayer.getSource();
    assertIsDefined(parcelSource);

    // clear features
    vectorSource.clear(true);
    vectorExtentSource.clear(true);
    parcelSource.clear();

    // show features
    vectorSource.addFeatures(features);

    // show feature extents
    vectorExtentSource.addFeatures(extentFeatures);

    // zoom
    const vectorExtent = vectorExtentSource.getExtent();
    if (!olExtent.isEmpty(vectorExtent)) {
      map.getView().fit(vectorExtent, {
        duration: 1000,
        padding: [
          MIN_MAIN_EXTENT_RADIUS_PX * 2,
          MIN_MAIN_EXTENT_RADIUS_PX * 2,
          MIN_MAIN_EXTENT_RADIUS_PX * 2,
          MIN_MAIN_EXTENT_RADIUS_PX * 2,
        ],
      });
    }
  }, [features, extentFeatures]);

  useEffect(() => {
    (async () => {
      assertIsDefined(vectorLayerRef.current);
      const vectorLayer = vectorLayerRef.current;
      const vectorSource = vectorLayer.getSource();
      assertIsDefined(vectorSource);
      if (mainExtents.length > 0) {
        const results = await Promise.all(
          mainExtents.map((e) => getParcelsByExtent({ extent: e })),
        );
        const parcelGroups = results.map((res) =>
          parcelsGmlToFeatures({ gml: res }),
        );
        parcelsLoaded({ parcels: parcelGroups, featureSource: vectorSource });
      } else {
        parcelsLoaded({ parcels: [[]], featureSource: vectorSource });
      }
    })();
  }, [mainExtents, parcelsLoaded]);

  useEffect(() => {
    assertIsDefined(parcelLayerRef.current);
    const parcelLayer = parcelLayerRef.current;
    const parcelSource = parcelLayer.getSource();
    assertIsDefined(parcelSource);
    parcelSource.addFeatures(Object.values(parcels || {}));
  }, [parcels]);

  useEffect(() => {
    assertIsDefined(mapRef.current);
    assertIsDefined(vectorLayerRef.current);
    assertIsDefined(parcelLayerRef.current);
    const map = mapRef.current;
    const vectorLayer = vectorLayerRef.current;
    const parcelLayer = parcelLayerRef.current;

    map.on('pointermove', (evt) => {
      if (evt.dragging) {
        return;
      }
      const pixel = evt.pixel;
      const feature = map.forEachFeatureAtPixel(pixel, (feature) => feature, {
        layerFilter: (l) => l === vectorLayer,
      });
      if (feature) {
        assertFeature(feature);
      }
      const parcel = map.forEachFeatureAtPixel(pixel, (feature) => feature, {
        layerFilter: (l) => l === parcelLayer,
      });
      if (parcel) {
        assertFeature(parcel);
      }
      mapPointerMove({
        highlightedParcel: parcel,
        highlightedFeature: feature,
      });
    });
  }, [mapPointerMove]);

  useEffect(() => {
    assertIsDefined(parcelLayerRef.current);
    const parcelLayer = parcelLayerRef.current;
    parcelLayer.updateStyleVariables({
      highlightedId: highlightedParcelId || '',
    });
  }, [highlightedParcelId]);

  useEffect(() => {
    assertIsDefined(vectorLayerRef.current);
    const vectorLayer = vectorLayerRef.current;
    vectorLayer.updateStyleVariables({
      highlightedId: highlightedFeatureId == null ? -1 : highlightedFeatureId,
    });
  }, [highlightedFeatureId]);
  return (
    <main>
      <div id="map" />
      <InfoBar />
    </main>
  );
};

export default App;
