import { saveAs } from 'file-saver';
import { type ReactNode, useCallback } from 'react';
import styles from './InfoBar.module.css';
import { SliderInput } from './SliderInput.tsx';
import { parcelFiltersChanged } from './actions.ts';
import { assertIsDefined } from './assert.ts';
import settings from './settings.ts';
import {
  type Zoning,
  getAreaFiltersState,
  getOwners,
  getParcelStats,
  getParcels,
  getZonings,
  useAppStore,
} from './store.ts';
import { fillTemplate } from './template.ts';
import { getWorkbook } from './xlsx.ts';

const ZoningSection = ({ zoning }: { zoning: Zoning }) => {
  // to refresh if parcel infos are loaded
  useAppStore((state) => state.parcelInfosTimestamp);
  return (
    <div className={styles.section}>
      <h3>Katastrální území {zoning.title}</h3>
      <div>Celkem parcel: {Object.values(zoning.parcels).length}</div>
      <ul>
        {zoning.parcels.map((parcel) => {
          const parcelKnId = parcel.id;
          const parcelLabel = parcel.label;
          const titleDeed = parcel.titleDeed;
          let parcelLabelJsx: ReactNode = <>č. p. {parcelLabel}</>;
          if (settings.parcelInfoUrlTemplate != null) {
            const parcelInfoUrl = fillTemplate(settings.parcelInfoUrlTemplate, {
              parcelKnId,
            });
            parcelLabelJsx = (
              <a href={parcelInfoUrl} target="blank">
                {parcelLabelJsx}
              </a>
            );
          }
          let titleDeedJsx: ReactNode | null = null;
          if (titleDeed != null) {
            titleDeedJsx = `, LV ${titleDeed.number}`;
            if (settings.titleDeedInfoUrlTemplate != null) {
              const titleDeedId = titleDeed.id;
              const titleDeedUrl = fillTemplate(
                settings.titleDeedInfoUrlTemplate,
                { titleDeedId },
              );
              titleDeedJsx = [
                ', ',
                <a
                  key="link"
                  href={titleDeedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  LV {titleDeed.number}
                </a>,
              ];
            }
          }
          return (
            <li key={parcelKnId}>
              {parcelLabelJsx}
              {titleDeedJsx}
              {titleDeed != null
                ? [
                    ', ',
                    titleDeed.owners.map((owner, idx) => {
                      let ownerJsx: ReactNode = owner.label;
                      if (settings.ownerInfoUrlTemplate != null) {
                        const ownerUrl = fillTemplate(
                          settings.ownerInfoUrlTemplate,
                          { ownerId: owner.id },
                        );
                        ownerJsx = (
                          <a
                            key={owner.id}
                            href={ownerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {ownerJsx}
                          </a>
                        );
                      }
                      return [idx > 0 && ', ', ownerJsx];
                    }),
                  ]
                : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const ParcelsSection = () => {
  const parcels = useAppStore(getParcels);
  const zonings = useAppStore(getZonings);
  const owners = useAppStore(getOwners);

  let content: ReactNode = null;
  if (parcels == null) {
    content = <div>Načítá se ...</div>;
  } else {
    content = (
      <div>
        Celkem parcel: {Object.values(parcels).length}{' '}
        <button
          type="button"
          onClick={async () => {
            assertIsDefined(zonings);
            assertIsDefined(owners);
            const workbook = getWorkbook({
              zonings: Object.values(zonings),
              owners,
            });
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            saveAs(blob, 'parcely.xlsx');
          }}
        >
          Stáhnout parcely
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.section}>
        <h3>Dotčené parcely</h3>
        {content}
      </div>
      {Object.values(zonings || {}).map((zoning) => {
        return <ZoningSection key={zoning.id} zoning={zoning} />;
      })}
    </>
  );
};

const FilterSection = () => {
  const areaFiltersState = useAppStore(getAreaFiltersState);
  const parcelStats = useAppStore(getParcelStats);
  const parcelFilters = useAppStore((state) => state.parcelFilters);
  const processedParcels = useAppStore((state) => state.processedParcels);
  const parcels = useAppStore((state) => state.parcels);

  const maxCoveredAreaM2Cb = useCallback((value: number | string) => {
    parcelFiltersChanged({
      maxCoveredAreaM2:
        typeof value === 'string' ? Number.parseInt(value) : value,
    });
  }, []);
  const maxCoveredAreaPercCb = useCallback((value: number | string) => {
    parcelFiltersChanged({
      maxCoveredAreaPerc:
        typeof value === 'string' ? Number.parseInt(value) : value,
    });
  }, []);
  let content: React.ReactElement | null;
  if (areaFiltersState == null) {
    assertIsDefined(parcels);
    content = (
      <div>
        Počítám velikosti překryvů ... {processedParcels || 0}/
        {Object.values(parcels).length} parcel zpracováno
      </div>
    );
  } else {
    assertIsDefined(parcelStats.maxCoveredAreaM2);
    content = (
      <>
        <SliderInput
          value={parcelFilters.maxCoveredAreaM2}
          maxValue={parcelStats.maxCoveredAreaM2}
          label="Maximální překrytí parcely v m2"
          onChange={maxCoveredAreaM2Cb}
        />
        <SliderInput
          value={parcelFilters.maxCoveredAreaPerc}
          maxValue={100}
          label="Maximální překrytí parcely v % rozlohy parcely"
          onChange={maxCoveredAreaPercCb}
        />
      </>
    );
  }
  return (
    <div className={styles.section}>
      <h3>Filtry parcel</h3>
      {content}
    </div>
  );
};

const InfoBar = () => {
  const fileName = useAppStore((state) => state.fileName);
  const areaFiltersState = useAppStore(getAreaFiltersState);

  return (
    <div id="infoBar" className={styles.container}>
      {!fileName ? (
        <div className={styles.section}>
          <h3>Vítejte</h3>
          <p>
            Začněte tím, že soubor *.geojson přetáhnete nad mapu (drag & drop).
          </p>
          <p>
            Aplikace podporuje soubory *.geojson s plošnými prvky (polygony,
            multipolygony) v souřadnicovém systému S-JTSK (EPSG:5514).
          </p>
        </div>
      ) : (
        <div className={styles.section}>
          <h3>Zobrazený soubor</h3>
          <div>{fileName}</div>
        </div>
      )}
      {areaFiltersState === false ? null : <FilterSection />}
      {fileName ? <ParcelsSection /> : null}
    </div>
  );
};

export default InfoBar;
