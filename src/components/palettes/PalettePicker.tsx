'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import ColorBand from './ColorBand';

export interface PalettePickerOption {
  /** 稳定色板选择值；只作为表单值，不进入可见主文案。 */
  value: string;
  brand: string;
  series: string;
  colors: readonly string[];
  collectedCount: number;
  usableCount: number;
  sourceQuality: string;
  boardProfiles: readonly string[];
  technicalVersion?: string;
  /** 该品牌明确的默认系列；品牌切换不得依赖数组顺序。 */
  defaultForBrand: boolean;
}

interface Props {
  options: readonly PalettePickerOption[];
  value: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function PalettePicker({
  options,
  value,
  onSelect,
  disabled = false,
  className = '',
}: Props) {
  const detailId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  const [brandBrowse, setBrandBrowse] = useState<{
    brand: string;
    selectedValueAtStart: string | null;
  } | null>(null);
  const lastSelectionByBrandRef = useRef(new Map<string, string>());
  const selectedBrand = selected?.brand;
  const selectedValue = selected?.value;
  useEffect(() => {
    if (selectedBrand && selectedValue) {
      lastSelectionByBrandRef.current.set(selectedBrand, selectedValue);
    }
  }, [selectedBrand, selectedValue]);
  const browsingCurrentSelection = brandBrowse?.selectedValueAtStart === (selectedValue ?? null);
  const displayBrand = browsingCurrentSelection ? brandBrowse.brand : (selectedBrand ?? '');
  const brands = useMemo(
    () => [...new Set(options.map((option) => option.brand))],
    [options],
  );
  const seriesOptions = options.filter((option) => option.brand === displayBrand);
  const displayedSelection = selected?.brand === displayBrand ? selected : null;

  return (
    <div className={`palette-picker${className ? ` ${className}` : ''}`}>
      <label className="palette-picker-field">
        <span>{zhCN.params.brand}</span>
        <select
          value={displayBrand}
          disabled={disabled || options.length === 0}
          onChange={(event) => {
            const brand = event.target.value;
            const rememberedValue = lastSelectionByBrandRef.current.get(brand);
            const next = options.find((option) => (
              option.brand === brand && option.value === rememberedValue
            )) ?? options.find((option) => option.brand === brand && option.defaultForBrand);
            if (next) {
              if (next.value !== selectedValue) onSelect(next.value);
            } else {
              setBrandBrowse({ brand, selectedValueAtStart: selectedValue ?? null });
            }
          }}
          className="input-compact"
        >
          {!selected && <option value="">{zhCN.params.paletteUnavailable}</option>}
          {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
        </select>
      </label>
      <label className="palette-picker-field">
        <span>{zhCN.params.series}</span>
        <select
          value={displayedSelection?.value ?? ''}
          disabled={disabled || !displayBrand}
          aria-describedby={displayedSelection ? detailId : undefined}
          onChange={(event) => {
            setBrandBrowse(null);
            onSelect(event.target.value);
          }}
          className="input-compact"
        >
          {!displayBrand && <option value="">{zhCN.params.paletteUnavailable}</option>}
          {displayBrand && !displayedSelection && (
            <option value="">{zhCN.params.paletteSeriesRequired}</option>
          )}
          {seriesOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.series}</option>
          ))}
        </select>
      </label>
      {displayedSelection && (
        <section id={detailId} className="palette-picker-card" aria-label={zhCN.params.paletteCurrentSeries}>
          <div className="palette-picker-card-heading">
            <div>
              <span>{displayedSelection.brand}</span>
              <strong>{displayedSelection.series}</strong>
            </div>
            <small>{displayedSelection.sourceQuality}</small>
          </div>
          <ColorBand
            colors={displayedSelection.colors}
            max={28}
            label={zhCN.params.paletteBandAria(displayedSelection.brand, displayedSelection.series)}
            className="palette-picker-band"
          />
          <div className="palette-picker-facts">
            <span>{zhCN.params.paletteCollected(displayedSelection.collectedCount)}</span>
            <span>{zhCN.params.paletteUsable(displayedSelection.usableCount)}</span>
            <span>{zhCN.params.paletteApplicable(displayedSelection.boardProfiles.join('、'))}</span>
          </div>
          {displayedSelection.technicalVersion && (
            <details className="palette-picker-technical">
              <summary>{zhCN.params.paletteDataVersion}</summary>
              <p>{displayedSelection.technicalVersion}</p>
            </details>
          )}
        </section>
      )}
      {!displayedSelection && (
        <p role="status" className="palette-picker-unavailable">
          {displayBrand ? zhCN.params.paletteSeriesRequired : zhCN.params.paletteUnavailable}
        </p>
      )}
    </div>
  );
}
