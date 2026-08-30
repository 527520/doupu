// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useGridViewport from './useGridViewport';

function CameraProbe() {
  const viewport = useGridViewport({ patternWidth: 200, patternHeight: 200 });
  const [observed, setObserved] = useState('');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          viewport.applyCamera({ cellPx: 10, offsetX: -100, offsetY: -120 });
          const current = viewport.readCamera();
          setObserved(`${current.cellPx}:${current.offsetX}:${current.offsetY}`);
        }}
      >
        更新并读取
      </button>
      <output aria-label="同步相机">{observed}</output>
    </>
  );
}

describe('useGridViewport', () => {
  it('同一事件内可读取刚写入的相机，供单指切双指时建立无跳变基线', () => {
    render(<CameraProbe />);

    fireEvent.click(screen.getByRole('button', { name: '更新并读取' }));

    expect(screen.getByLabelText('同步相机')).toHaveTextContent('10:-100:-120');
  });
});
