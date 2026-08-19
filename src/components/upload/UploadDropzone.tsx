'use client';

/**
 * 上传落点（spec §F1/F2）：拖拽 + 点击选择。
 * 只做文件级校验（大小/类型/动图），解码交由父级处理；多文件取第一张。
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { zhCN } from '@/messages/zh-CN';
import { validateImageFile, type ImageErrorCode } from '@/lib/image/validation';
import type { ImageType } from '@/lib/image/sniff';

export interface ValidImageFile {
  bytes: Uint8Array;
  name: string;
  type: ImageType;
}

export interface UploadDropzoneProps {
  /** 校验通过（未解码）时回调。 */
  onValid: (file: ValidImageFile) => void;
  disabled?: boolean;
}

export function UploadDropzone({ onValid, disabled = false }: UploadDropzoneProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const reset = useCallback(() => {
    setError(null);
    setReading(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  /** 读取单个文件为字节并做文件级校验；解码交给父级。 */
  const handleFile = useCallback(
    async (file: File) => {
      if (disabled) return;
      setError(null);
      setReading(true);
      try {
        const bytes = await readFileBytes(file);
        const result = validateImageFile({ bytes, name: file.name });
        if (!result.ok) {
          setError(errorMessage(result.code));
          return;
        }
        onValid({ bytes, name: file.name, type: result.type });
      } catch {
        setError(zhCN.errors.UNKNOWN);
      } finally {
        setReading(false);
      }
    },
    [disabled, onValid],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      // 多文件只处理第一张（spec §F1）
      const first = files && files.length > 0 ? files[0] : null;
      if (first) void handleFile(first);
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  // dragenter/dragleave 在子元素间会成对触发，用计数避免闪烁
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const openPicker = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  useEffect(() => () => reset(), [reset]);

  const { upload } = zhCN;
  return (
    <div className="flex w-full flex-col gap-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={upload.selectFile}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft text-primary-deep' : 'border-lilac/60 text-ink-soft',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary hover:text-primary-deep',
        ].join(' ')}
      >
        {reading ? (
          <p>{upload.reading}</p>
        ) : (
          <>
            <p>{dragging ? upload.dragActive : upload.hint}</p>
            <p className="text-xs text-ink-soft/80">{upload.formatHint}</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        disabled={disabled}
        className="sr-only"
        aria-label={upload.inputLabel}
        onChange={(event) => handleFiles(event.target.files)}
      />

      {error !== null && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
          >
            {upload.retry}
          </button>
        </div>
      )}
    </div>
  );
}

/** ImageErrorCode → 用户文案（与 zhCN.errors 一一对应，spec §F1）。 */
export function errorMessage(code: ImageErrorCode): string {
  return zhCN.errors[code];
}

/** 以 FileReader 读取文件为字节（jsdom/全浏览器兼容）。 */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}
