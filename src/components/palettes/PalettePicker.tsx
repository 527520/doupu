'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { zhCN } from '@/messages/zh-CN';
import ColorBand from './ColorBand';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

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
      <ResponsiveSelect label={zhCN.params.brand} className="palette-picker-field"
          value={displayBrand}
          disabled={disabled || options.length === 0}
          onValueChange={(brand) => {
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
          options={[...(!selected ? [{value:'',label:zhCN.params.paletteUnavailable}] : []), ...brands.map((brand)=>({value:brand,label:brand}))]}
      />
      <ResponsiveSelect label={zhCN.params.series} className="palette-picker-field"
          value={displayedSelection?.value ?? ''}
          disabled={disabled || !displayBrand}
          aria-describedby={displayedSelection ? detailId : undefined}
          onValueChange={(nextValue) => {
            setBrandBrowse(null);
            onSelect(nextValue);
          }}
          options={[...(!displayedSelection ? [{value:'',label:displayBrand ? zhCN.params.paletteSeriesRequired : zhCN.params.paletteUnavailable}] : []), ...seriesOptions.map((option)=>({value:option.value,label:option.series,colors:option.colors}))]}
      />
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
